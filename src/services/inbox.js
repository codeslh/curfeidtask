// Conversations with the people you contacted: replies come in by e-mail (IMAP),
// WhatsApp (Cloud API webhook) or are pasted by hand; you answer them yourself.
import { get, insert, run, update } from '../db.js';
import { notifyAdmin, sendMail } from './notify.js';
import { getSection } from './settings.js';
import { sendWhatsApp, whatsappApiReady } from './whatsapp.js';

// Imported lazily to avoid a circular import (prospecting -> inbox -> prospecting).
const prospecting = () => import('./prospecting.js');

export function findOrCreateConversation({ channel, externalId, name = '', email = null, phone = null, platform = null }) {
  const conv = externalId
    ? get(`SELECT * FROM conversations WHERE channel = ? AND external_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 1`, channel, externalId)
    : null;
  if (conv) return conv;
  let customer = phone ? get('SELECT * FROM customers WHERE phone = ?', phone) : null;
  customer ??= email ? get('SELECT * FROM customers WHERE lower(email) = lower(?)', email) : null;
  const customerId = customer?.id ?? insert('customers', { name: name || phone || email || 'Kişi', email, phone, platform });
  const id = insert('conversations', { customer_id: customerId, channel, external_id: externalId, mode: 'human' });
  return get('SELECT * FROM conversations WHERE id = ?', id);
}

export function addMessage(conversationId, sender, body, meta = null) {
  const id = insert('messages', { conversation_id: conversationId, sender, body, meta: meta ? JSON.stringify(meta) : null });
  run(`UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?`, conversationId);
  return id;
}

/** Subject of the first e-mail we sent in this conversation, so replies stay in one thread. */
function threadSubject(convId) {
  const first = get(`SELECT meta FROM messages WHERE conversation_id = ? AND sender = 'admin' AND meta LIKE '%"subject"%' ORDER BY id LIMIT 1`, convId);
  const subject = first ? JSON.parse(first.meta).subject : null;
  return subject ? `Re: ${subject.replace(/^Re:\s*/i, '')}` : getSection('business').name;
}

/**
 * Send `text` through the conversation's channel.
 * Returns { delivered, relay } — relay=true means WhatsApp without the Cloud API:
 * the panel shows a wa.me link and you press send on your own phone.
 */
export async function deliver(conv, text, subject) {
  const customer = get('SELECT * FROM customers WHERE id = ?', conv.customer_id);
  if (conv.channel === 'whatsapp') {
    if (!whatsappApiReady()) return { delivered: false, relay: true };
    await sendWhatsApp(conv.external_id, text);
    return { delivered: true };
  }
  if (conv.channel === 'email' && customer?.email) {
    const sent = await sendMail({ to: customer.email, subject: subject || threadSubject(conv.id), text });
    return { delivered: sent };
  }
  return { delivered: false };
}

/** Admin reply from the panel. */
export async function adminSend(convId, text, { subject } = {}) {
  const conv = get('SELECT * FROM conversations WHERE id = ?', convId);
  if (!conv) throw new Error('Konuşma bulunamadı');
  if (conv.status === 'closed') update('conversations', conv.id, { status: 'open' });
  let result;
  try {
    result = await deliver(conv, text, subject);
  } catch (err) {
    throw new Error(`Mesaj gönderilemedi: ${err.message}`);
  }
  addMessage(conv.id, 'admin', text, subject ? { subject } : null);
  return result;
}

/** Entry point for every inbound message (WhatsApp webhook, IMAP). */
export async function handleIncoming({ channel, externalId, name, email, phone, text }) {
  const conv = findOrCreateConversation({ channel, externalId, name, email, phone });
  return handleInConversation(conv, text);
}

/** Store a reply for a known conversation (also used for hand-pasted WhatsApp messages). */
export async function handleInConversation(conv, text) {
  addMessage(conv.id, 'customer', text);
  if (conv.status === 'closed') update('conversations', conv.id, { status: 'open' });
  const customer = get('SELECT * FROM customers WHERE id = ?', conv.customer_id);
  const out = (await prospecting()).onInboundMessage(conv, customer, text);
  if (out.optedOut) {
    update('conversations', conv.id, { status: 'closed' });
    addMessage(conv.id, 'system', 'Kişi İPTAL yazdı; telefonu/e-postası kalıcı olarak engellendi.');
    return { conversationId: conv.id, optedOut: true };
  }
  // Leads we wrote to are marked as answered.
  run(`UPDATE leads SET status = 'replied' WHERE conversation_id = ? AND status IN ('new', 'contacted')`, conv.id);
  if (!out.prospect) {
    await notifyAdmin('customer_message', `Yeni mesaj: ${customer?.name || '#' + conv.id}`, text, `/conversations/${conv.id}`);
  }
  return { conversationId: conv.id };
}
