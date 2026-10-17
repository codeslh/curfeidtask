import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get } from '../db.js';
import { config } from '../config.js';
import { handleStripeEvent, verifyStripeSignature } from '../services/payments.js';
import { demoDir, safeJoin, versionDir } from '../services/projects.js';
import { verify } from '../services/secret.js';
import { catalog, findOrCreateConversation, handleIncoming } from '../services/sales.js';
import { getSection } from '../services/settings.js';
import { parseWebhook, verifySignature } from '../services/whatsapp.js';
import { asyncRoute } from './util.js';

export const router = express.Router();

// AI-generated sites are served under a sandboxed CSP: they run in an opaque origin
// and cannot read the admin panel's cookies or call its API with credentials.
export function sendSandboxed(res, root, rel) {
  const file = safeJoin(root, rel || 'index.html');
  if (!file || !fs.existsSync(file)) return res.status(404).send('Bulunamadı');
  const target = fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
  if (!fs.existsSync(target)) return res.status(404).send('Bulunamadı');
  res.set('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-popups allow-modals');
  res.set('X-Content-Type-Options', 'nosniff');
  res.sendFile(target);
}

router.get(['/demo/:slug', '/demo/:slug/*rest'], (req, res) => {
  if (!req.path.endsWith('/') && !req.params.rest) return res.redirect(301, `${req.path}/`);
  const project = get('SELECT id FROM projects WHERE demo_slug = ?', req.params.slug);
  if (!project) return res.status(404).send('Demo bulunamadı');
  sendSandboxed(res, demoDir(req.params.slug), [].concat(req.params.rest || []).join('/'));
});

// Version previews for the admin; the signature in the path replaces the session cookie.
router.get(['/preview/:id/:version/:sig', '/preview/:id/:version/:sig/*rest'], (req, res) => {
  const { id, version, sig } = req.params;
  if (!verify(`${Number(id)}:${Number(version)}`, sig)) return res.status(403).send('Geçersiz önizleme bağlantısı');
  if (!req.path.endsWith('/') && !req.params.rest) return res.redirect(301, `${req.path}/`);
  sendSandboxed(res, versionDir(Number(id), Number(version)), [].concat(req.params.rest || []).join('/'));
});

// --- WhatsApp Cloud API webhook --------------------------------------------

router.get('/webhooks/whatsapp', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.whatsapp.verifyToken) {
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

router.post('/webhooks/whatsapp', asyncRoute(async (req, res) => {
  if (!verifySignature(req.rawBody || '', req.get('x-hub-signature-256'))) return res.sendStatus(401);
  res.sendStatus(200); // acknowledge fast; Meta retries slow webhooks
  for (const m of parseWebhook(req.body)) {
    try {
      await handleIncoming({ channel: 'whatsapp', externalId: m.from, name: m.name, phone: m.from, text: m.text });
    } catch (err) {
      console.error('WhatsApp mesajı işlenemedi:', err);
    }
  }
}));

// --- Stripe webhook -----------------------------------------------------------

router.post('/webhooks/stripe', asyncRoute(async (req, res) => {
  if (!verifyStripeSignature(req.rawBody || '', req.get('stripe-signature'))) return res.sendStatus(400);
  await handleStripeEvent(req.body);
  res.json({ received: true });
}));

router.get('/pay/success', (_req, res) => res.send('<meta charset="utf-8"><h2>Ödemeniz alındı, teşekkürler!</h2>'));
router.get('/pay/cancel', (_req, res) => res.send('<meta charset="utf-8"><h2>Ödeme iptal edildi.</h2>'));

// --- Website chat widget (customer side) ---------------------------------------

router.get('/api/chat/info', (_req, res) => {
  const { themes, languages, products } = catalog();
  res.json({
    business: getSection('business').name,
    shortcuts: {
      themes: themes.map((t) => ({ id: t.id, name: t.name, preview_url: t.preview_url })),
      languages: languages.map((l) => ({ id: l.id, name: l.name })),
      products: products.map((p) => ({ id: p.id, name: p.name, demo_url: p.demo_url })),
    },
  });
});

router.post('/api/chat/start', (req, res) => {
  const token = crypto.randomBytes(18).toString('base64url');
  const name = String(req.body?.name || '').slice(0, 80);
  const email = String(req.body?.email || '').slice(0, 120) || null;
  findOrCreateConversation({ channel: 'web', externalId: token, name: name || 'Web ziyaretçisi', email });
  res.json({ token });
});

function webConversation(token) {
  return get(`SELECT * FROM conversations WHERE channel = 'web' AND external_id = ?`, token);
}

router.get('/api/chat/:token/messages', (req, res) => {
  const conv = webConversation(req.params.token);
  if (!conv) return res.status(404).json({ error: 'Sohbet bulunamadı' });
  const after = Number(req.query.after || 0);
  res.json({
    mode: conv.mode,
    messages: all(`SELECT id, sender, body, created_at FROM messages WHERE conversation_id = ? AND id > ? AND sender != 'system' ORDER BY id`, conv.id, after),
  });
});

router.post('/api/chat/:token/messages', asyncRoute(async (req, res) => {
  const conv = webConversation(req.params.token);
  if (!conv) return res.status(404).json({ error: 'Sohbet bulunamadı' });
  const text = String(req.body?.text || '').trim().slice(0, 4000);
  if (!text) return res.status(400).json({ error: 'Mesaj boş olamaz' });
  const result = await handleIncoming({ channel: 'web', externalId: req.params.token, text });
  res.json(result);
}));
