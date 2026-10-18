// "Bölge taraması": find nearby businesses, judge how likely they are to need a
// website, draft a personal message and (with the admin's approval) contact them.
import { config } from '../config.js';
import { all, get, insert, run, update } from '../db.js';
import { AiUnavailableError, callClaude, mockGuard } from './ai.js';
import { assertPublicUrl, httpFetch, USER_AGENT } from './http.js';
import { notifyAdmin, sendMail } from './notify.js';
import { addMessage, catalog, findOrCreateConversation } from './sales.js';
import { getSection } from './settings.js';
import { sendWhatsAppTemplate } from './whatsapp.js';

// Category key -> label, OpenStreetMap tag filters, Google Places types, weight (how much a site matters).
export const CATEGORIES = {
  restaurant: { label: 'Restoran', osm: [['amenity', 'restaurant']], google: ['restaurant'], weight: 10 },
  cafe: { label: 'Kafe', osm: [['amenity', 'cafe']], google: ['cafe'], weight: 8 },
  fast_food: { label: 'Fast food', osm: [['amenity', 'fast_food']], google: ['fast_food_restaurant'], weight: 4 },
  bakery: { label: 'Fırın / pastane', osm: [['shop', 'bakery'], ['shop', 'pastry']], google: ['bakery'], weight: 5 },
  hairdresser: { label: 'Kuaför / berber', osm: [['shop', 'hairdresser']], google: ['hair_salon', 'barber_shop'], weight: 10 },
  beauty: { label: 'Güzellik salonu', osm: [['shop', 'beauty']], google: ['beauty_salon'], weight: 12 },
  dentist: { label: 'Diş kliniği', osm: [['amenity', 'dentist'], ['healthcare', 'dentist']], google: ['dentist', 'dental_clinic'], weight: 14 },
  clinic: { label: 'Klinik / doktor', osm: [['amenity', 'clinic'], ['amenity', 'doctors']], google: ['doctor', 'medical_clinic'], weight: 10 },
  veterinary: { label: 'Veteriner', osm: [['amenity', 'veterinary']], google: ['veterinary_care'], weight: 10 },
  car_repair: { label: 'Oto servis', osm: [['shop', 'car_repair']], google: ['car_repair'], weight: 8 },
  real_estate: { label: 'Emlak ofisi', osm: [['office', 'estate_agent']], google: ['real_estate_agency'], weight: 12 },
  lawyer: { label: 'Avukat', osm: [['office', 'lawyer']], google: ['lawyer'], weight: 12 },
  accountant: { label: 'Muhasebe / mali müşavir', osm: [['office', 'accountant']], google: ['accounting'], weight: 10 },
  architect: { label: 'Mimarlık', osm: [['office', 'architect']], google: ['architect'], weight: 10 },
  gym: { label: 'Spor salonu', osm: [['leisure', 'fitness_centre']], google: ['gym'], weight: 10 },
  hotel: { label: 'Otel / pansiyon', osm: [['tourism', 'hotel'], ['tourism', 'guest_house']], google: ['hotel', 'lodging'], weight: 14 },
  clothes: { label: 'Giyim mağazası', osm: [['shop', 'clothes']], google: ['clothing_store'], weight: 8 },
  florist: { label: 'Çiçekçi', osm: [['shop', 'florist']], google: ['florist'], weight: 8 },
  jewelry: { label: 'Kuyumcu', osm: [['shop', 'jewelry']], google: ['jewelry_store'], weight: 8 },
  furniture: { label: 'Mobilya', osm: [['shop', 'furniture']], google: ['furniture_store'], weight: 10 },
  optician: { label: 'Optik', osm: [['shop', 'optician']], google: ['optician'], weight: 6 },
  driving_school: { label: 'Sürücü kursu', osm: [['amenity', 'driving_school']], google: ['driving_school'], weight: 10 },
  kindergarten: { label: 'Kreş / anaokulu', osm: [['amenity', 'kindergarten']], google: ['preschool'], weight: 10 },
  photographer: { label: 'Fotoğrafçı', osm: [['craft', 'photographer'], ['shop', 'photo']], google: ['photographer'], weight: 12 },
};

