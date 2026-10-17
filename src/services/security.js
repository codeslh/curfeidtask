import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { all, get, insert, run, update } from '../db.js';
import { notifyAdmin, sendMail } from './notify.js';
import { getSection } from './settings.js';
import { generateSecret, otpauthUrl, verifyCode } from './totp.js';

export const COOKIE = 'sid';
export const ROLES = {
  admin: 'Yönetici',
  operator: 'Operatör',
  viewer: 'İzleyici',
};
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const httpError = (status, message) => Object.assign(new Error(message), { status });
const nowIso = () => new Date().toISOString();
const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

export function logEvent({ userId = null, email = null, event, ip, userAgent, suspicious = 0, detail = null }) {
  insert('login_events', { user_id: userId, email, event, ip, user_agent: userAgent, suspicious, detail });
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10 || !/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(pw) || !/\d/.test(pw)) {
    throw httpError(400, 'Şifre en az 10 karakter olmalı ve harf ile rakam içermeli');
  }
}

export async function createUser({ email, name, password, role = 'admin' }) {
  validatePassword(password);
  if (!ROLES[role]) throw httpError(400, 'Geçersiz rol');
  email = String(email || '').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw httpError(400, 'Geçerli bir e-posta girin');
  if (get('SELECT id FROM users WHERE email = ?', email)) throw httpError(400, 'Bu e-posta ile bir kullanıcı zaten var');
  return insert('users', { email, name: name || email, role, password_hash: await bcrypt.hash(password, 12), password_changed_at: nowIso() });
}

export function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, totp_enabled: !!u.totp_enabled };
}

// --- IP rules -------------------------------------------------------------------

export function ipAllowed(ip) {
  const list = getSection('security').allowed_ips || [];
  if (!list.length) return true;
  const clean = String(ip || '').replace(/^::ffff:/, '');
  return list.some((rule) => (rule.endsWith('*') ? clean.startsWith(rule.slice(0, -1)) : clean === rule));
}

const failuresBy = (field, value) => get(`SELECT COUNT(*) AS n FROM login_events WHERE ${field} = ? AND event IN ('login_failed', '2fa_failed')
  AND created_at >= datetime('now', '-15 minutes')`, value).n;

