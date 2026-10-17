import express from 'express';
import { all, get, insert, run, update } from '../db.js';
import { notifyAdmin } from '../services/notify.js';
import * as payments from '../services/payments.js';
import * as projects from '../services/projects.js';
import { aiAnalysis, invoicePdf, monthlyPdf, monthStats, productPerformance, trend } from '../services/reports.js';
import { adminSend, releaseToAi, takeover } from '../services/sales.js';
import { scanPlatforms } from '../services/scanner.js';
import * as security from '../services/security.js';
import { PLATFORMS } from '../services/platforms/index.js';
import { getSettings, saveSection } from '../services/settings.js';
import { monthTokenUsage } from '../services/ai.js';
import { asyncRoute, clientInfo, requireAuth } from './util.js';

export const router = express.Router();
router.use(requireAuth);

const id = (req) => Number(req.params.id);
const bad = (res, err) => res.status(400).json({ error: err.message });

// --- Dashboard & reports ------------------------------------------------------

router.get('/dashboard', (req, res) => {
  res.json({
    stats: monthStats(req.query.month),
    trend: trend(12),
    products: productPerformance(),
    ai_tokens_this_month: monthTokenUsage(),
    open_escalations: get(`SELECT COUNT(*) AS n FROM conversations WHERE status = 'escalated'`).n,
    projects_waiting_review: get(`SELECT COUNT(*) AS n FROM projects WHERE status IN ('review','changes_requested','build_failed')`).n,
    unread_notifications: get('SELECT COUNT(*) AS n FROM notifications WHERE read = 0').n,
  });
});

router.post('/dashboard/analysis', asyncRoute(async (req, res) => {
  try {
    res.json({ analysis: await aiAnalysis(req.body?.month) });
  } catch (err) {
    bad(res, err);
  }
}));