const SOCIAL_HOSTS = /(^|\.)(facebook\.com|fb\.com|instagram\.com|linktr\.ee|wa\.me|whatsapp\.com|business\.site|sites\.google\.com|tiktok\.com|twitter\.com|x\.com|youtube\.com|yandex\.com\.tr\/maps|goo\.gl|maps\.app\.goo\.gl)$/i;
const json = (v) => (v ? JSON.parse(v) : null);

// --- Geocoding -------------------------------------------------------------------

export async function geocode(query) {
  const url = `${config.nominatimUrl}/search?format=json&limit=1&accept-language=tr&q=${encodeURIComponent(query)}`;
  const res = await httpFetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Konum servisi yanıt vermedi (${res.status})`);
  const [hit] = await res.json();
  if (!hit) throw new Error(`"${query}" için konum bulunamadı. Daha açık yazın (ör. "Kadıköy, İstanbul").`);
  return { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name };
}

// --- Sources -----------------------------------------------------------------------

const cleanPhone = (p) => {
  if (!p) return null;
  let d = String(p).split(/[;,/]/)[0].replace(/[^\d+]/g, '');
  if (!d) return null;
  d = d.replace(/^\+/, '').replace(/^00/, '');
  if (d.startsWith('0')) d = `9${d}`;
  if (d.length === 10 && d.startsWith('5')) d = `90${d}`;
  return d.length >= 10 ? d : null;
};
const normalizeUrl = (u) => {
  if (!u) return null;
  const s = String(u).trim().split(/[;\s]/)[0];
  return /^https?:\/\//i.test(s) ? s : `http://${s}`;
};

function categoryOf(tags, wanted) {
  for (const key of wanted) {
    if (CATEGORIES[key]?.osm.some(([k, v]) => tags[k] === v)) return key;
  }
  return wanted[0];
}

export async function fetchOsm({ lat, lng, radiusKm, categories, limit }) {
  const r = Math.round(Math.min(radiusKm, 15) * 1000);
  const filters = categories.flatMap((c) => (CATEGORIES[c]?.osm || []).map(([k, v]) => `nwr["${k}"="${v}"]["name"](around:${r},${lat},${lng});`));
  if (!filters.length) throw new Error('En az bir kategori seçin');
  const query = `[out:json][timeout:40];(${filters.join('')});out center tags ${Math.max(limit * 3, 60)};`;
  const res = await httpFetch(config.overpassUrl, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`OpenStreetMap servisi yanıt vermedi (${res.status}). Biraz sonra tekrar deneyin.`);
  const data = await res.json();
  return (data.elements || []).map((el) => {
    const t = el.tags || {};
    const addr = [t['addr:street'] && `${t['addr:street']} ${t['addr:housenumber'] || ''}`.trim(), t['addr:district'] || t['addr:suburb'], t['addr:city']].filter(Boolean).join(', ');
    return {
      source: 'osm',
      source_id: `${el.type}/${el.id}`,
      name: t.name,
      category: categoryOf(t, categories),
      address: addr || null,
      lat: el.lat ?? el.center?.lat,
      lng: el.lon ?? el.center?.lon,
      phone: cleanPhone(t.phone || t['contact:phone'] || t['contact:mobile'] || t['contact:whatsapp']),
      email: (t.email || t['contact:email'] || '').split(/[;,\s]/)[0] || null,
      website: normalizeUrl(t.website || t['contact:website'] || t.url || t['contact:facebook'] || t['contact:instagram']),
      raw: { opening_hours: t.opening_hours, cuisine: t.cuisine, brand: t.brand, operator: t.operator },
      chain: Boolean(t.brand || t['brand:wikidata']),
    };
  }).filter((b) => b.name && b.lat && b.lng);
}

