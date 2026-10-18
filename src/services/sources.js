// İlan kaynakları. İki tür ilan var: freelance işler (kind = 'freelance') ve
// sigortalı/maaşlı iş ilanları (kind = 'job'). Kaynaklar: Freelancer.com API,
// Remotive API (uzaktan işler), RSS beslemeleri ve herkese açık ilan sayfalarını izleme.
// Giriş gerektiren siteler (Bionluk, Armut, LinkedIn...) için ilanlar tarayıcıdaki
// "Kalfa'ya ekle" yer imiyle tek tıkla kaydedilir (addManualLead).
// Hangi ilanların uygun olduğuna anahtar kelimeyle değil, seçtiğiniz kategorilerle karar verilir.
import { config } from '../config.js';
import { all, get, insert, run, update } from '../db.js';
import { CATEGORIES, categoryLabel, classify, compileTerms, hits } from './categories.js';
import { assertPublicUrl, httpFetch, USER_AGENT } from './http.js';
import { addMessage, findOrCreateConversation } from './inbox.js';
import { notifyAdmin, sendMail } from './notify.js';
import { getSection, toBase } from './settings.js';
import { render, template } from './templates.js';
import { detectLanguage, translatePending } from './translate.js';

/**
 * Known platforms. `mode` says how leads get in:
 *  api       – fetched automatically (Freelancer.com)
 *  page      – a public listing page can be watched (paste its address)
 *  bookmark  – listings need a login / the app; save them with the bookmarklet
 */
