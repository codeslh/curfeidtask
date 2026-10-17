import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { all, get, insert, run } from '../db.js';
import { notifyAdmin } from './notify.js';
import { getSection } from './settings.js';

export const COOKIE = 'sid';
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function logEvent({ userId = null, email = null, event, ip, userAgent, suspicious = 0, detail = null }) {
  insert('login_events', { user_id: userId, email, event, ip, user_agent: userAgent, suspicious, detail });
}

export async function createUser({ email, name, password }) {
  validatePassword(password);
  return insert('users', { email: email.toLowerCase(), name, password_hash: await bcrypt.hash(password, 12), password_changed_at: new Date().toISOString() });
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    throw new Error('Şifre en az 10 karakter olmalı ve harf ile rakam içermeli');
  }
}

function recentFailures(email) {
  return get(`SELECT COUNT(*) AS n FROM login_events WHERE email = ? AND event = 'login_failed'
              AND created_at >= datetime('now', '-15 minutes')`, email).n;
}

/** Returns { token, user } or throws with a user-facing message. */
export async function login(email, password, ip, userAgent) {
  email = String(email || '').toLowerCase().trim();
  const { max_failed_logins, alert_on_new_ip } = getSection('security');
  if (recentFailures(email) >= max_failed_logins) {
    logEvent({ email, event: 'login_blocked', ip, userAgent, suspicious: 1 });
    throw Object.assign(new Error('Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.'), { status: 429 });
  }
  const user = get('SELECT * FROM users WHERE email = ?', email);
  const ok = user && await bcrypt.compare(String(password || ''), user.password_hash);
  if (!ok) {
    const failures = recentFailures(email) + 1;
    const suspicious = failures >= max_failed_logins ? 1 : 0;
    logEvent({ userId: user?.id, email, event: 'login_failed', ip, userAgent, suspicious });
    if (suspicious) {
      await notifyAdmin('security', 'Şüpheli giriş denemeleri',
        `${email} hesabı için son 15 dakikada ${failures} hatalı giriş denemesi yapıldı.\nIP: ${ip}\nTarayıcı: ${userAgent}\nHesap 15 dakika kilitlendi.`, '/security');
    }
    throw Object.assign(new Error('E-posta veya şifre hatalı'), { status: 401 });
  }

  const knownIp = get(`SELECT 1 FROM login_events WHERE user_id = ? AND event = 'login_success' AND ip = ? LIMIT 1`, user.id, ip);
  const hasHistory = get(`SELECT 1 FROM login_events WHERE user_id = ? AND event = 'login_success' LIMIT 1`, user.id);
  const newIp = hasHistory && !knownIp;
  logEvent({ userId: user.id, email, event: 'login_success', ip, userAgent, suspicious: newIp ? 1 : 0, detail: newIp ? 'Yeni IP adresi' : null });
  if (newIp && alert_on_new_ip) {
    await notifyAdmin('security', 'Yeni bir cihaz/IP adresinden giriş yapıldı',
      `Hesap: ${email}\nIP: ${ip}\nTarayıcı: ${userAgent}\nBu siz değilseniz hemen şifrenizi değiştirin ve oturumları sonlandırın.`, '/security');
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 864e5).toISOString();
  insert('sessions', { id: hashToken(token), user_id: user.id, ip, user_agent: userAgent, expires_at: expires });
  return { token, user: publicUser(user) };
}

export function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

export function sessionFromToken(token) {
  if (!token) return null;
  const s = get(`SELECT s.*, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
                 WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ?`, hashToken(token), new Date().toISOString());
  if (!s) return null;
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
  if (!s) throw new Error('Oturum bulunamadı');
  run(`UPDATE sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`, s.id);
  logEvent({ userId, email: current.email, event: 'session_revoked', ip, userAgent, detail: shortId });
}

export function revokeOtherSessions(userId, keepId) {
  run(`UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND id != ? AND revoked_at IS NULL`, userId, keepId);
}

export async function changePassword(session, current, next, ip, userAgent) {
  const user = get('SELECT * FROM users WHERE id = ?', session.user_id);
  if (!await bcrypt.compare(String(current || ''), user.password_hash)) throw new Error('Mevcut şifre hatalı');
  validatePassword(next);
  run('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?', await bcrypt.hash(next, 12), new Date().toISOString(), user.id);
  revokeOtherSessions(user.id, session.id);
  logEvent({ userId: user.id, email: user.email, event: 'password_changed', ip, userAgent });
  await notifyAdmin('security', 'Hesap şifresi değiştirildi', `Hesap: ${user.email}\nIP: ${ip}\nDiğer tüm oturumlar sonlandırıldı.`, '/security');
}

export function loginEvents(limit = 200) {
  return all('SELECT * FROM login_events ORDER BY id DESC LIMIT ?', limit);
}
