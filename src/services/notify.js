import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { insert, update } from '../db.js';
import { getSection } from './settings.js';

let transport;
function getTransport() {
  if (!config.smtp.host) return null;
  transport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transport;
}

export async function sendMail({ to, subject, text, attachments }) {
  const t = getTransport();
  if (!t) {
    console.log(`[mail:dev] -> ${to} | ${subject}\n${text}\n`);
    return false;
  }
  await t.sendMail({ from: config.smtp.from, to, subject, text, attachments });
  return true;
}

/**
 * Record an admin notification (always visible in the panel) and e-mail it.
 * Never throws: a mail failure must not break the flow that triggered it.
 */
export async function notifyAdmin(type, subject, body, link) {
  const id = insert('notifications', { type, subject, body, link });
  const fullLink = link ? `${config.publicUrl}/#${link}` : '';
  try {
    const sent = await sendMail({
      to: getSection('business').admin_email,
      subject: `[${getSection('business').name}] ${subject}`,
      text: `${body}${fullLink ? `\n\nPanelde aç: ${fullLink}` : ''}`,
    });
    if (sent) update('notifications', id, { emailed: 1 });
  } catch (err) {
    console.error('Admin e-postası gönderilemedi:', err.message);
  }
  return id;
}