export const PLATFORMS = {
  // Freelance
  freelancer: { kind: 'freelance', home: 'https://www.freelancer.com/jobs', label: 'Freelancer.com', hosts: ['freelancer.com'], mode: 'api',
    help: 'Herkese açık API ile otomatik taranır; seçtiğiniz kategorilerle arama yapılır. Teklifi Freelancer.com üzerinden verirsiniz.' },
  r10: { kind: 'freelance', home: 'https://www.r10.net/', label: 'R10.net', hosts: ['r10.net'], mode: 'page',
    help: 'Forumun hizmet alım bölümleri herkese açıktır. R10.net\'te ilgili bölümü (ör. web tasarım / yazılım hizmet alımı) açın, adres çubuğundaki adresi kopyalayıp "Sayfa ekle" ile ekleyin.' },
  bionluk: { kind: 'freelance', home: 'https://bionluk.com/', label: 'Bionluk', hosts: ['bionluk.com'], mode: 'bookmark',
    help: 'Alıcı istekleri yalnızca giriş yapmış freelancerlara gösterilir ve sayfa tarayıcıda oluşturulur, bu yüzden otomatik okunamaz. Bionluk\'ta bir isteği açın ve "Kalfa\'ya ekle" yer imine tıklayın.' },
  armut: { kind: 'freelance', home: 'https://armut.com/', label: 'Armut', hosts: ['armut.com'], mode: 'bookmark',
    help: 'Hizmet talepleri yalnızca hizmet veren hesabınızda (Armut Pro) görünür. Talebi açtığınızda "Kalfa\'ya ekle" yer imine tıklayın; teklifi Armut üzerinden verirsiniz.' },
  hallederim: { kind: 'freelance', label: 'Hallederim', hosts: ['hallederim.com', 'hallederim.com.tr', 'hallederim.net'], mode: 'page',
    help: 'İlan listesi herkese açıksa adresini "Sayfa ekle" ile ekleyin; giriş gerekiyorsa ilanları "Kalfa\'ya ekle" yer imiyle kaydedin.' },
  upwork: { kind: 'freelance', home: 'https://www.upwork.com/nx/find-work/', label: 'Upwork', hosts: ['upwork.com'], mode: 'bookmark', help: 'Giriş gerektirir; ilanları yer imiyle kaydedin.' },
  fiverr: { kind: 'freelance', home: 'https://www.fiverr.com/', label: 'Fiverr', hosts: ['fiverr.com'], mode: 'bookmark', help: 'Alıcı istekleri giriş gerektirir; yer imiyle kaydedin.' },
  // Sigortalı / maaşlı iş ilanları
  remotive: { kind: 'job', home: 'https://remotive.com/', label: 'Remotive (uzaktan işler)', hosts: ['remotive.com'], mode: 'api',
    help: 'Yurt dışı şirketlerin uzaktan (remote) çalışılan iş ilanları. Herkese açık API ile seçtiğiniz kategorilere göre otomatik taranır; ilanlar Türkçeye çevrilir. Remotive\'in kuralı gereği en fazla 6 saatte bir okunur.' },
  kariyer: { kind: 'job', home: 'https://www.kariyer.net/', label: 'Kariyer.net', hosts: ['kariyer.net'], mode: 'page',
    help: 'Kariyer.net\'te kategorinize ve şehrinize göre arama yapın, sonuç sayfasının adresini "Sayfa ekle" ile ekleyin ve "Dene" ile kontrol edin. Sayfa okunamazsa ilanları "Kalfa\'ya ekle" yer imiyle kaydedin.' },
  secretcv: { kind: 'job', home: 'https://www.secretcv.com/', label: 'Secretcv', hosts: ['secretcv.com'], mode: 'page',
    help: 'Arama sonuç sayfasının adresini "Sayfa ekle" ile ekleyin; okunamazsa yer imini kullanın.' },
  yenibiris: { kind: 'job', home: 'https://www.yenibiris.com/', label: 'Yenibiris', hosts: ['yenibiris.com'], mode: 'page',
    help: 'Arama sonuç sayfasının adresini "Sayfa ekle" ile ekleyin; okunamazsa yer imini kullanın.' },
  eleman: { kind: 'job', home: 'https://www.eleman.net/', label: 'Eleman.net', hosts: ['eleman.net'], mode: 'page',
    help: 'Arama sonuç sayfasının adresini "Sayfa ekle" ile ekleyin; okunamazsa yer imini kullanın.' },
  linkedin: { kind: 'job', home: 'https://www.linkedin.com/jobs/', label: 'LinkedIn', hosts: ['linkedin.com'], mode: 'bookmark',
    help: 'LinkedIn otomatik okumayı yasaklar ve giriş ister. İlanı açıp "Kalfa\'ya ekle" yer imine tıklayın.' },
  indeed: { kind: 'job', home: 'https://tr.indeed.com/', label: 'Indeed', hosts: ['indeed.com'], mode: 'bookmark',
    help: 'Indeed otomatik okumayı engeller. İlanı açıp "Kalfa\'ya ekle" yer imine tıklayın.' },
  iskur: { kind: 'job', home: 'https://esube.iskur.gov.tr/', label: 'İŞKUR', hosts: ['iskur.gov.tr'], mode: 'bookmark',
    help: 'İlan arama giriş gerektirebilir; ilanları yer imiyle kaydedin.' },
  // Genel
  rss: { label: 'RSS', hosts: [], mode: 'page', help: 'RSS/Atom beslemesi yayınlayan her ilan sitesi eklenebilir.' },
  web: { label: 'Diğer site', hosts: [], mode: 'page', help: 'Herkese açık her ilan sayfası izlenebilir.' },
  manual: { label: 'Elle eklenen', hosts: [], mode: 'bookmark', help: '' },
};

export const KINDS = { freelance: 'Freelance', job: 'İş ilanı' };
const kindOf = (k) => (k === 'job' ? 'job' : 'freelance');

export function detectPlatform(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return 'manual'; }
  for (const [key, p] of Object.entries(PLATFORMS)) {
    if (p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return key;
  }
  return 'web';
}

// --- Contact details & filtering -------------------------------------------------------

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

const lower = (s) => String(s || '').toLocaleLowerCase('tr');
const selectedCategories = (scope, kind) => (kind === 'job' ? scope.job_categories : scope.freelance_categories) || [];
const REMOTE_TERMS = compileTerms(['remote', 'uzaktan', 'home office', 'evden', 'anywhere', 'worldwide']);

/** Categories (and own extra keywords) a listing falls into. */
export function categorize(lead, scope) {
  const cls = classify(lead);
  const custom = (scope.extra_keywords || []).length
    && hits(`${lead.title} ${lead.description} ${(lead.skills || []).join(' ')}`, compileTerms(scope.extra_keywords)) > 0;
  return { ...cls, all: custom ? [...cls.all, 'custom'] : cls.all };
}

/**
 * Apply the admin-defined scope. Returns null when the lead passes, otherwise a reason.
 * `lead.categories` must already be set (see categorize).
 */