function assertNotLocked(email, ip, userAgent) {
  const { max_failed_logins, max_failed_per_ip } = getSection('security');
  if (failuresBy('ip', ip) >= max_failed_per_ip) {
    logEvent({ email, event: 'login_blocked', ip, userAgent, suspicious: 1, detail: 'IP engellendi' });
    throw httpError(429, 'Bu IP adresinden çok fazla hatalı deneme yapıldı. 15 dakika sonra tekrar deneyin.');
  }
  if (email && failuresBy('email', email) >= max_failed_logins) {
    logEvent({ email, event: 'login_blocked', ip, userAgent, suspicious: 1 });
    throw httpError(429, 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.');
  }
}

async function recordFailure({ user, email, ip, userAgent, event = 'login_failed' }) {
  const { max_failed_logins, max_failed_per_ip } = getSection('security');
  const byEmail = failuresBy('email', email) + 1;
  const byIp = failuresBy('ip', ip) + 1;
  const suspicious = byEmail >= max_failed_logins || byIp >= max_failed_per_ip ? 1 : 0;
  logEvent({ userId: user?.id, email, event, ip, userAgent, suspicious });
  if (byEmail === max_failed_logins) {
    await notifyAdmin('security', 'Şüpheli giriş denemeleri',
      `${email} hesabı için son 15 dakikada ${byEmail} hatalı ${event === '2fa_failed' ? 'doğrulama kodu' : 'giriş'} denemesi yapıldı.\nIP: ${ip}\nTarayıcı: ${userAgent}\nHesap 15 dakika kilitlendi.`, '/security');
  }
  if (byIp === max_failed_per_ip) {
    await notifyAdmin('security', 'Bir IP adresi engellendi',
      `${ip} adresinden 15 dakikada ${byIp} hatalı giriş denemesi yapıldı (farklı hesaplar dahil). IP 15 dakika engellendi.`, '/security');
  }
}

// --- Login ------------------------------------------------------------------------

async function startSession(user, ip, userAgent) {
  const { alert_on_new_ip } = getSection('security');
  const knownIp = get(`SELECT 1 FROM login_events WHERE user_id = ? AND event = 'login_success' AND ip = ? LIMIT 1`, user.id, ip);
  const hasHistory = get(`SELECT 1 FROM login_events WHERE user_id = ? AND event = 'login_success' LIMIT 1`, user.id);
  const newIp = hasHistory && !knownIp;
  logEvent({ userId: user.id, email: user.email, event: 'login_success', ip, userAgent, suspicious: newIp ? 1 : 0, detail: newIp ? 'Yeni IP adresi' : null });
  update('users', user.id, { last_login_at: nowIso() });
  if (newIp && alert_on_new_ip) {
    await notifyAdmin('security', 'Yeni bir cihaz/IP adresinden giriş yapıldı',
      `Hesap: ${user.email}\nIP: ${ip}\nTarayıcı: ${userAgent}\nBu siz değilseniz hemen şifrenizi değiştirin ve oturumları sonlandırın.`, '/security');
  }
  const token = crypto.randomBytes(32).toString('base64url');
  insert('sessions', { id: hashToken(token), user_id: user.id, ip, user_agent: userAgent, expires_at: inMinutes(config.sessionDays * 1440) });
  return { token, user: publicUser(user) };
}

/**
 * Step 1: password. Returns either { token, user } or, when 2FA is on, { challenge }.
 */
export async function login(email, password, ip, userAgent) {
  email = String(email || '').toLowerCase().trim();
  if (!ipAllowed(ip)) {
    logEvent({ email, event: 'login_blocked', ip, userAgent, suspicious: 1, detail: 'İzin verilmeyen IP' });
    await notifyAdmin('security', 'İzin verilmeyen IP adresinden giriş denemesi', `Hesap: ${email}\nIP: ${ip}`, '/security');
    throw httpError(403, 'Bu IP adresinden panele erişim izni yok');
  }
  assertNotLocked(email, ip, userAgent);
  const user = get('SELECT * FROM users WHERE email = ?', email);
  const ok = user && user.active && await bcrypt.compare(String(password || ''), user.password_hash);
  if (!ok) {
    await recordFailure({ user, email, ip, userAgent });
    throw httpError(401, user && !user.active ? 'Hesap devre dışı' : 'E-posta veya şifre hatalı');
  }
  if (user.totp_enabled) {
    const challenge = crypto.randomBytes(24).toString('base64url');
    insert('login_challenges', { id: hashToken(challenge), user_id: user.id, ip, user_agent: userAgent, expires_at: inMinutes(5) });
    logEvent({ userId: user.id, email, event: 'password_ok', ip, userAgent, detail: 'İki adımlı doğrulama bekleniyor' });
    return { challenge };
  }
  return startSession(user, ip, userAgent);
}

function useRecoveryCode(user, code) {
  const codes = JSON.parse(user.recovery_codes || '[]');
  const h = hashToken(String(code).replace(/[\s-]/g, '').toUpperCase());
  const idx = codes.indexOf(h);
  if (idx < 0) return false;
  codes.splice(idx, 1);
  update('users', user.id, { recovery_codes: JSON.stringify(codes) });
  return true;
}

/** Step 2: TOTP code (or a one-time recovery code). */
export async function verifyChallenge(challenge, code, ip, userAgent) {
  const row = get('SELECT * FROM login_challenges WHERE id = ?', hashToken(String(challenge || '')));
  if (!row || row.expires_at < nowIso() || row.attempts >= 5) {
    if (row) run('DELETE FROM login_challenges WHERE id = ?', row.id);
    throw httpError(401, 'Doğrulama süresi doldu, tekrar giriş yapın');
  }
  const user = get('SELECT * FROM users WHERE id = ?', row.user_id);
  assertNotLocked(user.email, ip, userAgent);
  const counter = verifyCode(user.totp_secret, code);
  const viaTotp = counter !== null && counter > user.totp_last_counter;
  const viaRecovery = !viaTotp && String(code || '').replace(/[\s-]/g, '').length === 10 && useRecoveryCode(user, code);
  if (!viaTotp && !viaRecovery) {
    run('UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?', row.id);
    await recordFailure({ user, email: user.email, ip, userAgent, event: '2fa_failed' });
    throw httpError(401, 'Doğrulama kodu hatalı');
  }
  run('DELETE FROM login_challenges WHERE id = ?', row.id);
  if (viaTotp) update('users', user.id, { totp_last_counter: counter });
  if (viaRecovery) {
    const left = JSON.parse(get('SELECT recovery_codes FROM users WHERE id = ?', user.id).recovery_codes || '[]').length;
    await notifyAdmin('security', 'Kurtarma kodu ile giriş yapıldı', `Hesap: ${user.email}\nIP: ${ip}\nKalan kurtarma kodu: ${left}`, '/security');
  }
  return startSession(user, ip, userAgent);
}

// --- Sessions ----------------------------------------------------------------------

export function sessionFromToken(token, ip) {
  if (!token) return null;
  const s = get(`SELECT s.*, u.email, u.name, u.role, u.totp_enabled, u.active FROM sessions s JOIN users u ON u.id = s.user_id
                 WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ?`, hashToken(token), nowIso());
  if (!s || !s.active) return null;
  const { idle_timeout_minutes } = getSection('security');
  if (idle_timeout_minutes > 0) {
    const lastSeen = new Date(`${s.last_seen_at.replace(' ', 'T')}Z`).getTime();
    if (Date.now() - lastSeen > idle_timeout_minutes * 60_000) {
      run(`UPDATE sessions SET revoked_at = datetime('now') WHERE id = ?`, s.id);
      logEvent({ userId: s.user_id, email: s.email, event: 'session_expired', ip, detail: 'Hareketsizlik' });
      return null;
    }
  }
  if (ip !== undefined && !ipAllowed(ip)) return null;
  run(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`, s.id);
  return s;
}

export function logout(session, ip, userAgent) {
  run(`UPDATE sessions SET revoked_at = datetime('now') WHERE id = ?`, session.id);
  logEvent({ userId: session.user_id, email: session.email, event: 'logout', ip, userAgent });
}

export function listSessions(userId) {
  return all(`SELECT substr(id, 1, 12) AS id, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at
              FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 100`, userId);
}

export function revokeSession(userId, shortId, current, ip, userAgent) {
  const s = get('SELECT id FROM sessions WHERE user_id = ? AND substr(id, 1, 12) = ?', userId, shortId);
  if (!s) throw httpError(404, 'Oturum bulunamadı');
  run(`UPDATE sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`, s.id);
  logEvent({ userId, email: current.email, event: 'session_revoked', ip, userAgent, detail: shortId });
}

export function revokeOtherSessions(userId, keepId) {
  run(`UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND id != ? AND revoked_at IS NULL`, userId, keepId ?? '');
}

// --- Passwords ---------------------------------------------------------------------

export async function changePassword(session, current, next, ip, userAgent) {
  const user = get('SELECT * FROM users WHERE id = ?', session.user_id);
  if (!await bcrypt.compare(String(current || ''), user.password_hash)) throw httpError(400, 'Mevcut şifre hatalı');
  validatePassword(next);
  if (await bcrypt.compare(next, user.password_hash)) throw httpError(400, 'Yeni şifre eskisiyle aynı olamaz');
  update('users', user.id, { password_hash: await bcrypt.hash(next, 12), password_changed_at: nowIso() });
  revokeOtherSessions(user.id, session.id);
  logEvent({ userId: user.id, email: user.email, event: 'password_changed', ip, userAgent });
  await notifyAdmin('security', 'Hesap şifresi değiştirildi', `Hesap: ${user.email}\nIP: ${ip}\nDiğer tüm oturumlar sonlandırıldı.`, '/security');
}

/** Always resolves the same way so the endpoint can't be used to discover accounts. */
export async function requestPasswordReset(email, ip, userAgent) {
  email = String(email || '').toLowerCase().trim();
  const user = get('SELECT * FROM users WHERE email = ? AND active = 1', email);
  const recent = get(`SELECT COUNT(*) AS n FROM password_resets WHERE ip = ? AND created_at >= datetime('now', '-1 hour')`, ip).n;
  logEvent({ userId: user?.id, email, event: 'reset_requested', ip, userAgent, suspicious: recent >= 5 ? 1 : 0 });
  if (!user || recent >= 5) return;
  const token = crypto.randomBytes(32).toString('base64url');
  insert('password_resets', { id: hashToken(token), user_id: user.id, ip, expires_at: inMinutes(30) });
  await sendMail({
    to: user.email,
    subject: 'Şifre sıfırlama',
    text: `Şifrenizi sıfırlamak için 30 dakika içinde bu bağlantıyı açın:\n${config.publicUrl}/#/reset/${token}\n\nBu isteği siz yapmadıysanız bu e-postayı yok sayın; şifreniz değişmez.\nİstek IP: ${ip}`,
  }).catch((err) => console.error('Sıfırlama e-postası gönderilemedi:', err.message));
}

