// Translates foreign-language listings into Turkish.
// Providers (first configured one wins):
//   DEEPL_API_KEY       – DeepL API (free plan: 500.000 characters / month, best quality)
//   LIBRETRANSLATE_URL  – your own LibreTranslate server (fully local, e.g. Docker)
//   (none)              – MyMemory free service, no key; ~5.000 characters/day, 50.000 with an e-mail
import { config } from '../config.js';
import { all, get, update } from '../db.js';
import { httpFetch, USER_AGENT } from './http.js';
import { getSection } from './settings.js';

export const provider = () => (config.translate.deeplKey ? 'deepl' : config.translate.libreUrl ? 'libre' : 'mymemory');
export const PROVIDER_LABEL = { deepl: 'DeepL', libre: 'LibreTranslate', mymemory: 'MyMemory (ücretsiz)' };

// --- Language detection (good enough to tell Turkish from the usual listing languages) ---

const STOP = {
  tr: ['ve', 'bir', 'bu', 'için', 'ile', 'de', 'da', 'çok', 'olarak', 'olan', 'istiyorum', 'gerekiyor', 'yapılacak', 'merhaba', 'site', 'sitesi', 'bütçe', 'iş', 'ne', 'mi', 'var'],
  en: ['the', 'and', 'for', 'with', 'need', 'to', 'a', 'of', 'is', 'my', 'we', 'you', 'looking', 'website', 'should', 'have', 'will', 'are', 'in', 'on'],
  de: ['und', 'der', 'die', 'das', 'mit', 'für', 'ich', 'wir', 'eine', 'ist', 'nicht', 'suche', 'auf'],
  es: ['el', 'la', 'de', 'que', 'y', 'para', 'con', 'una', 'los', 'por', 'necesito', 'sitio'],
  fr: ['le', 'la', 'les', 'et', 'pour', 'avec', 'une', 'des', 'est', 'je', 'nous', 'site'],
  pt: ['o', 'a', 'de', 'que', 'e', 'para', 'com', 'uma', 'os', 'preciso', 'site', 'não'],
  it: ['il', 'di', 'che', 'e', 'per', 'con', 'una', 'sono', 'cerco', 'sito'],
};

/** ISO code of the text's language ('tr', 'en', ...) or null when unsure. */
export function detectLanguage(text) {
  const s = String(text || '').slice(0, 2000);
  if (!s.trim()) return null;
  if (/[Ѐ-ӿ]/.test(s)) return 'ru';
  if (/[؀-ۿ]/.test(s)) return 'ar';
  if (/[ğışĞİŞ]/.test(s)) return 'tr';
  const words = s.toLocaleLowerCase('tr').match(/[a-zçğıöşüäßéèêáàâãíóôõúñ]+/g) || [];
  if (!words.length) return null;
  let best = null; let bestScore = 0;
  for (const [lang, list] of Object.entries(STOP)) {
    const set = new Set(list);
    const score = words.filter((w) => set.has(w)).length;
    if (score > bestScore) { best = lang; bestScore = score; }
  }
  // Short titles with no stop words: Turkish letters already returned above, so assume English.
  return best || (/[çöü]/.test(s) ? 'tr' : 'en');
}

export const needsTranslation = (lang) => Boolean(lang) && lang !== 'tr';

// --- Providers -----------------------------------------------------------------------------

/** Split into pieces of at most `max` UTF-8 bytes, preferring sentence boundaries. */
export function chunk(text, max = 450) {
  const bytes = (x) => Buffer.byteLength(x, 'utf8');
  const parts = String(text).split(/(?<=[.!?\n])\s+/);
  const out = [];
  let cur = '';
  for (let p of parts) {
    while (bytes(p) > max) {
      // A single very long sentence: cut at a word boundary.
      let cut = p.slice(0, max);
      while (bytes(cut) > max) cut = cut.slice(0, -1);
      const sp = cut.lastIndexOf(' ');
      if (sp > max / 2) cut = cut.slice(0, sp);
      if (cur) { out.push(cur); cur = ''; }
      out.push(cut);
      p = p.slice(cut.length).trimStart();
    }
    if (!p) continue;
    if (cur && bytes(`${cur} ${p}`) > max) { out.push(cur); cur = p; } else cur = cur ? `${cur} ${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

class QuotaError extends Error {}

async function myMemory(text, from) {
  const email = getSection('business').admin_email;
  const pieces = [];
  for (const part of chunk(text)) {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', part);
    url.searchParams.set('langpair', `${from || 'en'}|tr`);
    if (email && !/example\.com$/i.test(email)) url.searchParams.set('de', email);
    const res = await httpFetch(url.href, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => ({}));
    if (data.quotaFinished || res.status === 429 || /QUOTA/i.test(data.responseDetails || '')) {
      throw new QuotaError('Ücretsiz çeviri kotası bugünlük doldu (MyMemory). Yarın devam eder; daha fazlası için .env\'ye DEEPL_API_KEY ekleyin.');
    }
    if (!res.ok || Number(data.responseStatus) !== 200) throw new Error(`Çeviri servisi: ${data.responseDetails || res.status}`);
    pieces.push(data.responseData.translatedText);
  }
  return pieces.join(' ');
}

async function deepl(texts) {
  const key = config.translate.deeplKey;
  const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const res = await httpFetch(`${host}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ text: texts, target_lang: 'TR' }),
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 456) throw new QuotaError('DeepL aylık karakter kotası doldu.');
  if (res.status === 403) throw new Error('DeepL anahtarı geçersiz (DEEPL_API_KEY).');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`DeepL: ${data.message || res.status}`);
  return data.translations.map((t) => t.text);
}

