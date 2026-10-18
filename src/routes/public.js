import express from 'express';
import { config } from '../config.js';
import { handleIncoming } from '../services/inbox.js';
import { parseWebhook, verifySignature } from '../services/whatsapp.js';
import { asyncRoute } from './util.js';

export const router = express.Router();

// --- WhatsApp Cloud API webhook (only reachable when Kalfa is on a public address) ---

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