export async function resetPassword(token, password, ip, userAgent) {
  const row = get('SELECT * FROM password_resets WHERE id = ?', hashToken(String(token || '')));
  if (!row || row.used_at || row.expires_at < nowIso()) throw httpError(400, 'Bağlantı geçersiz veya süresi dolmuş');
  validatePassword(password);
  const user = get('SELECT * FROM users WHERE id = ?', row.user_id);
  update('users', user.id, { password_hash: await bcrypt.hash(password, 12), password_changed_at: nowIso() });
  run(`UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL`, user.id);
  revokeOtherSessions(user.id, null);
  logEvent({ userId: user.id, email: user.email, event: 'password_reset', ip, userAgent });
  await notifyAdmin('security', 'Şifre e-posta bağlantısıyla sıfırlandı', `Hesap: ${user.email}\nIP: ${ip}\nTüm oturumlar sonlandırıldı.`, '/security');
}

// --- Two-factor authentication -----------------------------------------------------

export async function beginTotpSetup(userId) {
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  if (user.totp_enabled) throw httpError(400, 'İki adımlı doğrulama zaten açık');
  const secret = generateSecret();
  update('users', userId, { totp_secret: secret });
  const url = otpauthUrl(secret, user.email, getSection('business').name);
  return { secret, otpauth_url: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}

export async function enableTotp(session, code, ip, userAgent) {
  const user = get('SELECT * FROM users WHERE id = ?', session.user_id);
  if (!user.totp_secret || user.totp_enabled) throw httpError(400, 'Önce kurulumu başlatın');
  const counter = verifyCode(user.totp_secret, code);
  if (counter === null) throw httpError(400, 'Kod hatalı; uygulamadaki güncel kodu girin');
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').toUpperCase());
  update('users', user.id, { totp_enabled: 1, totp_last_counter: counter, recovery_codes: JSON.stringify(codes.map(hashToken)) });
  revokeOtherSessions(user.id, session.id);
  logEvent({ userId: user.id, email: user.email, event: '2fa_enabled', ip, userAgent });
  await notifyAdmin('security', 'İki adımlı doğrulama açıldı', `Hesap: ${user.email}\nIP: ${ip}`, '/security');
  return { recovery_codes: codes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`) };
}

export async function regenerateRecoveryCodes(session, code, ip, userAgent) {
  const user = get('SELECT * FROM users WHERE id = ?', session.user_id);
  if (!user.totp_enabled) throw httpError(400, 'İki adımlı doğrulama kapalı');
  if (verifyCode(user.totp_secret, code) === null) throw httpError(400, 'Doğrulama kodu hatalı');
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').toUpperCase());
  update('users', user.id, { recovery_codes: JSON.stringify(codes.map(hashToken)) });
  logEvent({ userId: user.id, email: user.email, event: 'recovery_codes_regenerated', ip, userAgent });
  return { recovery_codes: codes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`) };
}