export async function fetchGoogle({ lat, lng, radiusKm, categories, limit }) {
  if (!config.googlePlacesKey) throw new Error('GOOGLE_PLACES_API_KEY tanımlı değil');
  const types = [...new Set(categories.flatMap((c) => CATEGORIES[c]?.google || []))];
  const out = [];
  // Places "searchNearby" returns at most 20 per call; query type groups separately.
  for (let i = 0; i < types.length && out.length < limit * 2; i += 5) {
    const res = await httpFetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.googlePlacesKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.internationalPhoneNumber,places.websiteUri,places.primaryType,places.rating,places.userRatingCount,places.businessStatus',
      },
      body: JSON.stringify({
        includedTypes: types.slice(i, i + 5), maxResultCount: 20, languageCode: 'tr',
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radiusKm, 50) * 1000 } },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Google Places: ${data.error?.message || res.status}`);
    for (const p of data.places || []) {
      if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
      const cat = categories.find((c) => CATEGORIES[c]?.google.includes(p.primaryType)) || categories[0];
      out.push({
        source: 'google', source_id: p.id, name: p.displayName?.text, category: cat, address: p.formattedAddress,
        lat: p.location?.latitude, lng: p.location?.longitude, phone: cleanPhone(p.internationalPhoneNumber), email: null,
        website: normalizeUrl(p.websiteUri), raw: { rating: p.rating, reviews: p.userRatingCount }, chain: false,
      });
    }
  }
  return out;
}

// --- Website inspection ---------------------------------------------------------------

export async function checkWebsite(url) {
  if (!url) return { exists: false };
  let host;
  try { host = new URL(url).hostname; } catch { return { exists: true, ok: false, error: 'Geçersiz adres' }; }
  if (SOCIAL_HOSTS.test(host)) return { exists: true, social_only: true, host };
  const started = Date.now();
  try {
    await assertPublicUrl(url);
    const res = await httpFetch(url, { redirect: 'follow', signal: AbortSignal.timeout(9000), headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
    const html = (await res.text()).slice(0, 400_000);
    const finalUrl = res.url || url;
    const years = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2}|19\d{2})/gi)].map((m) => Number(m[1]));
    const generator = (html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i) || [])[1] || null;
    return {
      exists: true,
      ok: res.ok,
      status: res.status,
      https: finalUrl.startsWith('https://'),
      mobile: /<meta[^>]+name=["']viewport["']/i.test(html),
      title: (html.match(/<title[^>]*>([^<]{0,120})/i) || [])[1]?.trim() || null,
      copyright_year: years.length ? Math.max(...years) : null,
      generator,
      parked: /domain (is )?for sale|bu alan ad[ıi] sat[ıi]l[ıi]k|parked|coming soon|yap[ıi]m aşamas[ıi]nda|under construction/i.test(html),
      ms: Date.now() - started,
      bytes: html.length,
    };
  } catch (err) {
    return { exists: true, ok: false, error: err.name === 'TimeoutError' ? 'Zaman aşımı' : err.message, ms: Date.now() - started };
  }
}

/** Deterministic score + human readable findings. Used as-is in demo mode and as AI input otherwise. */
export function heuristicScore(b, site) {
  const signals = [];
  let score = 0;
  if (!site.exists) { score += 55; signals.push('Web sitesi yok'); }
  else if (site.social_only) { score += 45; signals.push(`Sadece sosyal medya sayfası var (${site.host})`); }
  else if (!site.ok) { score += 40; signals.push(`Web sitesi açılmıyor (${site.error || site.status})`); }
  else {
    if (site.parked) { score += 35; signals.push('Site yapım aşamasında / park edilmiş'); }
    if (!site.https) { score += 12; signals.push('Güvenli bağlantı (HTTPS) yok'); }
    if (!site.mobile) { score += 15; signals.push('Mobil uyumlu değil'); }
    const age = site.copyright_year ? new Date().getFullYear() - site.copyright_year : 0;
    if (age >= 3) { score += Math.min(15, age * 3); signals.push(`Site güncel değil (© ${site.copyright_year})`); }
    if (site.ms > 4000) { score += 5; signals.push(`Site yavaş açılıyor (${(site.ms / 1000).toFixed(1)} sn)`); }
    if (site.https && site.mobile && age < 3 && !site.parked) signals.push('Güncel, mobil uyumlu bir sitesi var');
  }
  score += CATEGORIES[b.category]?.weight || 6;
  if (b.chain) { score -= 40; signals.push('Zincir marka (merkezi sitesi olabilir)'); }
  if (b.phone || b.email) score += 5; else signals.push('İletişim bilgisi bulunamadı');
  return { score: Math.max(0, Math.min(100, Math.round(score))), signals };
}

// --- AI analysis & message -------------------------------------------------------------

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'reason', 'suggested_product', 'message'],
  properties: {
    score: { type: 'integer', description: '0-100: bu işletmenin yeni/yenilenmiş bir web sitesine ihtiyaç duyma olasılığı' },
    reason: { type: 'string', description: 'Puanın kısa gerekçesi (1-2 cümle)' },
    suggested_product: { type: 'string', description: 'Katalogdan en uygun ürünün adı' },
    message: { type: 'string', description: 'İşletmeye gönderilecek kısa, kişisel ilk mesaj (imza ve ret cümlesi hariç)' },
  },
};

function templateMessage(b, signals, product) {
  const label = CATEGORIES[b.category]?.label?.toLocaleLowerCase('tr') || 'işletme';
  const hook = signals[0]?.startsWith('Web sitesi yok')
    ? `${b.name} için internette bir web sitesine rastlayamadım; müşterilerin çoğu artık bir ${label} seçmeden önce Google'da arama yapıyor.`
    : signals[0]?.startsWith('Sadece sosyal medya')
      ? `${b.name}'i sosyal medyada gördüm; Google'da çıkan kendi web siteniz olursa yeni müşterilere ulaşmanız çok daha kolay olur.`
      : `${b.name}'in web sitesine baktım: ${signals.filter((s) => !s.startsWith('Güncel')).slice(0, 2).join(', ').toLocaleLowerCase('tr')}.`;
  return `Merhaba, ${hook} Size özel, mobil uyumlu bir ${product || 'web sitesi'} hazırlayıp önce ücretsiz bir demosunu gösterebilirim. İlginizi çekerse kısaca konuşalım mı?`;
}