router.get('/reports/monthly.pdf', asyncRoute(async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  let analysis = '';
  if (req.query.analysis === '1') {
    try { analysis = await aiAnalysis(month); } catch (err) { analysis = `Analiz alınamadı: ${err.message}`; }
  }
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="ozet-${month}.pdf"`);
  monthlyPdf(month, res, analysis);
}));

// --- Notifications --------------------------------------------------------------

router.get('/notifications', (_req, res) => res.json(all('SELECT * FROM notifications ORDER BY id DESC LIMIT 200')));
router.post('/notifications/read-all', (_req, res) => { run('UPDATE notifications SET read = 1'); res.json({ ok: true }); });
router.post('/notifications/:id/read', (req, res) => { update('notifications', id(req), { read: 1 }); res.json({ ok: true }); });

// --- Conversations ----------------------------------------------------------------

router.get('/conversations', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) { where.push('c.status = ?'); params.push(req.query.status); }
  if (req.query.mode) { where.push('c.mode = ?'); params.push(req.query.mode); }
  res.json(all(`SELECT c.*, cu.name AS customer_name, cu.phone, cu.email,
                  (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message
                FROM conversations c LEFT JOIN customers cu ON cu.id = c.customer_id
                ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                ORDER BY c.last_message_at DESC LIMIT 300`, ...params));
});

router.get('/conversations/:id', (req, res) => {
  const conv = get('SELECT * FROM conversations WHERE id = ?', id(req));
  if (!conv) return res.sendStatus(404);
  res.json({
    conversation: conv,
    customer: get('SELECT * FROM customers WHERE id = ?', conv.customer_id),
    project: conv.project_id ? projects.getProject(conv.project_id) : null,
    messages: all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id', conv.id),
  });
});

router.post('/conversations/:id/takeover', asyncRoute(async (req, res) => { await takeover(id(req)); res.json({ ok: true }); }));
router.post('/conversations/:id/release', asyncRoute(async (req, res) => { await releaseToAi(id(req)); res.json({ ok: true }); }));
router.post('/conversations/:id/close', (req, res) => { update('conversations', id(req), { status: 'closed' }); res.json({ ok: true }); });
router.post('/conversations/:id/messages', asyncRoute(async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Mesaj boş olamaz' });
  try { await adminSend(id(req), text); res.json({ ok: true }); } catch (err) { bad(res, err); }
}));

// --- Customers ----------------------------------------------------------------------

router.get('/customers', (_req, res) => res.json(all(`
  SELECT cu.*, (SELECT COUNT(*) FROM projects p WHERE p.customer_id = cu.id) AS project_count,
    (SELECT COALESCE(SUM(amount - refunded_amount), 0) FROM payments pay WHERE pay.customer_id = cu.id AND pay.status IN ('paid','partially_refunded')) AS total_paid
  FROM customers cu ORDER BY cu.id DESC`)));
router.put('/customers/:id', (req, res) => {
  const { name, email, phone, notes } = req.body || {};
  update('customers', id(req), { name, email, phone, notes });
  res.json(get('SELECT * FROM customers WHERE id = ?', id(req)));
});

// --- Catalog CRUD (products, themes, languages) -------------------------------------

function crud(table, fields) {
  const pick = (body) => Object.fromEntries(fields.filter((f) => body?.[f] !== undefined).map((f) => [f, body[f]]));
  router.get(`/${table}`, (_req, res) => res.json(all(`SELECT * FROM ${table} ORDER BY id DESC`)));
  router.post(`/${table}`, (req, res) => {
    if (!req.body?.name) return res.status(400).json({ error: 'İsim zorunlu' });
    res.json(get(`SELECT * FROM ${table} WHERE id = ?`, insert(table, pick(req.body))));
  });
  router.put(`/${table}/:id`, (req, res) => {
    update(table, id(req), pick(req.body));
    res.json(get(`SELECT * FROM ${table} WHERE id = ?`, id(req)));
  });
  router.delete(`/${table}/:id`, (req, res) => {
    // Soft delete keeps historical projects/conversations consistent.
    update(table, id(req), { active: 0 });
    res.json({ ok: true });
  });
}
crud('products', ['name', 'description', 'category', 'price', 'currency', 'features', 'demo_url', 'image_url', 'active']);
crud('themes', ['name', 'description', 'preview_url', 'style_guide', 'active']);
crud('languages', ['name', 'description', 'active']);

// --- Leads / platform scanning ---------------------------------------------------------

router.get('/platforms', (_req, res) => res.json(Object.values(PLATFORMS).map((p) => ({ name: p.name, label: p.label }))));
router.get('/leads', (req, res) => {
  const status = req.query.status;
  res.json(all(`SELECT * FROM leads ${status ? 'WHERE status = ?' : ''} ORDER BY id DESC LIMIT 300`, ...(status ? [status] : [])));
});
router.post('/leads/scan', asyncRoute(async (_req, res) => res.json(await scanPlatforms())));
router.put('/leads/:id', (req, res) => {
  const { status } = req.body || {};
  if (!['new', 'filtered_out', 'contacted', 'needs_admin', 'won', 'lost'].includes(status)) return res.status(400).json({ error: 'Geçersiz durum' });
  update('leads', id(req), { status });
  res.json({ ok: true });
});
router.post('/leads/:id/project', asyncRoute(async (req, res) => {
  const lead = get('SELECT * FROM leads WHERE id = ?', id(req));
  if (!lead) return res.sendStatus(404);
  const customerId = lead.customer_id ?? insert('customers', { name: lead.client_name || `${lead.platform} müşterisi`, platform: lead.platform });
  const projectId = await projects.createProject({
    customerId, conversationId: lead.conversation_id, leadId: lead.id,
    title: req.body?.title || lead.title,
    requirements: req.body?.requirements || lead.description,
    themeId: req.body?.theme_id || null, languageId: req.body?.language_id || null,
    price: Number(req.body?.price || lead.budget_max || 0), currency: req.body?.currency || lead.currency,
  });
  res.json({ id: projectId });
}));

// --- Projects ----------------------------------------------------------------------------

router.get('/projects', (_req, res) => res.json(projects.listProjects()));
router.post('/projects', asyncRoute(async (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.customer_id) return res.status(400).json({ error: 'Başlık ve müşteri zorunlu' });
  res.json({ id: await projects.createProject({
    customerId: Number(b.customer_id), conversationId: b.conversation_id || null, title: b.title, requirements: b.requirements || '',
    themeId: b.theme_id || null, languageId: b.language_id || null, price: Number(b.price || 0), currency: b.currency,
  }) });
}));
router.get('/projects/:id', (req, res) => {
  const project = projects.getProject(id(req));
  if (!project) return res.sendStatus(404);
  res.json({
    project,
    status_label: projects.STATUS_LABELS[project.status],
    building: projects.isBuilding(project.id),
    versions: all('SELECT * FROM project_versions WHERE project_id = ? ORDER BY version DESC', project.id)
      .map((v) => ({ ...v, preview_url: projects.previewUrl(project.id, v.version) })),
    events: all('SELECT * FROM project_events WHERE project_id = ? ORDER BY id DESC', project.id),
    files: project.current_version ? projects.readVersionFiles(project.id, project.current_version).map((f) => ({ path: f.path, size: f.content.length })) : [],
    payments: all('SELECT * FROM payments WHERE project_id = ? ORDER BY id DESC', project.id),
  });
});
router.put('/projects/:id', (req, res) => {
  const b = req.body || {};
  const patch = Object.fromEntries(['title', 'requirements', 'theme_id', 'language_id', 'price', 'currency'].filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
  update('projects', id(req), patch);
  res.json(projects.getProject(id(req)));
});

const action = (fn) => asyncRoute(async (req, res) => {
  try { res.json({ ok: true, result: await fn(req) ?? null }); } catch (err) { bad(res, err); }
});
router.post('/projects/:id/feedback', action((req) => {
  const fb = String(req.body?.feedback || '').trim();
  if (!fb) throw new Error('Düzeltme notu boş olamaz');
  projects.submitFeedback(id(req), fb);
}));
router.post('/projects/:id/rebuild', action((req) => { projects.rebuild(id(req)); }));
router.post('/projects/:id/approve', action((req) => projects.approve(id(req))));
router.post('/projects/:id/deploy', action((req) => projects.deployDemo(id(req))));
router.post('/projects/:id/customer-approved', action((req) => {
  const p = projects.getProject(id(req));
  if (p?.status !== 'demo_live') throw new Error('Proje demo aşamasında değil');
  return projects.customerApproved(id(req));
}));
router.post('/projects/:id/payment-request', action((req) => payments.createPaymentRequest(id(req))));
router.post('/projects/:id/deliver', action((req) => projects.markDelivered(id(req))));
router.post('/projects/:id/cancel', action((req) => {
  run(`UPDATE projects SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, id(req));
  projects.logEvent(id(req), 'status', 'Proje iptal edildi');
}));
router.get('/projects/:id/files/*file', (req, res) => {
  const p = projects.getProject(id(req));
  if (!p?.current_version) return res.sendStatus(404);
  const rel = [].concat(req.params.file).join('/');
  const file = projects.readVersionFiles(p.id, p.current_version).find((f) => f.path === rel);
  if (!file) return res.sendStatus(404);
  res.type('text/plain').send(file.content);
});

