import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, dataPath } from '../config.js';
import { all, get, getDb, run, update } from '../db.js';
import { adminSend, handleInConversation } from '../services/inbox.js';
import { mailboxReady } from '../services/mailbox.js';
import { notifyAdmin } from '../services/notify.js';
import * as prospecting from '../services/prospecting.js';
import * as scheduler from '../services/scheduler.js';
import * as security from '../services/security.js';
import { getSettings, saveSection } from '../services/settings.js';
import * as sources from '../services/sources.js';
import { CATEGORIES, categoryLabel } from '../services/categories.js';
import * as translate from '../services/translate.js';
import { whatsappApiReady } from '../services/whatsapp.js';
import { asyncRoute, auditTrail, authorize, clientInfo, requireAuth } from './util.js';

export const router = express.Router();
router.use(requireAuth, authorize, auditTrail);

const id = (req) => Number(req.params.id);
const bad = (res, err) => res.status(err.status && err.status < 500 ? err.status : 400).json({ error: err.message });

// --- Dashboard ------------------------------------------------------------------

router.get('/dashboard', (_req, res) => {
  const n = (sql, ...p) => get(sql, ...p).n;
  const minScore = getSettings().prospecting.min_score;
  // Last 14 days of matching leads (per platform) and contacts made.
  const days = all(`WITH RECURSIVE d(day) AS (SELECT date('now', '-13 days') UNION ALL SELECT date(day, '+1 day') FROM d WHERE day < date('now'))
    SELECT d.day,
      (SELECT COUNT(*) FROM leads l WHERE date(l.created_at) = d.day AND l.status != 'filtered_out') AS leads,
      (SELECT COUNT(*) FROM prospects p WHERE date(p.created_at) = d.day) AS prospects,
      (SELECT COUNT(*) FROM leads l WHERE date(l.contacted_at) = d.day) + (SELECT COUNT(*) FROM prospects p WHERE date(p.contacted_at) = d.day) AS contacted
    FROM d ORDER BY d.day`);
  res.json({
    kpis: {
      new_leads: n(`SELECT COUNT(*) AS n FROM leads WHERE status = 'new'`),
      new_freelance: n(`SELECT COUNT(*) AS n FROM leads WHERE status = 'new' AND kind = 'freelance'`),
      new_jobs: n(`SELECT COUNT(*) AS n FROM leads WHERE status = 'new' AND kind = 'job'`),
      leads_today: n(`SELECT COUNT(*) AS n FROM leads WHERE status != 'filtered_out' AND date(created_at) = date('now')`),
      hot_prospects: n(`SELECT COUNT(*) AS n FROM prospects WHERE status = 'analyzed' AND score >= ?`, minScore),
      contacted_week: n(`SELECT COUNT(*) AS n FROM leads WHERE contacted_at >= ?`, new Date(Date.now() - 7 * 864e5).toISOString())
        + n(`SELECT COUNT(*) AS n FROM prospects WHERE contacted_at >= ?`, new Date(Date.now() - 7 * 864e5).toISOString()),
      waiting_reply: n(`SELECT COUNT(*) AS n FROM conversations c WHERE c.status = 'open'
        AND (SELECT sender FROM messages m WHERE m.conversation_id = c.id AND m.sender != 'system' ORDER BY id DESC LIMIT 1) = 'customer'`),
      won: n(`SELECT COUNT(*) AS n FROM leads WHERE status = 'won'`) + n(`SELECT COUNT(*) AS n FROM prospects WHERE status = 'converted'`),
    },
    funnel: {
      found: n(`SELECT COUNT(*) AS n FROM leads WHERE status != 'filtered_out'`) + n('SELECT COUNT(*) AS n FROM prospects'),
      contacted: n(`SELECT COUNT(*) AS n FROM leads WHERE status IN ('contacted','replied','won','lost')`) + n(`SELECT COUNT(*) AS n FROM prospects WHERE status IN ('contacted','replied','converted')`),
      replied: n(`SELECT COUNT(*) AS n FROM leads WHERE status IN ('replied','won')`) + n(`SELECT COUNT(*) AS n FROM prospects WHERE status IN ('replied','converted')`),
      won: n(`SELECT COUNT(*) AS n FROM leads WHERE status = 'won'`) + n(`SELECT COUNT(*) AS n FROM prospects WHERE status = 'converted'`),
    },
    days,
    by_platform: all(`SELECT platform, COUNT(*) AS n FROM leads WHERE status != 'filtered_out' AND created_at >= datetime('now', '-30 days') GROUP BY platform ORDER BY n DESC`),
    top_leads: all(`SELECT id, kind, title, title_tr, company, platform, score, budget_max, currency, created_at FROM leads WHERE status = 'new' ORDER BY score DESC, id DESC LIMIT 6`),
    top_prospects: all(`SELECT id, name, category, score FROM prospects WHERE status = 'analyzed' ORDER BY score DESC LIMIT 6`)
      .map((p) => ({ ...p, category_label: prospecting.CATEGORIES[p.category]?.label || p.category })),
    sources: all('SELECT id, name, platform, kind, enabled, last_run_at, last_status, last_message FROM sources ORDER BY id'),
    unread_notifications: n('SELECT COUNT(*) AS n FROM notifications WHERE read = 0'),
  });
});