export async function analyzeOne(p) {
  const site = json(p.site_check) || {};
  const base = heuristicScore({ ...p, chain: json(p.raw)?.brand ? true : false }, site);
  const products = catalog().products;
  const fallbackProduct = (site.exists && site.ok ? products.find((x) => /tanıtım|kurumsal/i.test(x.name)) : products.find((x) => /landing|tanıtım/i.test(x.name)))?.name || products[0]?.name || 'web sitesi';
  if (config.aiMock) {
    mockGuard('prospect');
    return { score: base.score, signals: base.signals, reason: base.signals.slice(0, 2).join('; '), suggested_product: fallbackProduct, message: templateMessage(p, base.signals, fallbackProduct) };
  }
  const business = getSection('business');
  const r = await callClaude({
    purpose: 'prospect', schema: ANALYSIS_SCHEMA, effort: 'low', maxTokens: 3000,
    system: [
      `Sen "${business.name}" adlı web tasarım/yazılım işletmesi için çalışan bir satış araştırmacısısın.`,
      'Sana yakındaki bir işletmenin bilgileri ve web sitesi incelemesinin sonuçları verilecek.',
      '1) Bu işletmenin yeni veya yenilenmiş bir web sitesine ihtiyaç duyma olasılığını 0-100 arası puanla. Zincir markalar, kamu kurumları ve zaten iyi bir sitesi olanlar düşük puan alır.',
      '2) Katalogdan en uygun ürünü seç.',
      '3) İşletmeye gönderilecek ilk mesajı yaz: Türkçe, en fazla 4 cümle, samimi ama profesyonel, işletmenin adını ve incelemedeki somut bir gözlemi kullan, abartılı vaatlerde bulunma, fiyat yazma, ücretsiz demo teklif et ve kısa bir görüşme sor. İmza ve "mesaj almak istemezseniz" cümlesini EKLEME; sistem ekler.',
    ].join('\n'),
    messages: [{ role: 'user', content: JSON.stringify({
      isletme: { ad: p.name, kategori: CATEGORIES[p.category]?.label, adres: p.address, telefon: Boolean(p.phone), eposta: Boolean(p.email), web: p.website, ek: json(p.raw) },
      site_incelemesi: site, otomatik_bulgular: base.signals, kural_tabanli_puan: base.score,
      katalog: products.map((x) => ({ ad: x.name, fiyat: x.price, aciklama: x.description })),
    }) }],
  });
  return { score: Math.max(0, Math.min(100, r.score)), signals: base.signals, reason: r.reason, suggested_product: r.suggested_product, message: r.message };
}