export async function disableTotp(session, password, code, ip, userAgent) {
  const user = get('SELECT * FROM users WHERE id = ?', session.user_id);
  if (!user.totp_enabled) throw httpError(400, 'İki adımlı doğrulama zaten kapalı');
  if (!await bcrypt.compare(String(password || ''), user.password_hash)) throw httpError(400, 'Şifre hatalı');
  if (verifyCode(user.totp_secret, code) === null) throw httpError(400, 'Doğrulama kodu hatalı');
  update('users', user.id, { totp_enabled: 0, totp_secret: null, recovery_codes: null, totp_last_counter: 0 });
  logEvent({ userId: user.id, email: user.email, event: '2fa_disabled', ip, userAgent, suspicious: 1 });
  await notifyAdmin('security', 'İki adımlı doğrulama KAPATILDI', `Hesap: ${user.email}\nIP: ${ip}\nBunu siz yapmadıysanız hemen şifrenizi değiştirin.`, '/security');
}

// --- Team management (admins only) -------------------------------------------------

export function listUsers() {
  return all(`SELECT id, email, name, role, active, notify, totp_enabled, last_login_at, password_changed_at, created_at
              FROM users ORDER BY id`);
}

function assertAnotherAdmin(userId) {
  const others = get(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?`, userId).n;
  if (!others) throw httpError(400, 'Sistemde en az bir aktif yönetici kalmalı');
}

export async function updateUser(actor, userId, patch, ip) {
  const target = get('SELECT * FROM users WHERE id = ?', userId);
  if (!target) throw httpError(404, 'Kullanıcı bulunamadı');
  const changes = {};
  if (patch.name !== undefined) changes.name = String(patch.name);
  if (patch.notify !== undefined) changes.notify = patch.notify ? 1 : 0;
  if (patch.role !== undefined && patch.role !== target.role) {
    if (!ROLES[patch.role]) throw httpError(400, 'Geçersiz rol');
    if (target.role === 'admin') assertAnotherAdmin(userId);
    changes.role = patch.role;
  }
  if (patch.active !== undefined && !!patch.active !== !!target.active) {
    if (!patch.active && target.role === 'admin') assertAnotherAdmin(userId);
    changes.active = patch.active ? 1 : 0;
    if (!patch.active) revokeOtherSessions(userId, null);
  }
  update('users', userId, changes);
  if (changes.role === 'admin' || changes.active === 1) {
    await notifyAdmin('security', 'Kullanıcı yetkisi değişti',
      `${actor.email}, ${target.email} hesabını güncelledi: ${JSON.stringify(changes)}\nIP: ${ip}`, '/users');
  }
}

export async function adminResetPassword(actor, userId, password, ip) {
  validatePassword(password);
  const target = get('SELECT * FROM users WHERE id = ?', userId);
  if (!target) throw httpError(404, 'Kullanıcı bulunamadı');
  update('users', userId, { password_hash: await bcrypt.hash(password, 12), password_changed_at: nowIso() });
  revokeOtherSessions(userId, null);
  logEvent({ userId, email: target.email, event: 'password_reset', ip, detail: `${actor.email} tarafından` });
}

export async function resetUserTotp(actor, userId, ip) {
  const target = get('SELECT * FROM users WHERE id = ?', userId);
  if (!target) throw httpError(404, 'Kullanıcı bulunamadı');
  update('users', userId, { totp_enabled: 0, totp_secret: null, recovery_codes: null, totp_last_counter: 0 });
  revokeOtherSessions(userId, null);
  logEvent({ userId, email: target.email, event: '2fa_disabled', ip, suspicious: 1, detail: `${actor.email} tarafından sıfırlandı` });
  await notifyAdmin('security', 'Bir kullanıcının iki adımlı doğrulaması sıfırlandı', `${actor.email} -> ${target.email}\nIP: ${ip}`, '/users');
}

// --- Logs ---------------------------------------------------------------------------

export function loginEvents({ limit = 300, suspicious = false } = {}) {
  return all(`SELECT * FROM login_events ${suspicious ? 'WHERE suspicious = 1' : ''} ORDER BY id DESC LIMIT ?`, limit);
}

export function audit(entry) {
  insert('audit_log', entry);
}

export function auditLog({ limit = 300, userId, q } = {}) {
  const where = []; const params = [];
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  if (q) { where.push('(action LIKE ? OR detail LIKE ? OR email LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  return all(`SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`, ...params, limit);
}