// --- Notifications --------------------------------------------------------------

router.get('/notifications', (_req, res) => res.json(all('SELECT * FROM notifications ORDER BY id DESC LIMIT 200')));
router.post('/notifications/read-all', (_req, res) => { run('UPDATE notifications SET read = 1'); res.json({ ok: true }); });
router.post('/notifications/:id/read', (req, res) => { update('notifications', id(req), { read: 1 }); res.json({ ok: true }); });

// --- Conversations ----------------------------------------------------------------

router.get('/conversations', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) { where.push('c.status = ?'); params.push(req.query.status); }
  res.json(all(`SELECT c.*, cu.name AS customer_name, cu.phone, cu.email,
                  (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message,
                  (SELECT sender FROM messages m WHERE m.conversation_id = c.id AND m.sender != 'system' ORDER BY id DESC LIMIT 1) AS last_sender
                FROM conversations c LEFT JOIN customers cu ON cu.id = c.customer_id
                ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                ORDER BY c.last_message_at DESC LIMIT 300`, ...params));
});

router.get('/conversations/:id', (req, res) => {
  const conv = get('SELECT * FROM conversations WHERE id = ?', id(req));
  if (!conv) return res.sendStatus(404);
  res.json({
    // No WhatsApp Cloud API (e.g. running on a laptop): you send from your own WhatsApp via wa.me links.
    relay: conv.channel === 'whatsapp' && !whatsappApiReady(),
    smtp: Boolean(config.smtp.host),
    conversation: conv,
    customer: get('SELECT * FROM customers WHERE id = ?', conv.customer_id),
    lead: get('SELECT id, title, platform, url, status FROM leads WHERE conversation_id = ? ORDER BY id DESC LIMIT 1', conv.id) || null,
    prospect: get('SELECT id, name, status FROM prospects WHERE conversation_id = ? ORDER BY id DESC LIMIT 1', conv.id) || null,
    messages: all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id', conv.id),
  });
});

// A reply that came in elsewhere (WhatsApp on your phone, a call...) pasted into the panel.
router.post('/conversations/:id/inbound', asyncRoute(async (req, res) => {
  const conv = get('SELECT * FROM conversations WHERE id = ?', id(req));
  if (!conv) return res.sendStatus(404);
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Mesaj boş olamaz' });
  try { res.json(await handleInConversation(conv, text)); } catch (err) { bad(res, err); }
}));
router.post('/conversations/:id/close', (req, res) => { update('conversations', id(req), { status: 'closed' }); res.json({ ok: true }); });
router.post('/conversations/:id/reopen', (req, res) => { update('conversations', id(req), { status: 'open' }); res.json({ ok: true }); });
router.post('/conversations/:id/messages', asyncRoute(async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Mesaj boş olamaz' });
  try { res.json({ ok: true, ...(await adminSend(id(req), text)) }); } catch (err) { bad(res, err); }
}));

// --- Local business prospecting ---------------------------------------------------------