// --- Do-not-contact ----------------------------------------------------------------------

export function isBlocked({ phone, email }) {
  return Boolean((phone && get('SELECT id FROM do_not_contact WHERE phone = ?', phone)) || (email && get('SELECT id FROM do_not_contact WHERE lower(email) = lower(?)', email)));
}

export function block({ phone, email }, reason) {
  if (!phone && !email) return;
  if (!isBlocked({ phone, email })) insert('do_not_contact', { phone: phone || null, email: email || null, reason });
  run(`UPDATE prospects SET status = 'opted_out' WHERE (phone IS NOT NULL AND phone = ?) OR (email IS NOT NULL AND lower(email) = lower(?))`, phone || '', email || '');
}

// --- Scanning -----------------------------------------------------------------------------

let scanning = false;
export const isScanning = () => scanning;

/** Scan around the configured (or given) location, store new businesses and analyze them. */
export async function scan(overrides = {}) {
  if (scanning) throw Object.assign(new Error('Bir tarama zaten sürüyor'), { status: 409 });
  scanning = true;
  const s = { ...getSection('prospecting'), ...overrides };
  const scanId = insert('prospect_scans', { location: s.location, radius_km: s.radius_km, categories: JSON.stringify(s.categories), source: s.source });
  const summary = { scanId, found: 0, added: 0, analyzed: 0, skipped: 0, errors: [] };
  try {
    let { lat, lng } = s;
    if ((lat == null || lng == null) && s.location) ({ lat, lng } = await geocode(s.location));
    if (lat == null || lng == null) throw new Error('Önce taranacak konumu girin (Ayarlar veya Bölge taraması sayfası)');
    update('prospect_scans', scanId, { lat, lng });
    const params = { lat: Number(lat), lng: Number(lng), radiusKm: Number(s.radius_km) || 2, categories: s.categories, limit: Number(s.max_per_scan) || 40 };
    const found = s.source === 'google' ? await fetchGoogle(params) : await fetchOsm(params);
    summary.found = found.length;
    for (const b of found) {
      if (summary.added >= params.limit) break;
      if (get('SELECT id FROM prospects WHERE source = ? AND source_id = ?', b.source, b.source_id)) continue;
      if ((b.phone && get('SELECT id FROM prospects WHERE phone = ?', b.phone)) || isBlocked(b)) { summary.skipped++; continue; }
      const id = insert('prospects', {
        source: b.source, source_id: b.source_id, name: b.name, category: b.category, address: b.address, lat: b.lat, lng: b.lng,
        phone: b.phone, email: b.email, website: b.website, raw: JSON.stringify({ ...b.raw, brand: b.chain ? (b.raw?.brand || true) : undefined }), scan_id: scanId,
      });
      summary.added++;
      try {
        await analyzeProspect(id);
        summary.analyzed++;
      } catch (err) {
        if (err instanceof AiUnavailableError) { summary.errors.push(err.message); break; }
        summary.errors.push(`${b.name}: ${err.message}`);
      }
    }
    update('prospect_scans', scanId, { found: summary.found, added: summary.added, analyzed: summary.analyzed, status: 'ok', finished_at: new Date().toISOString(), message: summary.errors.slice(0, 3).join(' · ') || null });
    return summary;
  } catch (err) {
    update('prospect_scans', scanId, { status: 'error', message: err.message, finished_at: new Date().toISOString() });
    throw err;
  } finally {
    scanning = false;
  }
}

