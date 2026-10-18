import fs from 'node:fs';
import path from 'node:path';
import { config, dataPath } from '../config.js';
import { all, get, getDb, run, update } from '../db.js';
import { notifyAdmin } from './notify.js';
import { pollMailbox } from './mailbox.js';
import { autoSend, scan as scanArea } from './prospecting.js';
import { defineJob } from './scheduler.js';
import { getSection } from './settings.js';
import { scanSources } from './sources.js';

const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
const sqlAgo = (ms) => isoAgo(ms).replace('T', ' ').slice(0, 19); // matches datetime('now') columns

// --- Finding customers -----------------------------------------------------------------

defineJob('platform_scan', {
  label: 'İlan taraması',
  description: 'Kaynaklar sayfasındaki siteleri (Freelancer.com, Remotive, R10.net, RSS ve izlenen sayfalar) tarar; seçtiğiniz kategorilere uyan yeni freelance işleri ve iş ilanlarını listeye ekler ve size bildirir.',
  defaultSchedule: { type: 'interval', minutes: config.scanner.intervalMinutes },
  defaultEnabled: config.scanner.enabled,
  async run() {
    const r = await scanSources();
    if (r.skipped) return 'Önceki tarama hâlâ sürüyor, atlandı';
    return `${r.sources} kaynak, ${r.fetched} ilan okundu: ${r.added} yeni (${r.matched} uygun)${r.translated ? `, ${r.translated} çevrildi` : ''}${r.translate_error ? ` · çeviri: ${r.translate_error}` : ''}${r.errors.length ? ` · ${r.errors.length} kaynakta hata` : ''}`;
  },
});

defineJob('prospect_scan', {
  label: 'Bölge taraması',
  description: 'Belirlediğiniz bölgedeki işletmeleri tarar, web sitelerini inceler, puanlar ve mesaj şablonundan taslak hazırlar. "Otomatik gönder" açıksa günlük sınır içinde e-postayla yazar.',
  defaultSchedule: { type: 'daily', time: '10:30' },
  defaultEnabled: false,
  async run() {
    const s = getSection('prospecting');
    if (!s.location && s.lat == null) return 'Konum girilmemiş; Bölge taraması sayfasından konum seçin';
    const r = await scanArea();
    let tail = '';
    if (s.auto_send) {
      const sent = await autoSend();
      tail = ` · ${sent.sent.length} işletmeye yazıldı${sent.reason ? ` (${sent.reason})` : ''}`;
    }
    if (r.analyzed) {
      await notifyAdmin('prospect_scan', `Bölge taraması: ${r.analyzed} yeni işletme incelendi`, `${r.found} işletme bulundu, ${r.added} yeni eklendi${tail}.`, '/prospects');
    }
    return `${r.found} bulundu, ${r.added} yeni, ${r.analyzed} incelendi${tail}`;
  },
});

defineJob('email_inbox', {
  label: 'Gelen e-postalar',
  description: 'IMAP gelen kutusunu okur; yazdığınız işletmelerden ve ilan sahiplerinden gelen cevapları Konuşmalar\'a ekler ve size bildirir.',
  defaultSchedule: { type: 'interval', minutes: 2 },
  async run() {
    const r = await pollMailbox();
    return r.skipped ? r.reason : `${r.seen} okunmamış, ${r.handled} konuşmaya eklendi`;
  },
});