const prospectRow = (p) => ({
  ...p, raw: undefined,
  site_check: p.site_check ? JSON.parse(p.site_check) : null,
  signals: p.signals ? JSON.parse(p.signals) : [],
  category_label: prospecting.CATEGORIES[p.category]?.label || p.category,
  whatsapp_link: prospecting.whatsappLink(p),
  full_message: p.message ? prospecting.fullMessage(p) : null,
});
router.get('/prospects', (req, res) => {
  const s = getSettings().prospecting;
  res.json({
    settings: s,
    stats: prospecting.stats(),
    scanning: prospecting.isScanning(),
    categories: Object.entries(prospecting.CATEGORIES).map(([k, v]) => ({ key: k, label: v.label })),
    capabilities: { smtp: Boolean(config.smtp.host), whatsapp_template: Boolean(config.whatsapp.token && config.whatsapp.outreachTemplate), google: Boolean(config.googlePlacesKey) },
    scans: all('SELECT * FROM prospect_scans ORDER BY id DESC LIMIT 10'),
    prospects: all('SELECT * FROM prospects ORDER BY CASE WHEN score IS NULL THEN 1 ELSE 0 END, score DESC, id DESC LIMIT 500').map(prospectRow),
  });
});
router.post('/prospects/scan', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  for (const k of ['location', 'radius_km', 'categories', 'source', 'max_per_scan']) if (b[k] !== undefined) patch[k] = b[k];
  if (b.lat !== undefined) { patch.lat = b.lat; patch.lng = b.lng; }
  else if (b.location !== undefined && b.location !== getSettings().prospecting.location) { patch.lat = null; patch.lng = null; }
  if (Object.keys(patch).length) saveSection('prospecting', patch);
  try { res.json(await prospecting.scan()); } catch (err) { bad(res, err); }
}));
router.post('/prospects/geocode', asyncRoute(async (req, res) => {
  try { res.json(await prospecting.geocode(String(req.body?.q || ''))); } catch (err) { bad(res, err); }
}));
router.post('/prospects/auto-send', asyncRoute(async (req, res) => {
  try { res.json(await prospecting.autoSend({ max: Number(req.body?.max) || Infinity })); } catch (err) { bad(res, err); }
}));
router.post('/prospects/:id/analyze', asyncRoute(async (req, res) => {
  try { res.json(prospectRow(await prospecting.analyzeProspect(id(req)))); } catch (err) { bad(res, err); }
}));
router.post('/prospects/:id/contact', asyncRoute(async (req, res) => {
  try { res.json(prospectRow(await prospecting.contact(id(req), { channel: req.body?.channel, message: req.body?.message }))); } catch (err) { bad(res, err); }
}));
router.put('/prospects/:id', (req, res) => {
  const patch = {};
  if (req.body?.message !== undefined) patch.message = String(req.body.message);
  if (req.body?.email !== undefined) patch.email = String(req.body.email).trim() || null;
  if (req.body?.phone !== undefined) patch.phone = String(req.body.phone).replace(/[^\d]/g, '') || null;
  update('prospects', id(req), patch);
  res.json(prospectRow(get('SELECT * FROM prospects WHERE id = ?', id(req))));
});
router.post('/prospects/:id/skip', (req, res) => { prospecting.skip(id(req)); res.json({ ok: true }); });
router.post('/prospects/:id/block', (req, res) => {
  const p = get('SELECT * FROM prospects WHERE id = ?', id(req));
  if (!p) return res.sendStatus(404);
  prospecting.block(p, 'Admin kara listeye aldı');
  res.json({ ok: true });
});

// What is configured in .env (shown under Ayarlar → İşletme).
router.get('/system/status', (_req, res) => res.json({
  smtp: Boolean(config.smtp.host), imap: mailboxReady(), whatsapp_api: whatsappApiReady(),
  google_places: Boolean(config.googlePlacesKey), public_url: config.publicUrl,
  translate: translate.provider(), translate_label: translate.PROVIDER_LABEL[translate.provider()],
}));

// --- Customers (people who answered) ---------------------------------------------------------

router.get('/customers', (_req, res) => res.json(all(`
  SELECT cu.*,
    (SELECT COUNT(*) FROM conversations c WHERE c.customer_id = cu.id) AS conversation_count,
    (SELECT MAX(c.last_message_at) FROM conversations c WHERE c.customer_id = cu.id) AS last_message_at,
    (SELECT c.id FROM conversations c WHERE c.customer_id = cu.id ORDER BY c.last_message_at DESC LIMIT 1) AS conversation_id
  FROM customers cu ORDER BY cu.id DESC`)));
router.put('/customers/:id', (req, res) => {
  const { name, email, phone, notes } = req.body || {};
  update('customers', id(req), { name, email, phone, notes });
  res.json(get('SELECT * FROM customers WHERE id = ?', id(req)));
});

// --- Listing sources -----------------------------------------------------------------------