export async function analyzeProspect(id) {
  const p = get('SELECT * FROM prospects WHERE id = ?', id);
  if (!p) throw new Error('İşletme bulunamadı');
  const site = await checkWebsite(p.website);
  update('prospects', id, { site_check: JSON.stringify(site) });
  const r = await analyzeOne({ ...p, site_check: JSON.stringify(site) });
  update('prospects', id, {
    score: r.score, score_reason: r.reason, signals: JSON.stringify(r.signals), suggested_product: r.suggested_product,
    message: r.message, status: ['new', 'analyzed'].includes(p.status) ? 'analyzed' : p.status, analyzed_at: new Date().toISOString(),
  });
  return get('SELECT * FROM prospects WHERE id = ?', id);
}

// --- Contacting -----------------------------------------------------------------------------

export function fullMessage(p, text = p.message) {
  const s = getSection('prospecting');
  const sign = s.signature || `${getSection('business').owner_name} · ${getSection('business').name}`;
  return `${text}\n\n${sign}\n\n${s.opt_out_text}`;
}

export const contactedToday = () => get(`SELECT COUNT(*) AS n FROM prospects WHERE contacted_at >= ?`, new Date(new Date().setHours(0, 0, 0, 0)).toISOString()).n;

function linkConversation(p, channel, body) {
  const conv = channel === 'email'
    ? findOrCreateConversation({ channel: 'email', externalId: p.email.toLowerCase(), name: p.name, email: p.email, platform: 'bolge' })
    : findOrCreateConversation({ channel: 'whatsapp', externalId: p.phone, name: p.name, phone: p.phone, email: p.email, platform: 'bolge' });
  run(`UPDATE customers SET platform = 'bolge' WHERE id = ? AND platform IS NULL`, conv.customer_id);
  addMessage(conv.id, 'ai', body, { outreach: true, prospect_id: p.id, channel });
  return conv;
}

export function whatsappLink(p, text = p.message) {
  return p.phone && text ? `https://wa.me/${p.phone}?text=${encodeURIComponent(fullMessage(p, text))}` : null;
}

/**
 * Send (email / WhatsApp template) or record a manual send (wa.me link, phone call).
 * `channel`: email | whatsapp | whatsapp_link | phone
 */
export async function contact(id, { channel, message } = {}) {
  const p = get('SELECT * FROM prospects WHERE id = ?', id);
  if (!p) throw Object.assign(new Error('İşletme bulunamadı'), { status: 404 });
  if (['contacted', 'replied', 'converted'].includes(p.status)) throw new Error('Bu işletmeyle zaten iletişime geçildi');
  if (p.status === 'opted_out' || isBlocked(p)) throw new Error('Bu işletme mesaj almak istemediğini bildirdi');
  const text = (message ?? p.message ?? '').trim();
  if (!text) throw new Error('Gönderilecek mesaj boş');
  if (message !== undefined) update('prospects', id, { message: text });
  const body = fullMessage(p, text);

  if (channel === 'email') {
    if (!p.email) throw new Error('Bu işletmenin e-posta adresi yok');
    if (!config.smtp.host) throw new Error('E-posta göndermek için .env dosyasında SMTP ayarlarını yapın (veya WhatsApp bağlantısını kullanın)');
    await sendMail({ to: p.email, subject: `${p.name} için web sitesi önerisi`, text: body });
  } else if (channel === 'whatsapp') {
    if (!p.phone) throw new Error('Bu işletmenin telefonu yok');
    if (!config.whatsapp.token || !config.whatsapp.outreachTemplate) throw new Error('WhatsApp ile otomatik ilk mesaj için WHATSAPP_TOKEN ve onaylı bir WHATSAPP_OUTREACH_TEMPLATE gerekir; "WhatsApp\'ta aç" seçeneğini kullanın');
    await sendWhatsAppTemplate(p.phone, config.whatsapp.outreachTemplate, config.whatsapp.templateLang, [p.name]);
  } else if (channel === 'whatsapp_link' || channel === 'phone') {
    if (!p.phone) throw new Error('Bu işletmenin telefonu yok');
    // Sent by the admin from their own phone / WhatsApp; we only record it.
  } else {
    throw new Error('Geçersiz kanal');
  }

  const conv = channel === 'phone' ? null : linkConversation(p, channel === 'email' ? 'email' : 'whatsapp', channel === 'whatsapp' ? `[Şablon: ${config.whatsapp.outreachTemplate}] ${body}` : body);
  update('prospects', id, { status: 'contacted', channel, contacted_at: new Date().toISOString(), conversation_id: conv?.id ?? null, customer_id: conv?.customer_id ?? null });
  return get('SELECT * FROM prospects WHERE id = ?', id);
}

