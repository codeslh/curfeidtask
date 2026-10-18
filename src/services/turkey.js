// Türkiye'deki iş ilanları için: il tanıma (81 il + büyük şehirlerin bilinen ilçeleri),
// "Türkiye'de mi?" kontrolü ve çalışma türü (tam/yarı zamanlı, uzaktan, hibrit...) tanıma.
import { compileTerms, hits } from './categories.js';

export const PROVINCES = [
  'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Aksaray', 'Amasya', 'Ankara', 'Antalya', 'Ardahan', 'Artvin', 'Aydın',
  'Balıkesir', 'Bartın', 'Batman', 'Bayburt', 'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale',
  'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır', 'Düzce', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir',
  'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari', 'Hatay', 'Iğdır', 'Isparta', 'İstanbul', 'İzmir', 'Kahramanmaraş',
  'Karabük', 'Karaman', 'Kars', 'Kastamonu', 'Kayseri', 'Kırıkkale', 'Kırklareli', 'Kırşehir', 'Kilis', 'Kocaeli',
  'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Mardin', 'Mersin', 'Muğla', 'Muş', 'Nevşehir', 'Niğde', 'Ordu',
  'Osmaniye', 'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop', 'Sivas', 'Şanlıurfa', 'Şırnak', 'Tekirdağ', 'Tokat',
  'Trabzon', 'Tunceli', 'Uşak', 'Van', 'Yalova', 'Yozgat', 'Zonguldak',
];

// Other spellings (English / without Turkish letters) and well-known districts.
const ALIASES = {
  İstanbul: ['istanbul', 'kadıköy', 'kadikoy', 'beşiktaş', 'besiktas', 'şişli', 'sisli', 'üsküdar', 'uskudar', 'ataşehir', 'atasehir', 'maslak', 'levent', 'sarıyer', 'sariyer',
    'beyoğlu', 'beyoglu', 'bakırköy', 'bakirkoy', 'kartal', 'pendik', 'ümraniye', 'umraniye', 'maltepe', 'esenyurt', 'beylikdüzü', 'beylikduzu', 'avcılar', 'bağcılar',
    'küçükçekmece', 'başakşehir', 'basaksehir', 'kağıthane', 'kagithane', 'tuzla', 'eyüpsultan', 'zeytinburnu', 'bahçelievler', 'sancaktepe', 'çekmeköy', 'beykoz'],
  Ankara: ['çankaya', 'cankaya', 'yenimahalle', 'keçiören', 'kecioren', 'etimesgut', 'sincan', 'mamak', 'gölbaşı'],
  İzmir: ['izmir', 'smyrna', 'bornova', 'karşıyaka', 'karsiyaka', 'buca', 'bayraklı', 'bayrakli', 'çiğli', 'gaziemir', 'karabağlar'],
  Bursa: ['nilüfer', 'nilufer', 'osmangazi', 'yıldırım'],
  Antalya: ['muratpaşa', 'muratpasa', 'konyaaltı', 'konyaalti', 'kepez', 'alanya', 'manavgat'],
  Kocaeli: ['izmit', 'gebze', 'darıca', 'körfez'],
  Muğla: ['mugla', 'bodrum', 'fethiye', 'marmaris', 'dalaman'],
  Mersin: ['icel', 'içel', 'tarsus'],
  Hatay: ['antakya', 'iskenderun'],
  Sakarya: ['adapazarı', 'adapazari'],
  Kahramanmaraş: ['kahramanmaras', 'maraş'],
  Şanlıurfa: ['sanliurfa', 'urfa'],
  Eskişehir: ['eskisehir'],
  Diyarbakır: ['diyarbakir'],
  Tekirdağ: ['tekirdag', 'çorlu', 'corlu'],
  Çanakkale: ['canakkale'],
  Gaziantep: ['antep'],
  Afyonkarahisar: ['afyon'],
};

const fold = (s) => String(s || '').toLocaleLowerCase('tr')
  .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/â/g, 'a');

// Each province matches its own name with or without Turkish letters, plus its aliases.
const CITY_TERMS = PROVINCES.map((p) => [p, compileTerms([...new Set([p.toLocaleLowerCase('tr'), fold(p), ...(ALIASES[p] || [])])])]);

/** The province a text mentions (location first, then title/description), or null. */
export function detectCity(...texts) {
  for (const text of texts) {
    if (!text) continue;
    const folded = fold(text);
    for (const [city, regs] of CITY_TERMS) if (hits(text, regs) || hits(folded, regs)) return city;
  }
  return null;
}

const TURKEY = compileTerms(['türkiye', 'turkiye', 'turkey', 'türkiye cumhuriyeti', 'tr']);
export const mentionsTurkey = (text) => Boolean(text) && hits(text, TURKEY) > 0;

/**
 * Is a job listing in Turkey?
 * Turkish job sites count as Turkey; otherwise the location (or the text, when there
 * is no location) must name Turkey or a Turkish city. A Turkish-language listing with
 * no location is assumed to be in Turkey.
 */
export function inTurkey({ location, title, description, lang, platformCountry }) {
  if (platformCountry === 'tr') return true;
  if (location) return mentionsTurkey(location) || Boolean(detectCity(location));
  if (mentionsTurkey(`${title} ${description}`) || detectCity(title)) return true;
  return lang === 'tr';
}

export const WORK_TYPES = {
  full_time: 'Tam zamanlı',
  part_time: 'Yarı zamanlı',
  remote: 'Uzaktan',
  hybrid: 'Hibrit',
  internship: 'Staj',
  contract: 'Sözleşmeli / proje bazlı',
};

const WORK_TERMS = {
  full_time: compileTerms(['tam zamanlı', 'tam zamanli', 'full time', 'full-time', 'fulltime', 'kadrolu']),
  part_time: compileTerms(['yarı zamanlı', 'yari zamanli', 'part time', 'part-time', 'parttime', 'yarı zaman']),
  remote: compileTerms(['uzaktan', 'remote', 'evden çalış*', 'home office', 'ev ofis', 'work from home', 'wfh']),
  hybrid: compileTerms(['hibrit', 'hybrid', 'hibrid']),
  internship: compileTerms(['staj', 'stajyer', 'intern', 'internship', 'uzun dönem stajyer']),
  contract: compileTerms(['sözleşmeli', 'proje bazlı', 'proje bazli', 'dönemsel', 'geçici', 'contract', 'contractor', 'freelance', 'serbest']),
};
// job_type values used by APIs (e.g. Remotive) mapped to ours.
const API_TYPES = { full_time: 'full_time', part_time: 'part_time', contract: 'contract', freelance: 'contract', internship: 'internship' };

/** Work types a listing mentions (several can apply: "tam zamanlı, hibrit"). */
export function detectWorkTypes({ title = '', description = '', location = '', job_type = null, remote = false }) {
  const found = new Set();
  if (API_TYPES[job_type]) found.add(API_TYPES[job_type]);
  const text = `${title} ${location} ${String(description).slice(0, 3000)}`;
  for (const [k, regs] of Object.entries(WORK_TERMS)) if (hits(text, regs)) found.add(k);
  if (remote) found.add('remote');
  return [...found];
}