export function filterLead(lead, scope, kind = kindOf(lead.kind)) {
  const cats = lead.categories || [];
  const selected = selectedCategories(scope, kind);
  if (selected.length && !cats.some((c) => c === 'custom' || selected.includes(c))) {
    return cats.length ? `Seçili kategorilerde değil (${categoryLabel(cats[0])})` : 'Hiçbir kategoriye uymuyor';
  }
  const text = `${lead.title} ${lead.description} ${(lead.skills || []).join(' ')}`;
  const excluded = (scope.exclude_keywords || []).find((k) => k && hits(text, compileTerms([k])));
  if (excluded) return `Hariç tutulan kelime: ${excluded}`;
  if (kind === 'freelance') {
    if (scope.currencies?.length && lead.currency && !scope.currencies.includes(lead.currency)) return `Para birimi: ${lead.currency}`;
    const top = lead.budget_max ?? lead.budget_min;
    if (top != null) {
      const topBase = toBase(top, lead.currency);
      if (scope.min_budget > 0 && topBase < scope.min_budget) return 'Bütçe alt sınırın altında';
      const bottomBase = toBase(lead.budget_min ?? top, lead.currency);
      if (scope.max_budget > 0 && bottomBase > scope.max_budget) return 'Bütçe üst sınırın üstünde';
    }
  } else if ((scope.job_locations || []).length) {
    const where = `${lead.location || ''} ${lead.title}`;
    const wantsRemote = scope.job_locations.some((l) => hits(l, REMOTE_TERMS));
    const isRemote = lead.remote || hits(where, REMOTE_TERMS);
    const cityMatch = hits(where, compileTerms(scope.job_locations.filter((l) => !hits(l, REMOTE_TERMS))));
    if ((lead.location || isRemote) && !cityMatch && !(wantsRemote && isRemote)) return `Konum uymuyor (${lead.location || 'belirtilmemiş'})`;
  }
  const maxAge = kind === 'job' ? scope.job_max_age_days * 24 : scope.max_age_hours;
  if (maxAge > 0 && lead.posted_at) {
    const t = new Date(lead.posted_at).getTime();
    if (!Number.isNaN(t) && (Date.now() - t) / 36e5 > maxAge) return 'İlan çok eski';
  }
  return null;
}

/** 0-100: how strongly the listing fits your categories, plus budget/salary, contact info and freshness. */
export function scoreLead(lead, scope, kind = kindOf(lead.kind)) {
  const selected = selectedCategories(scope, kind);
  const strength = lead.strength || {};
  const best = Math.max(0, ...Object.entries(strength).filter(([k]) => !selected.length || selected.includes(k)).map(([, n]) => n));
  let score = Math.min(60, best * 15) || ((lead.categories || []).includes('custom') ? 30 : 0);
  if (lead.budget_max != null || lead.budget_min != null || lead.salary) score += 15;
  const c = lead.contact || extractContact(`${lead.title} ${lead.description}`);
  if (c.email || c.phone) score += 15;
  if (lead.posted_at && (Date.now() - new Date(lead.posted_at).getTime()) / 36e5 < 24) score += 10;
  return Math.min(100, score);
}

// --- Fetchers ------------------------------------------------------------------------------

const decode = (s = '') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};