/** Scheduled/batch sending: email or WhatsApp template only, never beyond the daily limit. */
export async function autoSend({ max = Infinity } = {}) {
  const s = getSection('prospecting');
  let budget = Math.min(max, Math.max(0, s.daily_limit - contactedToday()));
  const sent = [];
  const skipped = [];
  if (!budget) return { sent, skipped, reason: 'Günlük gönderim sınırına ulaşıldı' };
  const waReady = config.whatsapp.token && config.whatsapp.outreachTemplate;
  const candidates = all(`SELECT * FROM prospects WHERE status = 'analyzed' AND score >= ? ORDER BY score DESC`, s.min_score);
  for (const p of candidates) {
    if (!budget) break;
    const order = s.prefer_channel === 'whatsapp' ? ['whatsapp', 'email'] : ['email', 'whatsapp'];
    const channel = order.find((c) => (c === 'email' ? p.email && config.smtp.host : p.phone && waReady));
    if (!channel) { skipped.push(p.name); continue; }
    try {
      await contact(p.id, { channel });
      sent.push(p.name);
      budget--;
    } catch (err) {
      skipped.push(`${p.name} (${err.message})`);
    }
  }
  return { sent, skipped };
}

export function skip(id) {
  update('prospects', id, { status: 'skipped' });
}

/** Called for every inbound customer message; handles opt-outs and marks replies. */
// Matched on the Turkish-lowercased text: a plain /i regex doesn't fold "İPTAL" to "iptal".
const OPT_OUT = /^\s*(iptal|stop|dur|durdur|istemiyorum|rahatsız etmeyin|mesaj atmayın|unsubscribe)(?=$|[\s.,;:!?])/u;
export function onInboundMessage(conv, customer, text) {
  const p = get(`SELECT * FROM prospects WHERE conversation_id = ?`, conv.id);
  if (!p) return { optedOut: false };
  if ([String(text).toLocaleLowerCase('tr'), String(text).toLowerCase()].some((t) => OPT_OUT.test(t))) {
    block({ phone: customer?.phone || p.phone, email: customer?.email || p.email }, 'Müşteri İPTAL yazdı');
    return { optedOut: true, prospect: p };
  }
  if (p.status === 'contacted') {
    update('prospects', p.id, { status: 'replied' });
    notifyAdmin('prospect_replied', `Bölge taramasından cevap geldi: ${p.name}`, text, `/conversations/${conv.id}`).catch(() => {});
  }
  return { optedOut: false, prospect: p };
}

export function stats() {
  const n = (sql, ...a) => get(sql, ...a).n;
  return {
    total: n('SELECT COUNT(*) AS n FROM prospects'),
    analyzed: n(`SELECT COUNT(*) AS n FROM prospects WHERE status = 'analyzed'`),
    hot: n(`SELECT COUNT(*) AS n FROM prospects WHERE status = 'analyzed' AND score >= ?`, getSection('prospecting').min_score),
    contacted: n(`SELECT COUNT(*) AS n FROM prospects WHERE status IN ('contacted','replied','converted')`),
    replied: n(`SELECT COUNT(*) AS n FROM prospects WHERE status IN ('replied','converted')`),
    opted_out: n(`SELECT COUNT(*) AS n FROM prospects WHERE status = 'opted_out'`),
    today: contactedToday(),
    daily_limit: getSection('prospecting').daily_limit,
  };
}