defineJob('reply_reminders', {
  label: 'Cevap bekleyen mesaj uyarısı',
  description: 'Size cevap yazan ama henüz yanıtlamadığınız kişiler için belirli aralıklarla hatırlatma gönderir.',
  defaultSchedule: { type: 'interval', minutes: 60 },
  async run() {
    const { reply_reminder_hours } = getSection('automation');
    const cutoff = sqlAgo(reply_reminder_hours * 36e5);
    const waiting = all(`SELECT c.*, cu.name FROM conversations c LEFT JOIN customers cu ON cu.id = c.customer_id
      WHERE c.status = 'open' AND c.last_message_at <= ?
        AND (c.last_reminder_at IS NULL OR c.last_reminder_at <= ?)
        AND (SELECT sender FROM messages m WHERE m.conversation_id = c.id AND m.sender != 'system' ORDER BY id DESC LIMIT 1) = 'customer'`,
    cutoff, isoAgo(reply_reminder_hours * 36e5));
    for (const c of waiting) {
      await notifyAdmin('reply_waiting', `Cevabınızı bekliyor: ${c.name || '#' + c.id}`,
        `Bu kişi ${reply_reminder_hours} saatten uzun süredir cevabınızı bekliyor.`, `/conversations/${c.id}`);
      update('conversations', c.id, { last_reminder_at: new Date().toISOString() });
    }
    return `${waiting.length} konuşma için hatırlatma gönderildi`;
  },
});

defineJob('daily_digest', {
  label: 'Günlük özet e-postası',
  description: 'Her sabah dün bulunan ilanları, işletmeleri, gönderdiğiniz mesajları, gelen cevapları ve güvenlik olaylarını özetler.',
  defaultSchedule: { type: 'daily', time: '08:30' },
  async run() {
    const since = sqlAgo(864e5);
    const sinceIso = isoAgo(864e5);
    const n = (sql, ...p) => get(sql, ...p).n;
    const admins2fa = n(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND totp_enabled = 0`);
    const top = all(`SELECT title, platform, url FROM leads WHERE status = 'new' AND created_at >= ? ORDER BY score DESC LIMIT 5`, since);
    const lines = [
      'Son 24 saat:',
      `• Yeni uygun ilan: ${n(`SELECT COUNT(*) AS n FROM leads WHERE status != 'filtered_out' AND created_at >= ?`, since)}`,
      `• Yeni işletme (bölge taraması): ${n('SELECT COUNT(*) AS n FROM prospects WHERE created_at >= ?', since)}`,
      `• Gönderdiğiniz mesaj: ${n('SELECT COUNT(*) AS n FROM leads WHERE contacted_at >= ?', sinceIso) + n('SELECT COUNT(*) AS n FROM prospects WHERE contacted_at >= ?', sinceIso)}`,
      `• Gelen cevap: ${n(`SELECT COUNT(*) AS n FROM messages WHERE sender = 'customer' AND created_at >= ?`, since)}`,
      '',
      'Bekleyenler:',
      `• İncelenmemiş uygun ilan: ${n(`SELECT COUNT(*) AS n FROM leads WHERE status = 'new'`)}`,
      `• Yazılmayı bekleyen sıcak işletme: ${n(`SELECT COUNT(*) AS n FROM prospects WHERE status = 'analyzed' AND score >= ?`, getSection('prospecting').min_score)}`,
      `• Cevabınızı bekleyen konuşma: ${n(`SELECT COUNT(*) AS n FROM conversations c WHERE c.status = 'open' AND (SELECT sender FROM messages m WHERE m.conversation_id = c.id AND m.sender != 'system' ORDER BY id DESC LIMIT 1) = 'customer'`)}`,
      ...(top.length ? ['', 'Öne çıkan ilanlar:', ...top.map((l) => `• [${l.platform}] ${l.title}${l.url ? `\n  ${l.url}` : ''}`)] : []),
      '',
      'Güvenlik:',
      `• Şüpheli olay: ${n('SELECT COUNT(*) AS n FROM login_events WHERE suspicious = 1 AND created_at >= ?', since)}`,
      `• Hatalı giriş: ${n(`SELECT COUNT(*) AS n FROM login_events WHERE event IN ('login_failed','2fa_failed') AND created_at >= ?`, since)}`,
      ...(admins2fa ? [`• ${admins2fa} yönetici hesabında iki adımlı doğrulama KAPALI.`] : []),
    ];
    await notifyAdmin('daily_digest', `Günlük özet - ${new Date().toLocaleDateString('tr-TR')}`, lines.join('\n'), '/dashboard');
    return 'Özet gönderildi';
  },
});

// --- Security & maintenance --------------------------------------------------------

defineJob('security_scan', {
  label: 'Güvenlik taraması',
  description: 'Aynı hesaba çok sayıda IP adresinden erişim, kurtarma kodu azalması ve sık yedek indirme gibi durumları tarar.',
  defaultSchedule: { type: 'interval', minutes: 30 },
  async run({ state }) {
    const findings = [];
    const today = new Date().toISOString().slice(0, 10);
    const multiIp = all(`SELECT s.user_id, u.email, COUNT(DISTINCT s.ip) AS ips FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.revoked_at IS NULL AND s.last_seen_at >= ? GROUP BY s.user_id HAVING ips >= 3`, sqlAgo(36e5));
    for (const m of multiIp) {
      const key = `multi_ip_${m.user_id}`;
      if (state[key] !== today) { state[key] = today; findings.push(`${m.email} hesabı son 1 saatte ${m.ips} farklı IP adresinden kullanıldı.`); }
    }
    for (const u of all(`SELECT id, email, recovery_codes FROM users WHERE totp_enabled = 1 AND active = 1`)) {
      const left = JSON.parse(u.recovery_codes || '[]').length;
      if (left <= 2 && state[`codes_${u.id}`] !== left) { state[`codes_${u.id}`] = left; findings.push(`${u.email} hesabında ${left} kurtarma kodu kaldı; yenilerini oluşturun.`); }
    }
    const backups = get(`SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'GET /api/backup%' AND created_at >= ?`, sqlAgo(36e5)).n;
    if (backups >= 3 && state.backup_alert !== today) { state.backup_alert = today; findings.push(`Son 1 saatte ${backups} kez veritabanı yedeği indirildi.`); }
    if (findings.length) await notifyAdmin('security', 'Güvenlik taraması: dikkat gerektiren durumlar', findings.join('\n'), '/security');
    return findings.length ? `${findings.length} bulgu` : 'Sorun yok';
  },
});

defineJob('backup', {
  label: 'Veritabanı yedeği',
  description: 'Veritabanının günlük yedeğini alır ve en eski yedekleri siler.',
  defaultSchedule: { type: 'daily', time: '03:00' },
  async run() {
    const dir = dataPath('backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `app-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const keep = getSection('automation').backup_keep;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(dir, f));
    return `${path.basename(file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`;
  },
});