function parseMoney(text) {
  const m = text.match(/(?:budget|bütçe)[^0-9$€₺]{0,20}([$€₺])?\s?([\d.,]+)\s*(TL|₺|USD|EUR|\$|€)?/i);
  if (!m) return { budget_max: null, currency: null };
  const sym = m[1] || m[3] || '';
  return {
    budget_max: Number(m[2].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')) || null,
    currency: /\$|USD/.test(sym) ? 'USD' : /€|EUR/.test(sym) ? 'EUR' : /₺|TL/.test(sym) ? 'TRY' : null,
  };
}

export function parseFeed(xml) {
  const items = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return items.map((item) => {
    const link = decode(tag(item, 'link')) || (item.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    const description = decode(tag(item, 'description') || tag(item, 'summary') || tag(item, 'content'));
    return {
      external_id: decode(tag(item, 'guid') || tag(item, 'id')) || link,
      title: decode(tag(item, 'title')),
      description,
      budget_min: null,
      ...parseMoney(description),
      url: link,
      skills: [],
      client_name: decode(tag(item, 'author') || tag(item, 'dc:creator')) || null,
      posted_at: decode(tag(item, 'pubDate') || tag(item, 'published') || tag(item, 'updated')) || null,
    };
  }).filter((l) => l.title && l.external_id);
}

const isFeed = (text) => /^\s*(<\?xml[^>]*>\s*)?<(rss|feed|rdf:RDF)[\s>]/i.test(text);

function patternMatcher(pattern) {
  if (!pattern) return () => true;
  const re = pattern.match(/^\/(.+)\/([a-z]*)$/);
  if (re) {
    const rx = new RegExp(re[1], re[2]);
    return (href) => rx.test(href);
  }
  return (href) => href.includes(pattern);
}

/**
 * Links that look like listings on a public page. Without a pattern, keeps links on
 * the same site whose text is long enough to be a title (menus are short).
 */
export function parsePage(html, pageUrl, pattern) {
  const base = new URL(pageUrl);
  const match = patternMatcher(pattern);
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try { url = new URL(m[1].replace(/&amp;/g, '&'), base); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    if (url.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    const title = decode(m[2]);
    if (title.length < 12 || title.length > 200) continue;
    if (!match(url.href)) continue;
    url.hash = '';
    if (seen.has(url.href) || url.href === base.href) continue;
    seen.add(url.href);
    out.push({ external_id: url.href, title, description: '', budget_min: null, budget_max: null, currency: null, url: url.href, skills: [], client_name: null, posted_at: null });
  }
  return out;
}

async function fetchText(url) {
  await assertPublicUrl(url);
  const res = await httpFetch(url, {
    redirect: 'follow', signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'tr,en;q=0.8' },
  });
  if (!res.ok) throw new Error(`Sayfa açılamadı (${res.status})`);
  return { text: await res.text(), url: res.url || url };
}

export async function fetchFreelancer(scope, limit) {
  const queries = [...new Set([
    ...(scope.freelance_categories || []).map((c) => CATEGORIES[c]?.query).filter(Boolean),
    ...(scope.extra_keywords || []).slice(0, 2),
  ])].slice(0, 6);
  const out = new Map();
  for (const query of queries.length ? queries : ['']) {
    const url = new URL('https://www.freelancer.com/api/projects/0.1/projects/active/');
    if (query) url.searchParams.set('query', query);
    url.searchParams.set('limit', String(Math.min(limit, 50)));
    url.searchParams.set('full_description', 'true');
    url.searchParams.set('job_details', 'true');
    const res = await httpFetch(url.href, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Freelancer.com ${res.status}`);
    const data = await res.json();
    for (const p of data.result?.projects || []) {
      out.set(String(p.id), {
        external_id: String(p.id),
        title: p.title,
        description: p.description || p.preview_description || '',
        budget_min: p.budget?.minimum ?? null,
        budget_max: p.budget?.maximum ?? null,
        currency: p.currency?.code || null,
        url: `https://www.freelancer.com/projects/${p.seo_url}`,
        skills: (p.jobs || []).map((j) => j.name),
        client_name: null,
        posted_at: p.time_submitted ? new Date(p.time_submitted * 1000).toISOString() : null,
      });
    }
  }
  return [...out.values()];
}