// --- Payments, refunds, invoices, expenses ------------------------------------------------

router.get('/payments', (_req, res) => res.json(payments.listPayments()));
router.get('/payments/:id', (req, res) => {
  const payment = get('SELECT * FROM payments WHERE id = ?', id(req));
  if (!payment) return res.sendStatus(404);
  res.json({
    payment,
    refunds: all('SELECT * FROM refunds WHERE payment_id = ? ORDER BY id', payment.id),
    invoices: all('SELECT * FROM invoices WHERE payment_id = ? ORDER BY id', payment.id),
    instructions: payments.paymentInstructions(payment),
  });
});
router.post('/payments/:id/mark-paid', action((req) => payments.markPaid(id(req), { note: req.body?.note || 'Manuel onay' })));
router.post('/payments/:id/cancel', action((req) => payments.cancelPayment(id(req))));
router.post('/payments/:id/refund', action(async (req) => {
  const { ip, userAgent } = clientInfo(req);
  const result = await payments.refund(id(req), req.body?.amount, req.body?.reason, req.session.user_id);
  security.logEvent({ userId: req.session.user_id, email: req.session.email, event: 'refund', ip, userAgent, detail: `Ödeme #${id(req)}: ${req.body?.amount || 'tamamı'}` });
  return result;
}));

