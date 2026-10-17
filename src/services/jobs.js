import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { config, dataPath } from '../config.js';
import { all, get, getDb, run, update } from '../db.js';
import { monthTokenUsage } from './ai.js';
import { notifyAdmin } from './notify.js';
import { paymentInstructions } from './payments.js';
import { aiAnalysis, monthlyPdf, monthStats } from './reports.js';
import { aiFollowup, sendToCustomer } from './sales.js';
import { scanPlatforms } from './scanner.js';
import { defineJob } from './scheduler.js';
import { getSection, toBase } from './settings.js';

const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
const sqlAgo = (ms) => isoAgo(ms).replace('T', ' ').slice(0, 19); // matches datetime('now') columns

function pdfBuffer(write) {
  return new Promise((resolve, reject) => {
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    out.on('error', reject);
    write(out);
  });
}

// --- Sales & customer follow-up -----------------------------------------------------

defineJob('platform_scan', {
  label: 'Freelancer platform taraması',
  description: 'Seçili platformları tarama kapsamına göre tarar; iletişim bilgisi olan ilan sahiplerine yazar, olmayanları admine bildirir.',
  defaultSchedule: { type: 'interval', minutes: config.scanner.intervalMinutes },
  defaultEnabled: config.scanner.enabled,
  async run() {
    const r = await scanPlatforms();
    if (r.skipped) return 'Önceki tarama hâlâ sürüyor, atlandı';
    return `${r.fetched} ilan: ${r.contacted} iletişim, ${r.needs_admin} admine, ${r.filtered} kapsam dışı, ${r.duplicate} tekrar${r.errors.length ? ` · ${r.errors.length} hata` : ''}`;
  },
});

defineJob('customer_followups', {
  label: 'Cevapsız müşteriye takip mesajı',
  description: 'Yapay zekanın son mesajına belirli süre cevap vermeyen (henüz iş alınmamış) müşterilere nazik bir takip mesajı gönderir.',
  defaultSchedule: { type: 'interval', minutes: 60 },
  async run() {
    const { followup_after_hours, followup_max } = getSection('automation');
    const convs = all(`SELECT c.* FROM conversations c
      WHERE c.mode = 'ai' AND c.status = 'open' AND c.project_id IS NULL AND c.channel != 'platform'
        AND c.followup_count < ? AND c.last_message_at <= ?
        AND (SELECT sender FROM messages m WHERE m.conversation_id = c.id AND m.sender != 'system' ORDER BY id DESC LIMIT 1) = 'ai'
        AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender = 'customer')`,
    followup_max, sqlAgo(followup_after_hours * 36e5));
    let sent = 0;
    for (const conv of convs) {
      const text = await aiFollowup(conv);
      if (!text) continue;
      run('UPDATE conversations SET followup_count = followup_count + 1 WHERE id = ?', conv.id);
      await sendToCustomer(conv.id, text);
      sent++;
    }
    return `${sent} takip mesajı gönderildi`;
  },
});

defineJob('payment_reminders', {
  label: 'Ödeme hatırlatmaları',
  description: 'Bekleyen ödemeler için müşteriye düzenli hatırlatma gönderir; vadesi geçen ödemeleri admine bildirir.',
  defaultSchedule: { type: 'daily', time: '10:00' },
  async run() {
    const { payment_reminder_days, payment_max_reminders } = getSection('automation');
    const { payment_due_days } = getSection('payments');
    const pending = all(`SELECT pay.*, p.conversation_id, p.title, c.name AS customer_name FROM payments pay
      LEFT JOIN projects p ON p.id = pay.project_id LEFT JOIN customers c ON c.id = pay.customer_id WHERE pay.status = 'pending'`);
    let reminded = 0; let overdue = 0;
    for (const pay of pending) {
      const last = new Date(pay.last_reminder_at || `${pay.created_at.replace(' ', 'T')}Z`).getTime();
      if (pay.conversation_id && pay.reminder_count < payment_max_reminders && Date.now() - last >= payment_reminder_days * 864e5) {
        await sendToCustomer(pay.conversation_id,
          `Merhaba, "${pay.title}" için ödemeniz henüz bize ulaşmadı. Hatırlatma amacıyla bilgileri tekrar paylaşıyoruz:\n\n${paymentInstructions(pay)}\n\nÖdemeyi yaptıysanız bu mesajı dikkate almayın.`);
        update('payments', pay.id, { reminder_count: pay.reminder_count + 1, last_reminder_at: new Date().toISOString() });
        reminded++;
      }
      const ageDays = (Date.now() - new Date(`${pay.created_at.replace(' ', 'T')}Z`).getTime()) / 864e5;
      if (ageDays > payment_due_days && !pay.overdue_notified) {
        await notifyAdmin('payment_overdue', `Vadesi geçen ödeme: ${pay.customer_name || pay.reference}`,
          `${pay.amount} ${pay.currency} · ${pay.reference}\nProje: ${pay.title || '-'}\n${Math.floor(ageDays)} gündür bekliyor, ${pay.reminder_count} hatırlatma gönderildi.`, '/payments');
        update('payments', pay.id, { overdue_notified: 1 });
        overdue++;
      }
    }
    return `${reminded} hatırlatma, ${overdue} vadesi geçmiş ödeme bildirimi`;
  },
});

