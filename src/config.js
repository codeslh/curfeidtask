import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

// Minimal .env loader (no dependency). Existing env vars win.
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadEnv(path.join(ROOT, '.env'));

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  dbFile: env.DB_FILE || '',
  sessionDays: Number(env.SESSION_DAYS || 7),

  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === '1',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || 'Kalfa <no-reply@localhost>',
  },

  whatsapp: {
    token: env.WHATSAPP_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || 'dev-verify-token',
    appSecret: env.WHATSAPP_APP_SECRET || '',
    // Approved template for business-initiated (first) messages, e.g. "kalfa_tanisma".
    outreachTemplate: env.WHATSAPP_OUTREACH_TEMPLATE || '',
    templateLang: env.WHATSAPP_TEMPLATE_LANG || 'tr',
  },

  // Listing sources are scanned by the "İş ilanı taraması" scheduled task.
  scanner: {
    enabled: env.SCANNER_ENABLED !== '0',
    intervalMinutes: Number(env.SCANNER_INTERVAL_MINUTES || 30),
  },

  // Business prospecting: OpenStreetMap needs no key; Google Places is optional.
  googlePlacesKey: env.GOOGLE_PLACES_API_KEY || '',
  overpassUrl: env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  nominatimUrl: env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',

  // Translating foreign listings to Turkish (see services/translate.js). Nothing set = free MyMemory.
  translate: {
    deeplKey: env.DEEPL_API_KEY || '',
    libreUrl: env.LIBRETRANSLATE_URL || '',
    libreKey: env.LIBRETRANSLATE_API_KEY || '',
  },

  // Inbound e-mail (replies from customers/prospects) — polled, so it works on a laptop.
  imap: {
    host: env.IMAP_HOST || '',
    port: Number(env.IMAP_PORT || 993),
    secure: env.IMAP_SECURE !== '0',
    user: env.IMAP_USER || env.SMTP_USER || '',
    pass: env.IMAP_PASS || env.SMTP_PASS || '',
  },

  admin: {
    email: env.ADMIN_EMAIL || 'admin@example.com',
    password: env.ADMIN_PASSWORD || '',
    name: env.ADMIN_NAME || 'Admin',
  },
};

export function dataPath(...parts) {
  return path.join(config.dataDir, ...parts);
}
