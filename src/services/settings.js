import { all, run } from '../db.js';

// Every admin-editable setting with its default. Stored as JSON in the settings table.
export const DEFAULTS = {
  business: {
    name: 'Stüdyom',                          // shown to customers; set your own in Ayarlar → İşletme
    owner_name: 'Admin',
    admin_email: 'admin@example.com',
    base_currency: 'TRY',
    tax_rate: 20,
    fx_rates: { TRY: 1, USD: 41, EUR: 47 },   // 1 unit = X base currency
    iban: '',
    iban_holder: '',
    bank_name: '',
    timezone: 'Europe/Istanbul',              // used by daily/monthly scheduled tasks
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
    max_failed_per_ip: 20,                    // any account, per IP in 15 minutes -> IP blocked + alert
    alert_on_new_ip: true,
    require_2fa_for_admins: false,            // admins without 2FA are sent to the setup screen
    idle_timeout_minutes: 120,                // 0 = only the absolute session lifetime applies
    allowed_ips: [],                          // empty = any IP may use the panel
    large_refund_amount: 5000,                // base currency; larger refunds raise a security alert
    max_refunds_per_day: 3,                   // more refunds than this in 24h raise an alert
    audit_retention_days: 365,
  },
  automation: {
    payment_reminder_days: 2,                 // remind the customer every N days while unpaid
    payment_max_reminders: 3,
    followup_after_hours: 24,                 // AI follows up a silent customer after N hours
    followup_max: 1,
    escalation_renotify_minutes: 120,         // re-alert the admin about untouched escalations
    token_budget_warn_percent: 80,
    backup_keep: 14,                          // daily backups to keep
    notification_retention_days: 90,
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
