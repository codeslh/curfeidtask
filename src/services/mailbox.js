// Polls the IMAP inbox so customers/prospects can reply by e-mail — no public URL needed.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config } from '../config.js';
import { get } from '../db.js';
import { handleIncoming } from './inbox.js';

export const mailboxReady = () => Boolean(config.imap.host && config.imap.user && config.imap.pass);

/** Strip quoted history/signatures so the AI only sees what the person just wrote. */
export function cleanReply(text = '') {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const out = [];
  for (const line of lines) {
    if (/^>/.test(line)) break;
    if (/^(On|Am|Le)\s.+(wrote|schrieb|écrit):\s*$/i.test(line) || /tarihinde .+ şunu yazdı:?\s*$/i.test(line) || /^-{2,}\s*(Original|Orijinal|Özgün)/i.test(line)) break;
    if (/^--\s*$/.test(line)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

/** Turn one parsed e-mail into an inbound conversation message. Returns true if handled. */
export async function processParsedMail(mail) {
  const from = mail.from?.value?.[0];
  if (!from?.address) return false;
  const address = from.address.toLowerCase();
  if (address === (config.smtp.user || '').toLowerCase() || /no-?reply|mailer-daemon|postmaster/i.test(address)) return false;
  // Only accept mail from people we already talk to, so the inbox doesn't turn every newsletter into a lead.
  const known = get(`SELECT id FROM customers WHERE lower(email) = ?`, address) || get(`SELECT id FROM prospects WHERE lower(email) = ?`, address);
  if (!known) return false;
  const text = cleanReply(mail.text || '');
  if (!text) return false;
  await handleIncoming({ channel: 'email', externalId: address, name: from.name || address, email: address, text: text.slice(0, 4000) });
  return true;
}

export async function pollMailbox() {
  if (!mailboxReady()) return { skipped: true, reason: 'IMAP ayarlı değil' };
  const client = new ImapFlow({
    host: config.imap.host, port: config.imap.port, secure: config.imap.secure,
    auth: { user: config.imap.user, pass: config.imap.pass }, logger: false,
  });
  let handled = 0; let seen = 0;
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const uids = await client.search({ seen: false }, { uid: true });
    for (const uid of (uids || []).slice(0, 50)) {
      const msg = await client.fetchOne(uid, { source: true }, { uid: true });
      seen++;
      const mail = await simpleParser(msg.source);
      if (await processParsedMail(mail)) {
        handled++;
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return { seen, handled };
}