router.get('/sources', (_req, res) => res.json({
  platforms: sources.PLATFORMS,
  kinds: sources.KINDS,
  sources: all('SELECT * FROM sources ORDER BY id'),
  scanning: sources.isScanning(),
}));
router.post('/sources', (req, res) => {
  const b = req.body || {};
  const kind = ['rss', 'page'].includes(b.kind) ? b.kind : null;
  if (!kind) return res.status(400).json({ error: 'Kaynak türü rss veya page olmalı' });
  let url;
  try { url = new URL(String(b.url || '').trim()); } catch { return res.status(400).json({ error: 'Geçerli bir adres girin (https://...)' }); }
  if (!['http:', 'https:'].includes(url.protocol)) return res.status(400).json({ error: 'Adres http(s) ile başlamalı' });
  const platform = sources.PLATFORMS[b.platform] ? b.platform : sources.detectPlatform(url.href);
  const leadKind = LEAD_KINDS.includes(b.lead_kind) ? b.lead_kind : sources.PLATFORMS[platform].kind || 'freelance';
  const newId = Number(run(`INSERT INTO sources (kind, platform, lead_kind, name, url, link_pattern, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)`,
    kind, platform, leadKind, String(b.name || '').trim() || `${sources.PLATFORMS[platform].label} — ${url.hostname}`, url.href, String(b.link_pattern || '').trim() || null).lastInsertRowid);
  res.json(get('SELECT * FROM sources WHERE id = ?', newId));
});
router.put('/sources/:id', (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.enabled !== undefined) patch.enabled = b.enabled ? 1 : 0;
  if (b.name !== undefined) patch.name = String(b.name).trim();
  if (b.link_pattern !== undefined) patch.link_pattern = String(b.link_pattern).trim() || null;
  if (LEAD_KINDS.includes(b.lead_kind)) patch.lead_kind = b.lead_kind;
  update('sources', id(req), patch);
  res.json(get('SELECT * FROM sources WHERE id = ?', id(req)));
});
router.delete('/sources/:id', (req, res) => { run('DELETE FROM sources WHERE id = ?', id(req)); res.json({ ok: true }); });
router.post('/sources/:id/test', asyncRoute(async (req, res) => {
  const src = get('SELECT * FROM sources WHERE id = ?', id(req));
  if (!src) return res.sendStatus(404);
  try {
    const leads = await sources.fetchSource(src, getSettings().scanner);
    res.json({ count: leads.length, sample: leads.slice(0, 8).map((l) => ({ title: l.title, url: l.url })) });
  } catch (err) { bad(res, err); }
}));
router.post('/sources/:id/scan', asyncRoute(async (req, res) => res.json(await sources.scanSources({ onlyId: id(req) }))));

// --- Leads -------------------------------------------------------------------------------------

