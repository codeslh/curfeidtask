// "Bölge taraması": find nearby businesses, judge by simple rules how likely they are
// to need a website, fill in a message template and (when you approve) contact them.
import { config } from '../config.js';
import { all, get, insert, run, update } from '../db.js';
import { assertPublicUrl, httpFetch, USER_AGENT } from './http.js';
import { addMessage, findOrCreateConversation } from './inbox.js';
import { notifyAdmin, sendMail } from './notify.js';
import { getSection } from './settings.js';
import { render, template } from './templates.js';
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

const why = (err) => (err.name === 'TimeoutError' ? 'zaman aşımı' : err.cause?.code || err.message);

// Nominatim first; Photon (also OpenStreetMap data, no key) when Nominatim is down or blocks us.
export async function geocode(query) {
  query = String(query || '').trim();
  if (!query) throw new Error('Taranacak konumu yazın (ör. "Kadıköy, İstanbul")');
  const tried = [];
  try {
    const url = `${config.nominatimUrl}/search?format=json&limit=1&accept-language=tr&q=${encodeURIComponent(query)}`;
    const res = await httpFetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Language': 'tr' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const [hit] = await res.json();
    if (hit) return { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name };
    tried.push('Nominatim: sonuç yok');
  } catch (err) {
    tried.push(`Nominatim: ${why(err)}`);
  }
  try {
    const res = await httpFetch(`${config.photonUrl}/api/?limit=1&q=${encodeURIComponent(query)}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const f = (await res.json()).features?.[0];
    if (f) {
      const [lng, lat] = f.geometry.coordinates;
      const p = f.properties || {};
      return { lat, lng, label: [p.name, p.district, p.city, p.country].filter(Boolean).join(', ') };
    }
    tried.push('Photon: sonuç yok');
  } catch (err) {
    tried.push(`Photon: ${why(err)}`);
  }
  if (tried.every((t) => t.endsWith('sonuç yok'))) throw new Error(`"${query}" için konum bulunamadı. Daha açık yazın (ör. "Kadıköy, İstanbul") veya haritada bir noktaya tıklayın.`);
  throw new Error(`Konum servislerine ulaşılamadı (${tried.join('; ')}). İnternet bağlantınızı kontrol edin veya haritada bir noktaya tıklayarak tarayın.`);
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

// The free public Overpass servers are often busy (429 / 504); try the next one when that happens.
async function overpass(query) {
  const errors = [];
  for (const url of config.overpassUrls) {
    try {
      const res = await httpFetch(url, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(35000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('geçersiz yanıt'); }
      // A timed-out query still answers 200, with a "remark" and no elements.
      if (!data.elements?.length && /timed out|out of memory|error/i.test(data.remark || '')) throw new Error(data.remark);
      return data;
    } catch (err) {
      errors.push(`${new URL(url).hostname}: ${why(err)}`);
    }
  }
  throw new Error(`OpenStreetMap sunucularına ulaşılamadı veya hepsi meşgul (${errors.join('; ')}). Birkaç dakika sonra tekrar deneyin ya da yarıçapı / kategori sayısını azaltın. Sorun sürerse haritada daha küçük bir alana tıklayarak tarayın.`);
}

const toRad = (d) => (d * Math.PI) / 180;
export function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * A light Overpass query: one bounding box for the whole query and one regex filter per tag key
 * (instead of a separate "around" search per category, which the free servers often time out on).
 * Results outside the circle are dropped afterwards.
 */
export function osmQuery({ lat, lng, radiusKm, categories, limit }, keys = null) {
  const byKey = {};
  for (const c of categories) for (const [k, v] of CATEGORIES[c]?.osm || []) (byKey[k] ??= new Set()).add(v);
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.cos(toRad(lat)));
  const bbox = [lat - dLat, lng - dLng, lat + dLat, lng + dLng].map((x) => x.toFixed(6)).join(',');
  const stmts = Object.entries(byKey).filter(([k]) => !keys || keys.includes(k)).flatMap(([k, vals]) => {
    const f = `["${k}"~"^(${[...vals].join('|')})$"]["name"]`;
    return [`node${f};`, `way${f};`];
  });
  return { keys: Object.keys(byKey), query: `[out:json][timeout:25][bbox:${bbox}];(${stmts.join('')});out tags center ${Math.max(limit * 4, 80)};` };
}

export async function fetchOsm({ lat, lng, radiusKm, categories, limit }) {
  const params = { lat, lng, radiusKm: Math.min(radiusKm, 15), categories, limit };
  const { keys, query } = osmQuery(params);
  if (!keys.length) throw new Error('En az bir kategori seçin');
  let elements;
  try {
    elements = (await overpass(query)).elements || [];
  } catch (err) {
    // Still too heavy for the busy servers: ask for one tag key at a time and keep what comes back.
    if (keys.length < 2) throw err;
    elements = [];
    let ok = 0;
    for (const k of keys) {
      try { elements.push(...((await overpass(osmQuery(params, [k]).query)).elements || [])); ok++; } catch { /* try the next key */ }
    }
    if (!ok) throw err;
  }
  const center = { lat, lng };
  const seen = new Set();
  return elements.map((el) => {
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
  })
    .filter((b) => b.name && b.lat && b.lng && !seen.has(b.source_id) && seen.add(b.source_id))
    .map((b) => ({ ...b, distance: distanceKm(center, b) }))
    .filter((b) => b.distance <= params.radiusKm)
    .sort((a, b) => a.distance - b.distance);
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

/** Rule-based score (0-100) + human readable findings. */
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

/** Picks the template that fits the findings (no site / social only / weak site). */
export function draftMessage(p, signals) {
  const vars = {
    ad: p.name,
    kategori: CATEGORIES[p.category]?.label?.toLocaleLowerCase('tr') || 'işletme',
    bulgu: signals.filter((s) => !/^(Güncel|İletişim|Zincir)/.test(s)).slice(0, 2).join(', ').toLocaleLowerCase('tr') || 'sitenizi yenileyebiliriz',
  };
  const key = !signals.length || signals[0].startsWith('Web sitesi yok') || signals[0].startsWith('Web sitesi açılmıyor') ? 'prospect_no_site'
    : signals[0].startsWith('Sadece sosyal medya') ? 'prospect_social' : 'prospect_old_site';
  return render(template(key), vars);
}

export function analyzeOne(p) {
  const site = json(p.site_check) || {};
  const r = heuristicScore({ ...p, chain: Boolean(json(p.raw)?.brand) }, site);
  return { ...r, reason: r.signals.slice(0, 2).join('; '), message: draftMessage(p, r.signals) };
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
  const r = analyzeOne({ ...p, site_check: JSON.stringify(site) });
  update('prospects', id, {
    score: r.score, score_reason: r.reason, signals: JSON.stringify(r.signals),
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

function linkConversation(p, channel, body, subject) {
  const conv = channel === 'email'
    ? findOrCreateConversation({ channel: 'email', externalId: p.email.toLowerCase(), name: p.name, email: p.email, platform: 'bolge' })
    : findOrCreateConversation({ channel: 'whatsapp', externalId: p.phone, name: p.name, phone: p.phone, email: p.email, platform: 'bolge' });
  run(`UPDATE customers SET platform = 'bolge' WHERE id = ? AND platform IS NULL`, conv.customer_id);
  addMessage(conv.id, 'admin', body, { outreach: true, prospect_id: p.id, channel, ...(subject ? { subject } : {}) });
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
    await sendMail({ to: p.email, subject: render(template('prospect_subject'), { ad: p.name }), text: body });
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

  const conv = channel === 'phone' ? null : linkConversation(p, channel === 'email' ? 'email' : 'whatsapp',
    channel === 'whatsapp' ? `[Şablon: ${config.whatsapp.outreachTemplate}] ${body}` : body,
    channel === 'email' ? render(template('prospect_subject'), { ad: p.name }) : null);
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
    const channel = ['email', 'whatsapp'].find((c) => (c === 'email' ? p.email && config.smtp.host : p.phone && waReady));
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