defineJob('escalation_reminders', {
  label: 'Bekleyen konuşma uyarısı',
  description: 'Admine aktarılıp belirli süredir cevaplanmayan konuşmalar için yeniden uyarı gönderir.',
  defaultSchedule: { type: 'interval', minutes: 30 },
  async run() {
    const { escalation_renotify_minutes } = getSection('automation');
    const cutoff = sqlAgo(escalation_renotify_minutes * 60_000);
    const waiting = all(`SELECT c.*, cu.name FROM conversations c LEFT JOIN customers cu ON cu.id = c.customer_id
      WHERE c.status = 'escalated' AND c.last_message_at <= ?
        AND (c.last_escalation_notice_at IS NULL OR c.last_escalation_notice_at <= ?)
        AND (SELECT sender FROM messages m WHERE m.conversation_id = c.id AND m.sender != 'system' ORDER BY id DESC LIMIT 1) != 'admin'`,
    cutoff, isoAgo(escalation_renotify_minutes * 60_000));
    for (const c of waiting) {
      await notifyAdmin('escalation', `Hâlâ cevap bekleniyor: ${c.name || '#' + c.id}`,
        `Bu konuşma ${escalation_renotify_minutes} dakikadan uzun süredir yanıtsız.\nSebep: ${c.escalation_reason || '-'}`, `/conversations/${c.id}`);
      update('conversations', c.id, { last_escalation_notice_at: new Date().toISOString() });
    }
    return `${waiting.length} konuşma için uyarı gönderildi`;
  },
});

// --- Reports -------------------------------------------------------------------------