const LEAD_STATUSES = ['new', 'filtered_out', 'contacted', 'replied', 'won', 'lost', 'ignored'];
const LEAD_KINDS = ['freelance', 'job'];
const categoryList = () => Object.entries(CATEGORIES).map(([key, c]) => ({ key, label: c.label }));
const leadRow = (l) => {
  const contact = JSON.parse(l.contact || '{}');
  const message = sources.leadMessage(l);
  return {
    ...l, contact, platform_label: sources.PLATFORMS[l.platform]?.label || l.platform, message, whatsapp_link: sources.whatsappLeadLink(l, message),
    foreign: translate.needsTranslation(l.lang),
    category_label: l.category ? categoryLabel(l.category) : null,
    category_labels: (l.categories || '').split(',').filter(Boolean).map(categoryLabel),
  };
};
router.get('/leads', (req, res) => {
  const status = LEAD_STATUSES.includes(req.query.status) ? req.query.status : null;
  const kind = LEAD_KINDS.includes(req.query.kind) ? req.query.kind : 'freelance';
  const scanner = getSettings().scanner;
  res.json({
    kind,
    leads: all(`SELECT * FROM leads WHERE kind = ? AND ${status ? 'status = ?' : `status != 'filtered_out'`}
      ORDER BY CASE status WHEN 'new' THEN 0 ELSE 1 END, created_at DESC, score DESC LIMIT 500`, kind, ...(status ? [status] : [])).map(leadRow),
    counts: Object.fromEntries(all('SELECT status, COUNT(*) AS n FROM leads WHERE kind = ? GROUP BY status', kind).map((r) => [r.status, r.n])),
    categories: categoryList(),
    selected: kind === 'job' ? scanner.job_categories : scanner.freelance_categories,
    locations: scanner.job_locations,
    smtp: Boolean(config.smtp.host),
    scanning: sources.isScanning(),
    platforms: sources.PLATFORMS,
  });
});
// Category picker on the listing pages (operators may change it too).
router.put('/leads/categories', (req, res) => {
  const kind = LEAD_KINDS.includes(req.body?.kind) ? req.body.kind : null;
  if (!kind) return res.status(400).json({ error: 'Tür freelance veya job olmalı' });
  const cats = [].concat(req.body?.categories || []).filter((c) => CATEGORIES[c]);
  const patch = { [kind === 'job' ? 'job_categories' : 'freelance_categories']: cats };
  if (kind === 'job' && req.body?.locations !== undefined) patch.job_locations = [].concat(req.body.locations).map((x) => String(x).trim()).filter(Boolean);
  saveSection('scanner', patch);
  res.json({ ok: true, ...sources.refilterLeads() });
});
router.get('/leads/:id', (req, res) => {
  const lead = get('SELECT * FROM leads WHERE id = ?', id(req));
  if (!lead) return res.sendStatus(404);
  res.json(leadRow(lead));
});
router.post('/leads/scan', asyncRoute(async (_req, res) => res.json(await sources.scanSources())));
router.post('/leads', asyncRoute(async (req, res) => {
  let r;
  try { r = sources.addManualLead(req.body || {}); } catch (err) { return bad(res, err); }
  // A listing saved from a foreign site is translated right away (best effort).
  if (!r.duplicate && getSettings().scanner.translate) {
    const t = await translate.translatePending({ ids: [r.id], limit: 1 });
    if (t.error) r.translate_error = t.error;
  }
  res.json(r);
}));
router.post('/leads/:id/translate', asyncRoute(async (req, res) => {
  try { res.json(leadRow(await translate.translateLead(id(req), { force: true }))); } catch (err) { bad(res, err); }
}));
router.put('/leads/:id', (req, res) => {
  const { status, notes } = req.body || {};
  const patch = {};
  if (status !== undefined) {
    if (!LEAD_STATUSES.includes(status)) return res.status(400).json({ error: 'Geçersiz durum' });
    patch.status = status;
  }
  if (notes !== undefined) patch.notes = String(notes);
  update('leads', id(req), patch);
  res.json(leadRow(get('SELECT * FROM leads WHERE id = ?', id(req))));
});
router.post('/leads/:id/contact', asyncRoute(async (req, res) => {
  try { res.json(leadRow(await sources.contactLead(id(req), { channel: req.body?.channel, message: req.body?.message }))); } catch (err) { bad(res, err); }
}));

// --- Security ---------------------------------------------------------------------------------

router.get('/me', (req, res) => res.json({
  ...security.publicUser(get('SELECT * FROM users WHERE id = ?', req.session.user_id)),
  roles: security.ROLES,
}));
router.get('/security/events', (req, res) => res.json(security.loginEvents({ suspicious: req.query.suspicious === '1' })));
router.get('/security/sessions', (req, res) => res.json({
  current: req.session.id.slice(0, 12),
  sessions: security.listSessions(req.session.user_id),
}));
router.delete('/security/sessions/:sid', (req, res) => {
  const { ip, userAgent } = clientInfo(req);
  try { security.revokeSession(req.session.user_id, req.params.sid, req.session, ip, userAgent); res.json({ ok: true }); } catch (err) { bad(res, err); }
});
router.post('/security/sessions/revoke-others', (req, res) => {
  security.revokeOtherSessions(req.session.user_id, req.session.id);
  res.json({ ok: true });
});
router.post('/security/password', asyncRoute(async (req, res) => {
  const { ip, userAgent } = clientInfo(req);
  try {
    await security.changePassword(req.session, req.body?.current, req.body?.next, ip, userAgent);
    res.json({ ok: true });
  } catch (err) { bad(res, err); }
}));

// --- Two-factor authentication (own account) ------------------------------------------

const own = (fn) => asyncRoute(async (req, res) => {
  const { ip, userAgent } = clientInfo(req);
  try { res.json((await fn(req, ip, userAgent)) ?? { ok: true }); } catch (err) { bad(res, err); }
});
router.post('/security/2fa/setup', own((req) => security.beginTotpSetup(req.session.user_id)));
router.post('/security/2fa/enable', own((req, ip, ua) => security.enableTotp(req.session, req.body?.code, ip, ua)));
router.post('/security/2fa/disable', own((req, ip, ua) => security.disableTotp(req.session, req.body?.password, req.body?.code, ip, ua)));
router.post('/security/2fa/recovery-codes', own((req, ip, ua) => security.regenerateRecoveryCodes(req.session, req.body?.code, ip, ua)));

// --- Team (admins only, enforced by authorize) ------------------------------------------