router.get('/invoices', (_req, res) => res.json(all(`SELECT i.*, c.name AS customer_name, p.title AS project_title FROM invoices i
  LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN projects p ON p.id = i.project_id ORDER BY i.id DESC`)));
router.get('/invoices/:id/pdf', (req, res) => {
  const inv = get('SELECT number FROM invoices WHERE id = ?', id(req));
  if (!inv) return res.sendStatus(404);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="${inv.number}.pdf"`);
  invoicePdf(id(req), res);
});

router.get('/expenses', (_req, res) => res.json(all('SELECT * FROM expenses ORDER BY id DESC LIMIT 500')));
router.post('/expenses', (req, res) => {
  const { category = 'other', amount, currency, description = '' } = req.body || {};
  if (!(Number(amount) > 0)) return res.status(400).json({ error: 'Tutar sıfırdan büyük olmalı' });
  res.json({ id: insert('expenses', { category, amount: Number(amount), currency: currency || getSettings().business.base_currency, description }) });
});
router.delete('/expenses/:id', (req, res) => { run('DELETE FROM expenses WHERE id = ?', id(req)); res.json({ ok: true }); });
router.get('/ai-usage', (_req, res) => res.json(all(`SELECT date(created_at) AS day, purpose, SUM(input_tokens) AS input_tokens,
  SUM(output_tokens) AS output_tokens, ROUND(SUM(cost_usd), 4) AS cost_usd FROM ai_usage
  WHERE created_at >= datetime('now', '-30 days') GROUP BY day, purpose ORDER BY day DESC`)));

// --- Security ---------------------------------------------------------------------------------

router.get('/security/events', (_req, res) => res.json(security.loginEvents()));
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

// --- Settings -----------------------------------------------------------------------------------

router.get('/settings', (_req, res) => res.json(getSettings()));
router.put('/settings/:section', asyncRoute(async (req, res) => {
  const before = getSettings()[req.params.section];
  let saved;
  try { saved = saveSection(req.params.section, req.body || {}); } catch (err) { return bad(res, err); }
  const { ip, userAgent } = clientInfo(req);
  security.logEvent({ userId: req.session.user_id, email: req.session.email, event: 'settings_changed', ip, userAgent, detail: req.params.section });
  // Changing where money goes is the classic account-takeover move: always alert.
  if (req.params.section === 'business' && (before.iban !== saved.iban || before.admin_email !== saved.admin_email)) {
    await notifyAdmin('security', 'Ödeme/iletişim bilgileri değiştirildi',
      `IBAN: ${before.iban || '-'} -> ${saved.iban || '-'}\nAdmin e-posta: ${before.admin_email} -> ${saved.admin_email}\nIP: ${ip}`, '/settings');
    if (before.admin_email !== saved.admin_email) {
      const { sendMail } = await import('../services/notify.js');
      await sendMail({ to: before.admin_email, subject: 'Admin e-posta adresi değiştirildi', text: `Admin bildirim adresi ${saved.admin_email} olarak değiştirildi. IP: ${ip}` }).catch(() => {});
    }
  }
  res.json(saved);
}));
