// Listing categories. You pick categories instead of typing keywords; each category
// carries its own Turkish + English terms, a Freelancer.com search query and the
// matching Remotive (remote jobs API) category.
//
// Terms are matched as whole words/phrases; a trailing * matches word starts
// ("copywrit*" matches copywriter, copywriting).

export const CATEGORIES = {
  web: {
    label: 'Web sitesi / web tasarım', query: 'website', remotive: 'software-dev',
    terms: ['web sitesi', 'web site', 'websitesi', 'website', 'web tasarım', 'web tasarımı', 'web design', 'web designer', 'landing page', 'kurumsal site', 'html', 'css', 'frontend', 'front-end', 'front end', 'web developer', 'web geliştirici', 'web yazılım*', 'webflow', 'wix'],
  },
  ecommerce: {
    label: 'E-ticaret', query: 'ecommerce', remotive: 'software-dev',
    terms: ['e-ticaret', 'eticaret', 'e-commerce', 'ecommerce', 'shopify', 'woocommerce', 'ikas', 'ticimax', 'ideasoft', 'opencart', 'magento', 'online mağaza', 'online store', 'sanal mağaza', 'trendyol', 'hepsiburada', 'amazon store'],
  },
  wordpress: {
    label: 'WordPress', query: 'wordpress', remotive: 'software-dev',
    terms: ['wordpress', 'wp', 'elementor', 'woocommerce', 'wp tema*', 'wordpress tema*'],
  },
  mobile: {
    label: 'Mobil uygulama', query: 'mobile app', remotive: 'software-dev',
    terms: ['mobil uygulama', 'mobil app', 'mobile app', 'mobile application', 'android', 'ios', 'iphone uygulama*', 'flutter', 'react native', 'swift', 'kotlin', 'app store', 'play store'],
  },
  software: {
    label: 'Yazılım geliştirme', query: 'software development', remotive: 'software-dev',
    terms: ['yazılım', 'yazılımcı', 'software', 'developer', 'geliştirici', 'programmer', 'programcı', 'backend', 'back-end', 'full stack', 'fullstack', 'full-stack', 'python', 'java', 'javascript', 'typescript', 'php', 'laravel', 'node', 'nodejs', 'node.js', 'react', 'vue', 'angular', '.net', 'c#', 'golang', 'django', 'api', 'saas'],
  },
  design: {
    label: 'Grafik / logo tasarım', query: 'logo design', remotive: 'design',
    terms: ['logo', 'grafik', 'grafiker', 'graphic', 'graphic design*', 'kurumsal kimlik', 'branding', 'marka kimliği', 'afiş', 'poster', 'broşür', 'brochure', 'katalog tasarım*', 'ambalaj', 'packaging', 'illüstrasyon', 'illustrat*', 'photoshop', 'illustrator', 'canva', 'banner', 'kartvizit'],
  },
  uiux: {
    label: 'UI / UX tasarım', query: 'ui ux design', remotive: 'design',
    terms: ['ui', 'ux', 'ui/ux', 'figma', 'arayüz tasarım*', 'user interface', 'user experience', 'product design*', 'ürün tasarım*', 'prototip', 'prototype', 'wireframe'],
  },
  seo: {
    label: 'SEO / dijital pazarlama', query: 'seo', remotive: 'marketing',
    terms: ['seo', 'sem', 'google ads', 'adwords', 'meta ads', 'facebook ads', 'instagram reklam*', 'reklam yönetimi', 'dijital pazarlama', 'digital marketing', 'performance marketing', 'performans pazarlama', 'growth', 'e-posta pazarlama', 'email marketing', 'google analytics'],
  },
  social: {
    label: 'Sosyal medya', query: 'social media', remotive: 'marketing',
    terms: ['sosyal medya', 'social media', 'instagram', 'tiktok', 'youtube kanal*', 'içerik üretici*', 'içerik üretimi', 'content creator', 'community manager', 'influencer'],
  },
  writing: {
    label: 'İçerik / metin yazarlığı', query: 'content writing', remotive: 'writing',
    terms: ['metin yazar*', 'içerik yazar*', 'copywrit*', 'content writ*', 'blog', 'makale', 'article', 'redaktör', 'editör', 'editor', 'senaryo', 'script writ*', 'ghostwrit*'],
  },
  translation: {
    label: 'Çeviri', query: 'translation', remotive: 'writing',
    terms: ['çeviri', 'çevirmen', 'tercüme', 'tercüman', 'translat*', 'localization', 'lokalizasyon', 'altyazı', 'subtitl*'],
  },
  video: {
    label: 'Video / animasyon', query: 'video editing', remotive: 'design',
    terms: ['video', 'montaj', 'kurgu', 'animasyon', 'animation', 'motion', 'motion graphic*', 'after effects', 'premiere', 'video edit*', '3d', 'render', 'reels'],
  },
  data: {
    label: 'Veri / Excel / veri girişi', query: 'data entry', remotive: 'data',
    terms: ['excel', 'veri giriş*', 'data entry', 'veri analiz*', 'data analy*', 'data scien*', 'veri bilim*', 'power bi', 'tableau', 'sql', 'scraping', 'web scraping', 'veri kazıma', 'google sheets', 'raporlama'],
  },
  devops: {
    label: 'Sunucu / DevOps / sistem', query: 'devops', remotive: 'devops',
    terms: ['devops', 'sunucu', 'server', 'linux', 'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'hosting', 'sistem yönetici*', 'system admin*', 'sysadmin', 'network', 'ağ yönetici*', 'siber güvenlik', 'cyber security', 'cybersecurity'],
  },
  ai: {
    label: 'Yapay zeka / otomasyon', query: 'automation', remotive: 'software-dev',
    terms: ['yapay zeka', 'ai', 'machine learning', 'makine öğren*', 'deep learning', 'chatbot', 'otomasyon', 'automation', 'bot', 'gpt', 'llm', 'n8n', 'zapier', 'make.com'],
  },
  game: {
    label: 'Oyun geliştirme', query: 'game development', remotive: 'software-dev',
    terms: ['oyun', 'game', 'unity', 'unreal', 'godot', 'oyun geliştir*', 'game develop*'],
  },
  support: {
    label: 'Müşteri hizmetleri / destek', query: 'customer support', remotive: 'customer-support',
    terms: ['müşteri hizmet*', 'müşteri temsilci*', 'customer support', 'customer service', 'çağrı merkezi', 'call center', 'destek uzman*', 'support specialist', 'help desk', 'teknik destek'],
  },
  sales: {
    label: 'Satış / pazarlama', query: 'sales', remotive: 'sales',
    terms: ['satış', 'satış temsilci*', 'sales', 'pazarlama uzman*', 'marketing specialist', 'marketing manager', 'business development', 'iş geliştirme', 'account manager'],
  },
  finance: {
    label: 'Muhasebe / finans', query: 'accounting', remotive: 'finance',
    terms: ['muhasebe', 'muhasebeci', 'accounting', 'accountant', 'finans', 'finance', 'mali müşavir', 'bookkeep*', 'ön muhasebe', 'bordro'],
  },
  hr: {
    label: 'İnsan kaynakları', query: 'recruiter', remotive: 'hr',
    terms: ['insan kaynakları', 'human resources', 'ik uzman*', 'hr', 'işe alım', 'recruit*', 'talent acquisition'],
  },
  assistant: {
    label: 'Sanal asistan / ofis', query: 'virtual assistant', remotive: 'all-others',
    terms: ['sanal asistan', 'virtual assistant', 'asistan', 'sekreter', 'ofis personeli', 'office assistant', 'admin assistant', 'yönetici asistan*'],
  },
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const L = '\\p{L}\\p{N}';

function compile(term) {
  const prefix = term.endsWith('*');
  const t = escape(term.replace(/\*$/, '').toLocaleLowerCase('tr'));
  return new RegExp(`(?:^|[^${L}])${t}${prefix ? '' : `(?=$|[^${L}])`}`, 'u');
}

const COMPILED = Object.fromEntries(Object.entries(CATEGORIES).map(([k, c]) => [k, c.terms.map(compile)]));
export const compileTerms = (terms) => terms.filter(Boolean).map(compile);

const lower = (s) => String(s || '').toLocaleLowerCase('tr');
// Turkish İ/I lower differently depending on locale; check both spellings.
const forms = (s) => [...new Set([lower(s), String(s || '').toLowerCase()])];
export const hits = (text, regexes) => forms(text).reduce((best, t) => Math.max(best, regexes.filter((r) => r.test(t)).length), 0);

/**
 * Which categories a listing belongs to. Title matches count double.
 * Returns { best, all: [keys sorted by strength], strength: {key: n} }.
 */
export function classify({ title = '', description = '', skills = [] }) {
  const body = `${description} ${[].concat(skills).join(' ')}`;
  const strength = {};
  for (const [key, regs] of Object.entries(COMPILED)) {
    const n = hits(title, regs) * 2 + Math.min(hits(body, regs), 3);
    if (n) strength[key] = n;
  }
  const keys = Object.keys(strength).sort((a, b) => strength[b] - strength[a]);
  return { best: keys[0] || null, all: keys, strength };
}

export const categoryLabel = (key) => (key === 'custom' ? 'Kendi kelimelerim' : CATEGORIES[key]?.label || key || '—');