/** Remotive public API: remote jobs from companies abroad (https://remotive.com/api/remote-jobs). */
export async function fetchRemotive(scope, limit) {
  const slugs = [...new Set((scope.job_categories || []).map((c) => CATEGORIES[c]?.remotive).filter(Boolean))].slice(0, 4);
  const out = new Map();
  for (const slug of slugs.length ? slugs : [null]) {
    const url = new URL('https://remotive.com/api/remote-jobs');
    if (slug) url.searchParams.set('category', slug);
    url.searchParams.set('limit', String(Math.min(limit, 100)));
    const res = await httpFetch(url.href, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Remotive ${res.status}`);
    const data = await res.json();
    for (const j of data.jobs || []) {
      out.set(String(j.id), {
        external_id: String(j.id), kind: 'job',
        title: j.title, description: decode(j.description || ''),
        company: j.company_name || null, location: j.candidate_required_location || null,
        job_type: j.job_type || null, salary: j.salary || null, remote: 1,
        budget_min: null, budget_max: null, currency: null,
        url: j.url, skills: j.tags || [], client_name: j.company_name || null,
        posted_at: j.publication_date ? new Date(j.publication_date).toISOString() : null,
      });
    }
  }
  return [...out.values()];
}

// Remotive asks API users not to call it more than a few times a day.
const MIN_INTERVAL = { remotive_api: 6 * 36e5 };

/** Read one source. Pages that advertise an RSS feed are read through the feed. */
export async function fetchSource(source, scope) {
  const limit = scope.max_leads_per_scan || 30;
  if (source.kind === 'freelancer_api') return (await fetchFreelancer(scope, limit)).slice(0, limit);
  if (source.kind === 'remotive_api') return (await fetchRemotive(scope, limit)).slice(0, limit);
  const { text, url } = await fetchText(source.url);
  if (isFeed(text)) return parseFeed(text).slice(0, limit);
  if (source.kind === 'rss') throw new Error('Bu adres bir RSS/Atom beslemesi değil');
  const feedHref = !source.link_pattern && text.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i)?.[1];
  if (feedHref) {
    const feed = await fetchText(new URL(feedHref.replace(/&amp;/g, '&'), url).href);
    if (isFeed(feed.text)) return parseFeed(feed.text).slice(0, limit);
  }
  const leads = parsePage(text, url, source.link_pattern);
  if (!leads.length && /<div id=["'](app|root|__next)["']\s*>\s*<\/div>/i.test(text)) {
    throw new Error('Sayfa içeriği tarayıcıda oluşturuluyor, otomatik okunamıyor. Bu sitedeki ilanları "Kalfa\'ya ekle" yer imiyle kaydedin.');
  }
  return leads.slice(0, limit);
}

// --- Storing leads ----------------------------------------------------------------------------

function storeLead(platform, raw, scope, { sourceId = null, kind } = {}) {
  if (get('SELECT id FROM leads WHERE platform = ? AND external_id = ?', platform, raw.external_id)) return null;
  const k = kindOf(raw.kind || kind || PLATFORMS[platform]?.kind);
  const contact = raw.contact || extractContact(`${raw.title}\n${raw.description}`);
  const cats = categorize(raw, scope);
  const lead = { ...raw, contact, categories: cats.all, strength: cats.strength };
  const reason = raw.manual ? null : filterLead(lead, scope, k);
  const selected = selectedCategories(scope, k);
  const id = insert('leads', {
    platform, kind: k, external_id: raw.external_id, title: raw.title.slice(0, 300), description: String(raw.description || '').slice(0, 8000),
    budget_min: raw.budget_min, budget_max: raw.budget_max, currency: raw.currency, url: raw.url,
    skills: (raw.skills || []).join(', '), client_name: raw.client_name, contact: JSON.stringify(contact),
    status: reason ? 'filtered_out' : 'new', filter_reason: reason, score: scoreLead(lead, scope, k),
    category: cats.all.find((c) => selected.includes(c)) || cats.all[0] || null, categories: cats.all.join(','),
    company: raw.company || null, location: raw.location || null, job_type: raw.job_type || null, salary: raw.salary || null, remote: raw.remote ? 1 : 0,
    posted_at: raw.posted_at ? String(raw.posted_at) : null, source_id: sourceId,
    lang: detectLanguage(`${raw.title}\n${raw.description || ''}`),
  });
  return { id, matched: !reason, kind: k };
}

/** Re-check stored listings after the category selection changed. Returns { matched, filtered }. */
export function refilterLeads() {
  const scope = getSection('scanner');
  const out = { matched: 0, filtered: 0 };
  for (const l of all(`SELECT * FROM leads WHERE status IN ('new', 'filtered_out')`)) {
    const raw = { ...l, skills: l.skills ? l.skills.split(',').map((x) => x.trim()) : [], contact: JSON.parse(l.contact || '{}') };
    const cats = categorize(raw, scope);
    const lead = { ...raw, categories: cats.all, strength: cats.strength };
    // Listings you saved yourself stay; only scanned ones are re-filtered.
    const manual = !l.source_id;
    const reason = manual ? null : filterLead(lead, scope, kindOf(l.kind));
    const selected = selectedCategories(scope, kindOf(l.kind));
    update('leads', l.id, {
      status: reason ? 'filtered_out' : 'new', filter_reason: reason, score: scoreLead(lead, scope, kindOf(l.kind)),
      category: cats.all.find((c) => selected.includes(c)) || cats.all[0] || null, categories: cats.all.join(','),
    });
    out[reason ? 'filtered' : 'matched']++;
  }
  return out;
}

let scanning = false;
export const isScanning = () => scanning;

/** Scan every enabled source (or only `onlyId`). */
export async function scanSources({ onlyId = null } = {}) {
  if (scanning) return { skipped: true };
  scanning = true;
  const scope = getSection('scanner');
  const summary = { sources: 0, fetched: 0, added: 0, matched: 0, filtered: 0, translated: 0, waited: 0, errors: [] };
  const fresh = [];
  const freshIds = [];
  try {
    const sources = onlyId ? all('SELECT * FROM sources WHERE id = ?', onlyId) : all('SELECT * FROM sources WHERE enabled = 1 ORDER BY id');
    for (const src of sources) {
      const wait = MIN_INTERVAL[src.kind];
      if (wait && !onlyId && src.last_status === 'ok' && src.last_run_at && Date.now() - new Date(src.last_run_at).getTime() < wait) { summary.waited++; continue; }
      summary.sources++;
      const stats = { added: 0, matched: 0 };
      try {
        const leads = await fetchSource(src, scope);
        summary.fetched += leads.length;
        const platform = src.kind === 'freelancer_api' ? 'freelancer' : src.kind === 'remotive_api' ? 'remotive' : src.platform;
        for (const raw of leads) {
          const r = storeLead(platform, raw, scope, { sourceId: src.id, kind: src.lead_kind });
          if (!r) continue;
          stats.added++;
          if (r.matched) { stats.matched++; freshIds.push(r.id); }
        }
        update('sources', src.id, { last_run_at: new Date().toISOString(), last_status: 'ok', last_count: leads.length,
          last_message: `${leads.length} ilan okundu, ${stats.added} yeni, ${stats.matched} uygun` });
      } catch (err) {
        summary.errors.push(`${src.name}: ${err.message}`);
        update('sources', src.id, { last_run_at: new Date().toISOString(), last_status: 'error', last_message: err.message });
      }
      summary.added += stats.added;
      summary.matched += stats.matched;
    }
    summary.filtered = summary.added - summary.matched;
    // Foreign listings are translated before the notification so it can show Turkish titles.
    if (freshIds.length) {
      const t = await translatePending({ ids: freshIds, limit: 40 });
      summary.translated = t.translated;
      if (t.error) summary.translate_error = t.error;
    }
    for (const id of freshIds) {
      const l = get('SELECT kind, title, title_tr, url, company FROM leads WHERE id = ?', id);
      fresh.push({ kind: l.kind, line: `• ${l.title_tr || l.title}${l.company ? ` — ${l.company}` : ''}${l.title_tr ? `\n  (${l.title})` : ''}\n  ${l.url || ''}` });
    }
    if (fresh.length && scope.notify_new) {
      const fl = fresh.filter((f) => f.kind !== 'job');
      const jb = fresh.filter((f) => f.kind === 'job');
      const subject = [fl.length && `${fl.length} freelance iş`, jb.length && `${jb.length} iş ilanı`].filter(Boolean).join(', ');
      const body = [
        ...(fl.length ? ['Freelance işler:', ...fl.slice(0, 20).map((f) => f.line), ''] : []),
        ...(jb.length ? ['İş ilanları:', ...jb.slice(0, 20).map((f) => f.line)] : []),
      ].join('\n');
      await notifyAdmin('new_leads', `Yeni uygun ilanlar: ${subject}`, body, fl.length ? '/leads' : '/vacancies');
    }
  } finally {
    scanning = false;
  }
  return summary;
}

/** Listing saved with the bookmarklet or the "İlan ekle" form. */
export function addManualLead({ url, title, description = '', client_name = null, budget = null, currency = null, email = null, phone = null, platform = null, kind = null, company = null, location = null }) {
  title = String(title || '').trim();
  if (!title) throw new Error('Başlık boş olamaz');
  const cleanUrl = url && /^https?:\/\//i.test(url) ? String(url).slice(0, 1000) : null;
  const plat = platform && PLATFORMS[platform] ? platform : cleanUrl ? detectPlatform(cleanUrl) : 'manual';
  const found = extractContact(`${title}\n${description}`);
  const raw = {
    external_id: cleanUrl || `manual-${Date.now()}`, title, description, url: cleanUrl, client_name: client_name || null,
    budget_min: null, budget_max: budget ? Number(budget) || null : null, currency: currency || (budget ? getSection('business').base_currency : null),
    skills: [], posted_at: new Date().toISOString(), manual: true,
    kind: ['freelance', 'job'].includes(kind) ? kind : PLATFORMS[plat]?.kind || 'freelance',
    location: location || null,
    contact: { email: email || found.email, phone: phone ? String(phone).replace(/[^\d]/g, '') : found.phone },
  };
  // For job listings the "owner" is the company.
  raw.company = company || (raw.kind === 'job' ? raw.client_name : null);
  const existing = get('SELECT id FROM leads WHERE platform = ? AND external_id = ?', plat, raw.external_id);
  if (existing) return { id: existing.id, duplicate: true };
  const r = storeLead(plat, raw, getSection('scanner'));
  return { id: r.id, kind: r.kind, duplicate: false };
}

// --- Contacting ---------------------------------------------------------------------------------

// Foreign listings get the English template: the client most likely doesn't read Turkish.
// Job listings get the application (cover letter) template instead of the freelance offer.
const foreign = (lead) => Boolean(lead.lang) && lead.lang !== 'tr';
const tplKey = (lead, part) => `${lead.kind === 'job' ? 'job' : 'lead'}_${part}${foreign(lead) ? '_en' : ''}`;
const vars = (lead) => ({ ad: lead.client_name || lead.company || '', ilan: lead.title, sirket: lead.company || '' });
export const leadMessage = (lead) => render(template(tplKey(lead, 'message')), vars(lead));
export const leadSubject = (lead) => render(template(tplKey(lead, 'subject')), vars(lead));

/**
 * channel: email (sent by Kalfa) | whatsapp_link (you send it from WhatsApp) | platform (you sent an offer on the site) | phone
 */
export async function contactLead(id, { channel, message } = {}) {
  const lead = get('SELECT * FROM leads WHERE id = ?', id);
  if (!lead) throw Object.assign(new Error('İlan bulunamadı'), { status: 404 });
  const contact = JSON.parse(lead.contact || '{}');
  const text = String(message ?? leadMessage(lead)).trim();
  if (!text && channel !== 'phone') throw new Error('Mesaj boş');
  let conv = null;
  const who = lead.client_name || `${PLATFORMS[lead.platform]?.label || 'İlan'} ilan sahibi`;
  if (channel === 'email') {
    if (!contact.email) throw new Error('Bu ilanda e-posta adresi yok');
    if (!config.smtp.host) throw new Error('E-posta göndermek için .env dosyasında SMTP ayarlarını yapın');
    const subject = leadSubject(lead);
    await sendMail({ to: contact.email, subject, text });
    conv = findOrCreateConversation({ channel: 'email', externalId: contact.email.toLowerCase(), name: who, email: contact.email, platform: lead.platform });
    addMessage(conv.id, 'admin', text, { outreach: true, lead_id: lead.id, subject });
  } else if (channel === 'whatsapp_link') {
    if (!contact.phone) throw new Error('Bu ilanda telefon yok');
    conv = findOrCreateConversation({ channel: 'whatsapp', externalId: contact.phone, name: who, phone: contact.phone, email: contact.email, platform: lead.platform });
    addMessage(conv.id, 'admin', text, { outreach: true, lead_id: lead.id });
  } else if (!['platform', 'phone'].includes(channel)) {
    throw new Error('Geçersiz kanal');
  }
  update('leads', id, { status: 'contacted', contacted_at: new Date().toISOString(), conversation_id: conv?.id ?? lead.conversation_id, customer_id: conv?.customer_id ?? lead.customer_id });
  return get('SELECT * FROM leads WHERE id = ?', id);
}

export function whatsappLeadLink(lead, text = leadMessage(lead)) {
  const phone = JSON.parse(lead.contact || '{}').phone;
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : null;
}

export function seedSources() {
  if (!get('SELECT id FROM sources LIMIT 1')) {
    insert('sources', { kind: 'freelancer_api', platform: 'freelancer', lead_kind: 'freelance', name: 'Freelancer.com', enabled: 1 });
  }
  // Added with the job listings feature; also offered to existing installations once.
  if (!get(`SELECT key FROM settings WHERE key = '_seeded_remotive'`)) {
    if (!get(`SELECT id FROM sources WHERE kind = 'remotive_api'`)) {
      insert('sources', { kind: 'remotive_api', platform: 'remotive', lead_kind: 'job', name: 'Remotive — uzaktan iş ilanları', enabled: 1 });
    }
    run(`INSERT INTO settings (key, value) VALUES ('_seeded_remotive', 'true')`);
  }
}
