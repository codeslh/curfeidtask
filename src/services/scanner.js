import { config } from '../config.js';
import { get, insert, update } from '../db.js';
import { AiUnavailableError, callClaude, mockGuard } from './ai.js';
import { notifyAdmin } from './notify.js';
import { PLATFORMS } from './platforms/index.js';
import { aiOpenConversation, findOrCreateConversation } from './sales.js';
import { getSection, toBase } from './settings.js';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+|00)?9?0?\s?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}|\+\d{10,14}/;

export function extractContact(text = '') {
  const email = text.match(EMAIL_RE)?.[0] || null;
  let phone = text.match(PHONE_RE)?.[0]?.replace(/[^\d+]/g, '') || null;
  if (phone) {
    phone = phone.replace(/^\+/, '').replace(/^00/, '');
    if (phone.startsWith('0')) phone = `9${phone}`;
    if (phone.startsWith('5')) phone = `90${phone}`;
  }
  return { email, phone };
}

/** Apply the admin-defined scope. Returns null when the lead passes, otherwise a reason. */
export function filterLead(lead, scope) {
  const text = `${lead.title} ${lead.description} ${(lead.skills || []).join(' ')}`.toLocaleLowerCase('tr');
  const keywords = (scope.keywords || []).map((k) => k.toLocaleLowerCase('tr')).filter(Boolean);
  if (keywords.length && !keywords.some((k) => text.includes(k))) return 'Anahtar kelime eşleşmedi';
  const excluded = (scope.exclude_keywords || []).find((k) => k && text.includes(k.toLocaleLowerCase('tr')));
  if (excluded) return `Hariç tutulan kelime: ${excluded}`;
  if (scope.currencies?.length && lead.currency && !scope.currencies.includes(lead.currency)) return `Para birimi: ${lead.currency}`;
  const top = lead.budget_max ?? lead.budget_min;
  if (top != null) {
    const topBase = toBase(top, lead.currency);
    if (scope.min_budget > 0 && topBase < scope.min_budget) return 'Bütçe alt sınırın altında';
    const bottomBase = toBase(lead.budget_min ?? top, lead.currency);
    if (scope.max_budget > 0 && bottomBase > scope.max_budget) return 'Bütçe üst sınırın üstünde';
  }
  if (scope.max_age_hours > 0 && lead.posted_at) {
    const age = (Date.now() - new Date(lead.posted_at).getTime()) / 36e5;
    if (age > scope.max_age_hours) return 'İlan çok eski';
  }
  return null;
}

async function firstContactMessage(lead) {
  const business = getSection('business');
  if (config.aiMock) {
    mockGuard('lead_contact');
    return `Merhaba${lead.client_name ? ` ${lead.client_name}` : ''}, "${lead.title}" ilanınızı gördük. ${business.name} olarak bu iş için size yardımcı olmak isteriz. Detayları konuşmak ister misiniz?`;
  }
  return callClaude({
    purpose: 'lead_contact', effort: 'low', maxTokens: 2000,
    system: `Sen "${business.name}" işletmesinin satış temsilcisisin. Bir freelancer ilanını veren kişiye ilk mesajı yazıyorsun. Kısa, kişisel, profesyonel ol; işi anladığını göster ve görüşme teklif et. Sadece mesaj metnini yaz.`,
    messages: [{ role: 'user', content: `İlan başlığı: ${lead.title}\nAçıklama: ${lead.description}\nBütçe: ${lead.budget_min ?? '?'}-${lead.budget_max ?? '?'} ${lead.currency || ''}` }],
  });
}

async function processLead(platform, raw, scope) {
  if (get('SELECT id FROM leads WHERE platform = ? AND external_id = ?', platform, raw.external_id)) return 'duplicate';
  const contact = extractContact(raw.description);
  const reason = filterLead(raw, scope);
  const leadId = insert('leads', {
    platform, external_id: raw.external_id, title: raw.title, description: raw.description,
    budget_min: raw.budget_min, budget_max: raw.budget_max, currency: raw.currency, url: raw.url,
    skills: (raw.skills || []).join(', '), client_name: raw.client_name, contact: JSON.stringify(contact),
    status: reason ? 'filtered_out' : 'new', filter_reason: reason,
  });
  if (reason) return 'filtered';

  if (!contact.email && !contact.phone) {
    update('leads', leadId, { status: 'needs_admin' });
    await notifyAdmin('lead_needs_admin', `Yeni iş ilanı (iletişim yok): ${raw.title}`,
      `Platform: ${platform}\nBütçe: ${raw.budget_min ?? '?'}-${raw.budget_max ?? '?'} ${raw.currency || ''}\n${raw.url || ''}\n\n${raw.description.slice(0, 800)}\n\nİlanda iletişim bilgisi yok; platform üzerinden teklif vermeniz gerekiyor.`,
      `/leads`);
    return 'needs_admin';
  }

  const conv = contact.phone
    ? findOrCreateConversation({ channel: 'whatsapp', externalId: contact.phone, name: raw.client_name || '', phone: contact.phone, email: contact.email, platform })
    : findOrCreateConversation({ channel: 'email', externalId: contact.email, name: raw.client_name || '', email: contact.email, platform });
  update('leads', leadId, { status: 'contacted', customer_id: conv.customer_id, conversation_id: conv.id });
  try {
    await aiOpenConversation(conv.id, await firstContactMessage(raw));
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    update('leads', leadId, { status: 'needs_admin' });
    await notifyAdmin('lead_needs_admin', `İlan sahibine ulaşılamadı: ${raw.title}`, err.message, `/leads`);
    return 'needs_admin';
  }
  return 'contacted';
}

let scanning = false;

export async function scanPlatforms() {
  if (scanning) return { skipped: true };
  scanning = true;
  const scope = getSection('scanner');
  const summary = { fetched: 0, contacted: 0, needs_admin: 0, filtered: 0, duplicate: 0, errors: [] };
  try {
    for (const name of scope.enabled_platforms || []) {
      const adapter = PLATFORMS[name];
      if (!adapter) continue;
      let leads = [];
      try {
        leads = (await adapter.fetchLeads(scope)).slice(0, scope.max_leads_per_scan || 20);
      } catch (err) {
        summary.errors.push(`${adapter.label}: ${err.message}`);
        continue;
      }
      summary.fetched += leads.length;
      for (const lead of leads) summary[await processLead(name, lead, scope)]++;
    }
    if (summary.errors.length) {
      await notifyAdmin('scanner_error', 'Platform taramasında hata', summary.errors.join('\n'), '/leads');
    }
  } finally {
    scanning = false;
  }
  return summary;
}

let timer;
export function startScheduler() {
  if (!config.scanner.enabled || timer) return;
  timer = setInterval(() => scanPlatforms().catch((e) => console.error('Tarama hatası:', e)), config.scanner.intervalMinutes * 60_000);
  timer.unref();
}