async function libre(text) {
  const res = await httpFetch(`${config.translate.libreUrl.replace(/\/+$/, '')}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ q: text, source: 'auto', target: 'tr', format: 'text', ...(config.translate.libreKey ? { api_key: config.translate.libreKey } : {}) }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`LibreTranslate: ${data.error || res.status}`);
  return data.translatedText;
}

/** Translate several texts to Turkish with the configured provider. Empty texts stay empty. */
export async function toTurkish(texts, from) {
  try {
    return await translateWith(provider(), texts, from);
  } catch (err) {
    if (err instanceof QuotaError || err.message.startsWith('Çeviri') || err.message.startsWith('DeepL') || err.message.startsWith('LibreTranslate')) throw err;
    throw new Error(`Çeviri servisine ulaşılamadı (${PROVIDER_LABEL[provider()]}); internet bağlantınızı kontrol edin.`);
  }
}

async function translateWith(p, texts, from) {
  if (p === 'deepl') {
    const idx = texts.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
    const out = await deepl(idx.map((i) => texts[i]));
    return texts.map((t, i) => (t ? out[idx.indexOf(i)] : t));
  }
  const out = [];
  for (const t of texts) out.push(t ? (p === 'libre' ? await libre(t) : await myMemory(t, from)) : t);
  return out;
}

/** Translate one stored listing (title + start of the description). */
export async function translateLead(id, { force = false } = {}) {
  const lead = get('SELECT * FROM leads WHERE id = ?', id);
  if (!lead) throw Object.assign(new Error('İlan bulunamadı'), { status: 404 });
  const lang = lead.lang || detectLanguage(`${lead.title}\n${lead.description}`);
  if (!needsTranslation(lang) && !force) {
    update('leads', id, { lang: lang || 'tr' });
    return get('SELECT * FROM leads WHERE id = ?', id);
  }
  const max = getSection('scanner').translate_max_chars || 1500;
  let desc = String(lead.description || '');
  if (desc.length > max) desc = `${desc.slice(0, max).replace(/\s+\S*$/, '')} …`;
  const [title, description] = await toTurkish([lead.title, desc], lang === 'tr' ? 'en' : lang);
  update('leads', id, { lang, title_tr: title, description_tr: description || null, translated_by: provider() });
  return get('SELECT * FROM leads WHERE id = ?', id);
}

/**
 * Translate matching, not yet translated foreign listings (newest first).
 * Stops quietly when the free quota runs out; returns { translated, error }.
 */
export async function translatePending({ limit = 30, ids = null } = {}) {
  if (!getSection('scanner').translate) return { translated: 0, skipped: true };
  const rows = ids
    ? ids.map((x) => get('SELECT id, lang, title, description FROM leads WHERE id = ?', x)).filter(Boolean)
    : all(`SELECT id, lang, title, description FROM leads WHERE title_tr IS NULL AND status != 'filtered_out' ORDER BY id DESC LIMIT ?`, limit * 3);
  let translated = 0;
  for (const r of rows) {
    if (translated >= limit) break;
    const lang = r.lang || detectLanguage(`${r.title}\n${r.description}`);
    if (!needsTranslation(lang)) { update('leads', r.id, { lang: lang || 'tr' }); continue; }
    try {
      await translateLead(r.id);
      translated++;
    } catch (err) {
      update('leads', r.id, { lang });
      return { translated, error: err.message, quota: err instanceof QuotaError };
    }
  }
  return { translated };
}
