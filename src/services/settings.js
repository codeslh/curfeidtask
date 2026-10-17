import { all, run } from '../db.js';

// Every admin-editable setting with its default. Stored as JSON in the settings table.
export const DEFAULTS = {
  business: {
    name: 'Freelance Stüdyo',
    owner_name: 'Admin',
    admin_email: 'admin@example.com',
    base_currency: 'TRY',
    tax_rate: 20,
    fx_rates: { TRY: 1, USD: 41, EUR: 47 },   // 1 unit = X base currency
    iban: '',
    iban_holder: '',
    bank_name: '',
  },
  ai: {
    enabled: true,
    sales_persona: 'Güler yüzlü, çözüm odaklı, ikna edici ama dürüst bir satış temsilcisi.',
    max_discount_percent: 10,
    monthly_token_budget: 2000000,           // input+output tokens; 0 = unlimited
    escalate_after_unsatisfied: 2,            // consecutive unsatisfied customer turns
    auto_build: true,                         // start building as soon as a project is won
  },
  scanner: {
    enabled_platforms: ['mock'],
    keywords: ['web sitesi', 'website', 'landing page', 'e-ticaret'],
    exclude_keywords: ['wordpress eklenti', 'kripto'],
    min_budget: 0,
    max_budget: 0,                            // 0 = no upper bound
    currencies: [],                           // empty = any
    max_age_hours: 72,
    max_leads_per_scan: 20,
    rss_feeds: [],                            // [{name, url}]
  },
  payments: {
    provider: 'iban',                         // iban | stripe
    send_iban_automatically: true,
    payment_due_days: 7,
  },
  security: {
    max_failed_logins: 5,                     // per email in 15 minutes -> alert + lockout
    alert_on_new_ip: true,
  },
};

export function getSettings() {
  const stored = Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, JSON.parse(r.value)]));
  const out = {};
  for (const [section, defaults] of Object.entries(DEFAULTS)) {
    out[section] = { ...defaults, ...(stored[section] || {}) };
  }
  return out;
}

export function getSection(section) {
  return getSettings()[section];
}

export function saveSection(section, patch) {
  if (!DEFAULTS[section]) throw new Error(`Bilinmeyen ayar bölümü: ${section}`);
  const merged = { ...getSection(section) };
  for (const key of Object.keys(DEFAULTS[section])) {
    if (patch[key] !== undefined) merged[key] = patch[key];
  }
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    section, JSON.stringify(merged));
  return merged;
}

// Convert an amount in `currency` into the business base currency.
export function toBase(amount, currency) {
  const { fx_rates, base_currency } = getSection('business');
  if (!currency || currency === base_currency) return amount;
  const rate = fx_rates[currency];
  return rate ? amount * rate : amount;
}
