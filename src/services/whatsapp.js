import crypto from 'node:crypto';
import { config } from '../config.js';

// WhatsApp Business Cloud API (Meta). Without credentials messages are only logged.
export async function sendWhatsApp(to, body) {
  const { token, phoneNumberId } = config.whatsapp;
  if (!token || !phoneNumberId) {
    console.log(`[whatsapp:dev] -> ${to}: ${body}`);
    return { delivered: false };
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  });
  if (!res.ok) throw new Error(`WhatsApp gönderimi başarısız: ${res.status} ${await res.text()}`);
  return { delivered: true };
}

export function verifySignature(rawBody, header) {
  if (!config.whatsapp.appSecret) return true;
  if (!header?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', config.whatsapp.appSecret).update(rawBody).digest('hex');
  const given = header.slice(7);
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Flatten a webhook payload into [{from, name, text}] for text messages. */
export function parseWebhook(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const names = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const msg of value.messages || []) {
        const text = msg.type === 'text' ? msg.text?.body
          : msg.type === 'button' ? msg.button?.text
          : msg.type === 'interactive' ? (msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title)
          : `[${msg.type} mesajı alındı]`;
        if (text) out.push({ from: msg.from, name: names[msg.from] || '', text, id: msg.id });
      }
    }
  }
  return out;
}