defineJob('cleanup', {
  label: 'Temizlik',
  description: 'Süresi dolmuş oturumları, doğrulama ve şifre sıfırlama kayıtlarını, eski bildirim ve kayıtları siler.',
  defaultSchedule: { type: 'daily', time: '04:00' },
  async run() {
    const { audit_retention_days } = getSection('security');
    const { notification_retention_days } = getSection('automation');
    const now = new Date().toISOString();
    const counts = {
      sessions: run(`DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`, isoAgo(30 * 864e5), sqlAgo(30 * 864e5)).changes,
      challenges: run('DELETE FROM login_challenges WHERE expires_at < ?', now).changes,
      resets: run('DELETE FROM password_resets WHERE expires_at < ?', isoAgo(864e5)).changes,
      notifications: run('DELETE FROM notifications WHERE read = 1 AND created_at < ?', sqlAgo(notification_retention_days * 864e5)).changes,
      audit: run('DELETE FROM audit_log WHERE created_at < ?', sqlAgo(audit_retention_days * 864e5)).changes,
      login_events: run('DELETE FROM login_events WHERE created_at < ?', sqlAgo(audit_retention_days * 864e5)).changes,
      job_runs: run('DELETE FROM job_runs WHERE started_at < ?', isoAgo(90 * 864e5)).changes,
    };
    return Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ');
  },
});