defineJob('daily_digest', {
  label: 'Günlük özet e-postası',
  description: 'Her sabah dünkü satış, konuşma, ilan, ödeme ve güvenlik olaylarını özetleyen bir e-posta gönderir.',
  defaultSchedule: { type: 'daily', time: '08:30' },
  async run() {
    const since = sqlAgo(864e5);
    const n = (sql, ...p) => get(sql, ...p).n;
    const base = getSection('business').base_currency;
    const paid = all('SELECT amount, currency FROM payments WHERE paid_at >= ?', isoAgo(864e5));
    const revenue = paid.reduce((s, p) => s + toBase(p.amount, p.currency), 0);
    const admins2fa = n(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND totp_enabled = 0`);
    const lines = [
      `Son 24 saat:`,
      `• Yeni konuşma: ${n('SELECT COUNT(*) AS n FROM conversations WHERE created_at >= ?', since)}`,
      `• Yeni müşteri: ${n('SELECT COUNT(*) AS n FROM customers WHERE created_at >= ?', since)}`,
      `• Taranan ilan: ${n('SELECT COUNT(*) AS n FROM leads WHERE created_at >= ?', since)} (admin bekleyen: ${n(`SELECT COUNT(*) AS n FROM leads WHERE status = 'needs_admin'`)})`,
      `• Alınan iş: ${n('SELECT COUNT(*) AS n FROM projects WHERE created_at >= ?', since)}`,
      `• Tahsilat: ${revenue.toFixed(2)} ${base} (${paid.length} ödeme)`,
      '',
      'Bekleyen işler:',
      `• Admine aktarılmış konuşma: ${n(`SELECT COUNT(*) AS n FROM conversations WHERE status = 'escalated'`)}`,
      `• Kontrol bekleyen proje: ${n(`SELECT COUNT(*) AS n FROM projects WHERE status IN ('review','changes_requested','build_failed')`)}`,
      `• Bekleyen ödeme: ${n(`SELECT COUNT(*) AS n FROM payments WHERE status = 'pending'`)}`,
      '',
      'Güvenlik:',
      `• Şüpheli olay: ${n('SELECT COUNT(*) AS n FROM login_events WHERE suspicious = 1 AND created_at >= ?', since)}`,
      `• Hatalı giriş: ${n(`SELECT COUNT(*) AS n FROM login_events WHERE event IN ('login_failed','2fa_failed') AND created_at >= ?`, since)}`,
      ...(admins2fa ? [`• ${admins2fa} yönetici hesabında iki adımlı doğrulama KAPALI.`] : []),
      '',
      `Yapay zeka bu ay ${monthTokenUsage().toLocaleString('tr-TR')} token kullandı.`,
    ];
    await notifyAdmin('daily_digest', `Günlük özet - ${new Date().toLocaleDateString('tr-TR')}`, lines.join('\n'), '/dashboard');
    return 'Özet gönderildi';
  },
});

defineJob('monthly_report', {
  label: 'Aylık rapor (PDF)',
  description: 'Her ayın başında geçen ayın özetini yapay zeka değerlendirmesiyle birlikte PDF olarak e-postayla gönderir.',
  defaultSchedule: { type: 'monthly', day: 1, time: '09:00' },
  async run({ state }) {
    const d = new Date();
    const month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    let analysis = '';
    try { analysis = await aiAnalysis(month); } catch (err) { analysis = `Yapay zeka değerlendirmesi alınamadı: ${err.message}`; }
    const pdf = await pdfBuffer((out) => monthlyPdf(month, out, analysis));
    const s = monthStats(month);
    await notifyAdmin('monthly_report', `${month} aylık raporu`,
      `Net ciro: ${s.revenue} ${s.currency}\nGider: ${s.expenses} ${s.currency}\nKâr: ${s.profit} ${s.currency}\nYeni müşteri: ${s.new_customers}\nAlınan iş: ${s.projects_won}\n\nAyrıntılar ekteki PDF'te.`,
      '/dashboard', [{ filename: `rapor-${month}.pdf`, content: pdf }]);
    state.last_month = month;
    return `${month} raporu gönderildi`;
  },
});

defineJob('token_budget_watch', {
  label: 'Yapay zeka bütçe takibi',
  description: 'Aylık token kullanımı belirlenen yüzdeyi geçince bir kez uyarır.',
  defaultSchedule: { type: 'interval', minutes: 60 },
  async run({ state }) {
    const { monthly_token_budget } = getSection('ai');
    const { token_budget_warn_percent } = getSection('automation');
    if (!monthly_token_budget) return 'Bütçe sınırsız';
    const used = monthTokenUsage();
    const pct = Math.round((used / monthly_token_budget) * 100);
    const month = new Date().toISOString().slice(0, 7);
    for (const level of [100, token_budget_warn_percent]) {
      if (pct >= level && state[`warned_${level}`] !== month) {
        state[`warned_${level}`] = month;
        await notifyAdmin('ai_budget', level >= 100 ? 'Yapay zeka aylık bütçesi DOLDU' : `Yapay zeka bütçesinin %${pct}'i kullanıldı`,
          `Bu ay ${used.toLocaleString('tr-TR')} / ${monthly_token_budget.toLocaleString('tr-TR')} token kullanıldı.${level >= 100 ? '\nYeni konuşmalar admine aktarılıyor. Ayarlar → Yapay zeka bölümünden bütçeyi artırabilirsiniz.' : ''}`, '/settings');
        break;
      }
    }
    return `Kullanım %${pct}`;
  },
});

// --- Security & maintenance --------------------------------------------------------

defineJob('security_scan', {
  label: 'Güvenlik taraması',
  description: 'Olağan dışı iade hacmi, aynı hesaba çok sayıda IP adresinden erişim ve kurtarma kodu azalması gibi durumları tarar.',
  defaultSchedule: { type: 'interval', minutes: 30 },
  async run({ state }) {
    const findings = [];
    const { max_refunds_per_day } = getSection('security');
    const refunds = get('SELECT COUNT(*) AS n FROM refunds WHERE created_at >= ?', sqlAgo(864e5)).n;
    const today = new Date().toISOString().slice(0, 10);
    if (refunds > max_refunds_per_day && state.refund_alert !== today) {
      state.refund_alert = today;
      findings.push(`Son 24 saatte ${refunds} iade yapıldı (eşik: ${max_refunds_per_day}).`);
    }
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

