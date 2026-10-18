import { all, run } from '../db.js';

// Every admin-editable setting with its default. Stored as JSON in the settings table.
export const DEFAULTS = {
  business: {
    name: 'Stüdyom',                          // used in message signatures; set your own in Ayarlar → İşletme
    owner_name: 'Admin',
    admin_email: 'admin@example.com',
    phone: '',
    website: '',
    base_currency: 'TRY',
    fx_rates: { TRY: 1, USD: 41, EUR: 47 },   // 1 unit = X base currency (for budget filters)
    timezone: 'Europe/Istanbul',              // used by daily scheduled tasks
  },
  scanner: {
    // Categories from services/categories.js; empty = every listing.
    freelance_categories: ['web', 'ecommerce', 'wordpress'],
    job_categories: ['web', 'software'],
    extra_keywords: [],                       // optional own terms, matched in addition to the categories
    exclude_keywords: ['kripto', 'crypto', 'bahis', 'casino'],
    job_locations: [],                        // e.g. İstanbul, Uzaktan; empty = anywhere
    job_max_age_days: 30,
    min_budget: 0,
    max_budget: 0,                            // 0 = no upper bound
    currencies: [],                           // empty = any
    max_age_hours: 72,
    max_leads_per_scan: 30,                   // per source
    notify_new: true,                         // e-mail the admin when a scan finds matching listings
    translate: true,                          // translate foreign listings to Turkish
    translate_max_chars: 1500,                // translate only the start of long descriptions (saves free quota)
  },
  prospecting: {
    location: '',                             // address / district / city to scan around
    lat: null, lng: null,                     // filled automatically from location (or set by clicking the map)
    radius_km: 2,
    categories: ['restaurant', 'cafe', 'hairdresser', 'beauty', 'dentist', 'veterinary', 'car_repair', 'real_estate', 'gym', 'clothes', 'florist', 'bakery'],
    source: 'osm',                            // osm (free) | google (needs GOOGLE_PLACES_API_KEY)
    max_per_scan: 40,
    min_score: 60,                            // only businesses at or above this score are offered for contact
    auto_send: false,                         // scheduled scans also send e-mails within the daily limit
    daily_limit: 20,
    signature: '',                            // appended to every outreach message
    opt_out_text: "Bu konuda mesaj almak istemezseniz 'İPTAL' yazmanız yeterli; bir daha rahatsız etmeyiz.",
  },
  // Message templates. Placeholders: {ad} {kategori} {bulgu} {ilan} {isletmem} {yetkili} {telefonum} {sitem}
  templates: {
    prospect_no_site: "Merhaba, {ad} için internette bir web sitesine rastlayamadım; müşterilerin çoğu artık bir {kategori} seçmeden önce Google'da arama yapıyor. Size özel, mobil uyumlu bir web sitesi hazırlayıp önce ücretsiz bir taslağını gösterebilirim. İlginizi çekerse kısaca konuşalım mı?",
    prospect_social: "Merhaba, {ad} sayfanızı sosyal medyada gördüm. Google'da çıkan kendi web siteniz olursa yeni müşterilere ulaşmanız çok daha kolay olur. Size uygun, mobil uyumlu bir site hazırlayıp önce ücretsiz bir taslağını gösterebilirim. Kısaca konuşalım mı?",
    prospect_old_site: "Merhaba, {ad} web sitenize baktım: {bulgu}. Sitenizi hızlı, mobil uyumlu ve güncel hale getirebilirim; önce ücretsiz bir taslak gösterebilirim. İlginizi çekerse kısaca konuşalım mı?",
    prospect_subject: '{ad} için web sitesi önerisi',
    lead_message: 'Merhaba, "{ilan}" ilanınızı gördüm. Bu işi yapabilirim; benzer işlerden örnekler paylaşabilir, size uygun bir teklif hazırlayabilirim. Detayları konuşmak ister misiniz?',
    lead_subject: '"{ilan}" ilanınız hakkında',
    // Used for listings written in another language (the client probably doesn't read Turkish).
    lead_message_en: 'Hello, I saw your project "{ilan}". I can do this; I can share examples of similar work and prepare an offer that fits your needs. Would you like to discuss the details?',
    lead_subject_en: 'About your project "{ilan}"',
    job_message: 'Merhaba, "{ilan}" pozisyonu için başvurmak istiyorum. Özgeçmişimi ve önceki çalışmalarımdan örnekleri paylaşabilirim. Uygun görürseniz görüşmek isterim. Teşekkürler, {yetkili}',
    job_subject: '"{ilan}" pozisyonu için başvuru',
    job_message_en: 'Hello, I would like to apply for the "{ilan}" position. I can share my CV and examples of my previous work. I would be glad to talk if my profile fits. Thank you, {yetkili}',
    job_subject_en: 'Application for the "{ilan}" position',
  },
  security: {
    max_failed_logins: 5,                     // per email in 15 minutes -> alert + lockout
    max_failed_per_ip: 20,                    // any account, per IP in 15 minutes -> IP blocked + alert
    alert_on_new_ip: true,
    require_2fa_for_admins: false,            // admins without 2FA are sent to the setup screen
    idle_timeout_minutes: 120,                // 0 = only the absolute session lifetime applies
    allowed_ips: [],                          // empty = any IP may use the panel
    audit_retention_days: 365,
  },
  automation: {
    reply_reminder_hours: 4,                  // re-alert when a customer's reply waits this long
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
