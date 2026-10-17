import crypto from 'node:crypto';
import { get, run } from '../db.js';

// Per-installation secret used to sign preview links (kept in the database).
export function appSecret() {
  let row = get(`SELECT value FROM settings WHERE key = '_secret'`);
  if (!row) {
    run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('_secret', ?)`, JSON.stringify(crypto.randomBytes(32).toString('hex')));
    row = get(`SELECT value FROM settings WHERE key = '_secret'`);
  }
  return JSON.parse(row.value);
}

export function sign(value) {
  return crypto.createHmac('sha256', appSecret()).update(value).digest('base64url').slice(0, 32);
}

export function verify(value, signature) {
  const expected = sign(value);
  return typeof signature === 'string' && signature.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