router.get('/users', (_req, res) => res.json({ users: security.listUsers(), roles: security.ROLES }));
router.post('/users', own(async (req) => ({ id: await security.createUser(req.body || {}) })));
router.put('/users/:id', own((req, ip) => security.updateUser(req.session, id(req), req.body || {}, ip)));
router.post('/users/:id/password', own((req, ip) => security.adminResetPassword(req.session, id(req), req.body?.password, ip)));
router.post('/users/:id/reset-2fa', own((req, ip) => security.resetUserTotp(req.session, id(req), ip)));

// --- Audit log ------------------------------------------------------------------------------

router.get('/audit', (req, res) => res.json(security.auditLog({ q: req.query.q, userId: req.query.user_id ? Number(req.query.user_id) : undefined })));

// --- Scheduled tasks ------------------------------------------------------------------------

router.get('/jobs', (_req, res) => res.json({ jobs: scheduler.listJobs(), runs: scheduler.jobRuns(null, 100) }));
router.get('/jobs/:name/runs', (req, res) => res.json(scheduler.jobRuns(req.params.name)));
router.put('/jobs/:name', (req, res) => {
  try { scheduler.updateJob(req.params.name, req.body || {}); res.json({ ok: true }); } catch (err) { bad(res, err); }
});
router.post('/jobs/:name/run', asyncRoute(async (req, res) => {
  try { res.json(await scheduler.runJob(req.params.name, 'manual')); } catch (err) { bad(res, err); }
}));

// --- Backup & CSV export ----------------------------------------------------------------------

router.get('/backup', asyncRoute(async (req, res) => {
  const dir = dataPath('tmp');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `backup-${Date.now()}.db`);
  getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const { ip } = clientInfo(req);
  await notifyAdmin('security', 'Veritabanı yedeği indirildi', `Kullanıcı: ${req.session.email}\nIP: ${ip}`, '/audit');
  res.download(file, `yedek-${new Date().toISOString().slice(0, 10)}.db`, () => fs.rm(file, { force: true }, () => {}));
}));

const EXPORTS = {
  leads: `SELECT id, kind, platform, category, title, title_tr, company, location, status, score, budget_min, budget_max, currency, salary, url, client_name, contact, created_at, contacted_at, notes FROM leads WHERE status != 'filtered_out' ORDER BY kind, id`,
  prospects: `SELECT id, name, category, address, phone, email, website, score, status, channel, created_at, contacted_at FROM prospects ORDER BY id`,
  customers: 'SELECT id, name, email, phone, platform, notes, created_at FROM customers ORDER BY id',
};

function toCsv(rows) {
  if (!rows.length) return '';
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const keys = Object.keys(rows[0]);
  return [keys.join(';'), ...rows.map((r) => keys.map((k) => cell(r[k])).join(';'))].join('\r\n');
}

router.get('/export/:type.csv', (req, res) => {
  const sql = EXPORTS[req.params.type];
  if (!sql) return res.sendStatus(404);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${req.params.type}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`\ufeff${toCsv(all(sql))}`); // BOM so Excel reads UTF-8 (Turkish characters)
});

// --- Settings -----------------------------------------------------------------------------------

router.get('/settings', (_req, res) => res.json(getSettings()));
router.put('/settings/:section', asyncRoute(async (req, res) => {
  const before = getSettings()[req.params.section];
  let saved;
  const body = { ...(req.body || {}) };
  // A new location must be geocoded again on the next scan.
  if (req.params.section === 'prospecting' && body.location !== undefined && body.location !== before?.location && body.lat === undefined) { body.lat = null; body.lng = null; }
  try { saved = saveSection(req.params.section, body); } catch (err) { return bad(res, err); }
  if (req.params.section === 'scanner') sources.refilterLeads();
  const { ip, userAgent } = clientInfo(req);
  security.logEvent({ userId: req.session.user_id, email: req.session.email, event: 'settings_changed', ip, userAgent, detail: req.params.section });
  // Redirecting the admin's notifications is a classic account-takeover move: always alert.
  if (req.params.section === 'business' && before.admin_email !== saved.admin_email) {
    await notifyAdmin('security', 'Bildirim e-postası değiştirildi', `Admin e-posta: ${before.admin_email} -> ${saved.admin_email}\nIP: ${ip}`, '/settings');
    const { sendMail } = await import('../services/notify.js');
    await sendMail({ to: before.admin_email, subject: 'Admin e-posta adresi değiştirildi', text: `Admin bildirim adresi ${saved.admin_email} olarak değiştirildi. IP: ${ip}` }).catch(() => {});
  }
  res.json(saved);
}));
