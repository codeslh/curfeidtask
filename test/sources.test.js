import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { client, tmp } from './helpers.js';

const { openDb, get, all, run } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { saveSection } = await import('../src/services/settings.js');
const { setFetch, setLookup } = await import('../src/services/http.js');
const sources = await import('../src/services/sources.js');
const { detectLanguage, chunk } = await import('../src/services/translate.js');
const { classify } = await import('../src/services/categories.js');

const html = (body) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });
const calls = [];
let quotaLeft = Infinity;

const FORUM = `<html><body><nav><a href="/">Ana sayfa</a><a href="/giris">Giriş</a></nav>
  <a href="/konu/123-kuafor-icin-web-sitesi">Kuaför salonu için web sitesi yapılacak</a>
  <a href="/konu/124-logo">Logo tasarımı yaptırılacak, acil iş</a>
  <a href="/uye/ahmet-yilmaz-profil">Ahmet Yılmaz kullanıcısının profili</a>
  <a href="https://baska-site.test/konu/9">Başka sitedeki uzun bir bağlantı metni</a></body></html>`;
const FEED_PAGE = '<html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head><body>İlanlar</body></html>';
const FEED = `<?xml version="1.0"?><rss><channel>
  <item><title>WordPress kurumsal site</title><link>https://ilan.test/1</link><guid>1</guid><description>Bütçe: 5.000 TL. İletişim: ali@firma.test</description><pubDate>${new Date().toUTCString()}</pubDate></item>
  <item><title>Excel makrosu</title><link>https://ilan.test/2</link><guid>2</guid><description>Basit makro</description></item>
</channel></rss>`;

async function fakeFetch(url) {
  url = String(url);
  calls.push(url);
  if (url.startsWith('https://www.freelancer.com/api/projects/')) {
    return Response.json({ result: { projects: [
      { id: 1, title: 'Need a website for my cafe', description: 'Small website, contact me', budget: { minimum: 100, maximum: 300 }, currency: { code: 'USD' }, seo_url: 'cafe-site', time_submitted: Math.floor(Date.now() / 1000), jobs: [{ name: 'HTML' }] },
      { id: 2, title: 'Crypto trading bot', description: 'Telegram bot', budget: { minimum: 500, maximum: 900 }, currency: { code: 'USD' }, seo_url: 'bot', jobs: [] },
    ] } });
  }
  if (url.startsWith('https://api.mymemory.translated.net/get')) {
    const q = new URL(url).searchParams;
    if (quotaLeft-- <= 0) return Response.json({ responseStatus: 429, quotaFinished: true, responseDetails: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' });
    assert.equal(q.get('langpair'), 'en|tr');
    return Response.json({ responseStatus: 200, responseData: { translatedText: `TR[${q.get('q')}]` } });
  }
  if (url.startsWith('https://remotive.com/api/remote-jobs')) {
    assert.equal(new URL(url).searchParams.get('category'), 'software-dev');
    return Response.json({ jobs: [
      { id: 11, url: 'https://remotive.com/remote-jobs/software-dev/backend-11', title: 'Senior Backend Developer (Node.js)', company_name: 'Acme', category: 'Software Development',
        job_type: 'full_time', publication_date: new Date().toISOString(), candidate_required_location: 'Worldwide', salary: '$80k - $100k', description: '<p>We are hiring a backend developer.</p>', tags: ['node'] },
      { id: 12, url: 'https://remotive.com/remote-jobs/customer-support/cs-12', title: 'Customer Support Specialist', company_name: 'Beta', category: 'Customer Service',
        job_type: 'full_time', publication_date: new Date().toISOString(), candidate_required_location: 'USA', salary: '', description: '<p>Help our customers by email.</p>', tags: [] },
    ] });
  }
  if (url === 'https://forum.test/hizmet-alim/') return html(FORUM);
  if (url === 'https://ilan.test/') return html(FEED_PAGE);
  if (url === 'https://ilan.test/rss.xml') return new Response(FEED, { headers: { 'Content-Type': 'application/rss+xml' } });
  if (url === 'https://spa.test/') return html('<html><body><div id="app"></div><script src="/app.js"></script></body></html>');
  throw new Error(`beklenmeyen istek: ${url}`);
}

let server;
let admin;

before(async () => {
  openDb();
  sources.seedSources();
  run(`UPDATE sources SET enabled = 1 WHERE kind = 'remotive_api'`);
  setFetch(fakeFetch);
  setLookup(async (host) => [{ address: host === 'intranet.test' ? '10.0.0.5' : '93.184.216.34' }]);
  saveSection('business', { name: 'Kalfa Test', owner_name: 'Deniz' });
  saveSection('scanner', { freelance_categories: ['web', 'wordpress'], job_categories: ['software'], job_turkey_only: false, exclude_keywords: ['kripto', 'crypto'] });
  server = createApp().listen(0);
  admin = client(`http://127.0.0.1:${server.address().port}`);
  await admin.req('POST', '/api/auth/setup', { email: 'admin@test.com', password: 'GucluSifre123' });
});

after(() => {
  setFetch(null);
  setLookup(null);
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const lead = (title) => get('SELECT * FROM leads WHERE title = ?', title);

describe('kategoriler', () => {
  test('ilanlar Türkçe ve İngilizce kelimelerle doğru kategoriye düşer', () => {
    assert.equal(classify({ title: 'Kuaför salonu için web sitesi yapılacak' }).best, 'web');
    assert.equal(classify({ title: 'Logo tasarımı yaptırılacak' }).best, 'design');
    assert.equal(classify({ title: 'Need a Shopify store' }).best, 'ecommerce');
    assert.equal(classify({ title: 'Flutter ile mobil uygulama' }).best, 'mobile');
    assert.equal(classify({ title: 'Muhasebe elemanı aranıyor' }).best, 'finance');
    assert.equal(classify({ title: 'Copywriter for blog posts' }).best, 'writing');
  });

  test('il ve çalışma türü tanıma', async () => {
    const { detectCity, detectWorkTypes, inTurkey } = await import('../src/services/turkey.js');
    assert.equal(detectCity('Ataşehir, İstanbul'), 'İstanbul');
    assert.equal(detectCity('IZMIR'), 'İzmir');
    assert.equal(detectCity('Bornova'), 'İzmir');
    assert.equal(detectCity('Eskisehir'), 'Eskişehir');
    assert.equal(detectCity('London, UK'), null);
    assert.deepEqual(detectWorkTypes({ title: 'Part-time remote designer' }).sort(), ['part_time', 'remote']);
    assert.ok(inTurkey({ location: 'Remote - Turkey' }));
    assert.ok(!inTurkey({ location: 'Worldwide' }));
    assert.ok(inTurkey({ title: 'Muhasebe elemanı', description: '', lang: 'tr' }));
    assert.ok(inTurkey({ title: 'Developer', description: '', platformCountry: 'tr' }));
  });

  test('kelimeler bütün olarak eşleşir (build içindeki "ui" UI/UX sayılmaz)', () => {
    assert.ok(!classify({ title: 'Help me build a guide' }).all.includes('uiux'));
    assert.ok(classify({ title: 'UI designer needed' }).all.includes('uiux'));
    assert.deepEqual(classify({ title: 'Bahçe düzenleme' }).all, []);
  });
});

describe('dil tanıma ve parçalama', () => {
  test('Türkçe ve yabancı ilanlar ayırt edilir', () => {
    assert.equal(detectLanguage('Kuaför salonu için web sitesi yapılacak'), 'tr');
    assert.equal(detectLanguage('Kafe için site istiyorum'), 'tr');
    assert.equal(detectLanguage('I need a website for my restaurant'), 'en');
    assert.equal(detectLanguage('Logo design'), 'en');
    assert.equal(detectLanguage('Wir suchen eine neue Webseite für unsere Firma'), 'de');
    assert.equal(detectLanguage('Нужен сайт'), 'ru');
    assert.equal(detectLanguage(''), null);
  });

  test('uzun metin ücretsiz servisin sınırına göre bölünür', () => {
    const text = `${'This is a sentence. '.repeat(60)}${'x'.repeat(1200)}`;
    const parts = chunk(text, 450);
    assert.ok(parts.length > 3);
    assert.ok(parts.every((p) => Buffer.byteLength(p) <= 450));
    assert.equal(parts.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  });
});

describe('ilan kaynakları', () => {
  test('siteler adresinden tanınır', () => {
    assert.equal(sources.detectPlatform('https://www.r10.net/web-tasarim/'), 'r10');
    assert.equal(sources.detectPlatform('https://bionluk.com/istek/1'), 'bionluk');
    assert.equal(sources.detectPlatform('https://armut.com/x'), 'armut');
    assert.equal(sources.detectPlatform('https://ornek.test/'), 'web');
  });

  test('sayfa ve RSS kaynağı eklenir; adres doğrulanır', async () => {
    let r = await admin.req('POST', '/api/sources', { kind: 'page', url: 'https://forum.test/hizmet-alim/', link_pattern: '/konu/', name: 'Forum hizmet alım' });
    assert.equal(r.status, 200);
    assert.equal(r.data.platform, 'web');
    r = await admin.req('POST', '/api/sources', { kind: 'page', url: 'https://ilan.test/' });
    assert.equal(r.status, 200);
    r = await admin.req('POST', '/api/sources', { kind: 'page', url: 'https://spa.test/' });
    assert.equal(r.status, 200);
    assert.equal((await admin.req('POST', '/api/sources', { kind: 'page', url: 'ftp://x.test' })).status, 400);
    assert.equal((await admin.req('POST', '/api/sources', { kind: 'other', url: 'https://x.test' })).status, 400);
  });

  test('"Dene" sayfadaki ilan bağlantılarını gösterir, menü ve dış bağlantıları almaz', async () => {
    const src = get(`SELECT id FROM sources WHERE url = 'https://forum.test/hizmet-alim/'`);
    const r = await admin.req('POST', `/api/sources/${src.id}/test`);
    assert.equal(r.status, 200);
    assert.equal(r.data.count, 2);
    assert.deepEqual(r.data.sample.map((x) => x.url), ['https://forum.test/konu/123-kuafor-icin-web-sitesi', 'https://forum.test/konu/124-logo']);
  });

  test('iç ağ adresleri kaynak olarak okunmaz', async () => {
    const r = await admin.req('POST', '/api/sources', { kind: 'page', url: 'http://intranet.test/ilanlar' });
    const t = await admin.req('POST', `/api/sources/${r.data.id}/test`);
    assert.equal(t.status, 400);
    assert.match(t.data.error, /Yerel ağ/);
    await admin.req('DELETE', `/api/sources/${r.data.id}`);
  });

  test('tarama tüm kaynakları okur, anahtar kelimeye göre eler ve puanlar', async () => {
    const r = await admin.req('POST', '/api/leads/scan');
    assert.equal(r.status, 200);
    assert.equal(r.data.sources, 5);
    assert.equal(r.data.matched, 4, JSON.stringify(r.data));
    assert.equal(r.data.errors.length, 1);
    assert.match(r.data.errors[0], /yer imi/);

    const cafe = lead('Need a website for my cafe');
    assert.equal(cafe.platform, 'freelancer');
    assert.equal(cafe.status, 'new');
    assert.equal(cafe.url, 'https://www.freelancer.com/projects/cafe-site');
    assert.equal(lead('Crypto trading bot').status, 'filtered_out');

    const kuafor = lead('Kuaför salonu için web sitesi yapılacak');
    assert.equal(kuafor.status, 'new');
    assert.equal(lead('Logo tasarımı yaptırılacak, acil iş').status, 'filtered_out');

    // The page advertised an RSS feed, so it was read through the feed.
    const wp = lead('WordPress kurumsal site');
    assert.equal(wp.status, 'new');
    assert.equal(wp.budget_max, 5000);
    assert.equal(wp.currency, 'TRY');
    assert.equal(JSON.parse(wp.contact).email, 'ali@firma.test');
    assert.ok(wp.score > kuafor.score, 'iletişim ve bütçe puanı artırmalı');

    // The English Freelancer.com listing was translated; Turkish ones were left alone.
    assert.equal(cafe.lang, 'en');
    assert.equal(cafe.title_tr, 'TR[Need a website for my cafe]');
    assert.equal(cafe.description_tr, 'TR[Small website, contact me]');
    assert.equal(cafe.translated_by, 'mymemory');
    assert.equal(kuafor.lang, 'tr');
    assert.equal(kuafor.title_tr, null);
    assert.equal(lead('Crypto trading bot').title_tr, null, 'elenen ilanlar çevrilmez (kota harcanmaz)');
    assert.equal(r.data.translated, 2);
    assert.match(get(`SELECT body FROM notifications WHERE type = 'new_leads'`).body, /TR\[Need a website for my cafe\]/);

    const spa = get(`SELECT * FROM sources WHERE url = 'https://spa.test/'`);
    assert.equal(spa.last_status, 'error');
    assert.equal(get(`SELECT last_status FROM sources WHERE url = 'https://forum.test/hizmet-alim/'`).last_status, 'ok');
    assert.ok(get(`SELECT id FROM notifications WHERE type = 'new_leads'`));
  });

  test('sigortalı iş ilanları ayrı listede; şirket, konum, maaş ve kategoriyle gelir', async () => {
    const d = (await admin.req('GET', '/api/leads?kind=job')).data;
    assert.equal(d.kind, 'job');
    assert.deepEqual(d.selected, ['software']);
    assert.equal(d.leads.length, 1);
    const job = d.leads[0];
    assert.equal(job.title, 'Senior Backend Developer (Node.js)');
    assert.equal(job.platform, 'remotive');
    assert.equal(job.company, 'Acme');
    assert.equal(job.location, 'Worldwide');
    assert.equal(job.salary, '$80k - $100k');
    assert.equal(job.category, 'software');
    assert.equal(job.description, 'We are hiring a backend developer.');
    assert.match(job.message, /^Hello, I would like to apply for the "Senior Backend Developer \(Node\.js\)" position/);
    assert.equal(d.counts.filtered_out, 1, 'müşteri hizmetleri ilanı seçili kategoride değil');
    const fl = (await admin.req('GET', '/api/leads?kind=freelance')).data;
    assert.ok(fl.leads.every((l) => l.kind === 'freelance'));
  });

  test('kategori seçimi değişince ilanlar yeniden elenir', async () => {
    const logo = () => lead('Logo tasarımı yaptırılacak, acil iş');
    assert.equal(logo().status, 'filtered_out');
    assert.match(logo().filter_reason, /Grafik/);
    let r = await admin.req('PUT', '/api/leads/categories', { kind: 'freelance', categories: ['web', 'wordpress', 'design'] });
    assert.equal(r.status, 200);
    assert.equal(logo().status, 'new');
    assert.equal(logo().category, 'design');
    r = await admin.req('PUT', '/api/leads/categories', { kind: 'freelance', categories: ['web', 'wordpress'] });
    assert.equal(logo().status, 'filtered_out');
    assert.equal((await admin.req('PUT', '/api/leads/categories', { kind: 'x', categories: [] })).status, 400);
  });

  test('iş ilanları: sadece Türkiye, şehir ve çalışma türü filtresi', async () => {
    const job = () => lead('Senior Backend Developer (Node.js)');
    // Remotive listing is "Worldwide" → not in Turkey → out once Turkey-only is on.
    assert.equal(job().status, 'new');
    await admin.req('PUT', '/api/leads/categories', { kind: 'job', categories: ['software'], turkey_only: true });
    assert.equal(job().status, 'filtered_out');
    assert.match(job().filter_reason, /Türkiye dışı/);
    await admin.req('PUT', '/api/leads/categories', { kind: 'job', categories: ['software'], turkey_only: false });
    assert.equal(job().status, 'new');
    assert.equal(job().in_turkey, 0);
    assert.deepEqual(job().work_types.split(','), ['full_time', 'remote']);
    await admin.req('PUT', '/api/leads/categories', { kind: 'job', categories: ['software'], turkey_only: false, work_types: ['part_time'] });
    assert.match(job().filter_reason, /Çalışma türü/);
    await admin.req('PUT', '/api/leads/categories', { kind: 'job', categories: ['software'], turkey_only: true, work_types: [], cities: ['Ankara', 'Bilinmeyen'] });
    const s = (await admin.req('GET', '/api/leads?kind=job')).data;
    assert.deepEqual(s.filters, { turkey_only: true, cities: ['Ankara'], work_types: [] });
    assert.equal(s.provinces.length, 81);
    assert.equal(job().status, 'filtered_out');
  });

  test('Türk iş ilanı: şehir ve çalışma türü metinden bulunur, şehir filtresi uygulanır', async () => {
    const add = (body) => admin.req('POST', '/api/leads', body).then((r) => get('SELECT * FROM leads WHERE id = ?', r.data.id));
    const a = await add({ url: 'https://www.kariyer.net/is-ilani/1', title: 'Yazılım Geliştirme Uzmanı', description: 'Kadıköy ofisimizde hibrit çalışacak, tam zamanlı Node.js geliştirici arıyoruz.' });
    assert.equal(a.kind, 'job');
    assert.equal(a.city, 'İstanbul');
    assert.equal(a.in_turkey, 1);
    assert.deepEqual(a.work_types.split(',').sort(), ['full_time', 'hybrid']);
    const b = await add({ url: 'https://www.linkedin.com/jobs/view/77', title: 'Backend Developer', description: 'Office in Berlin.', location: 'Berlin, Germany' });
    assert.equal(b.in_turkey, 0);
    assert.equal(b.city, null);
    const c = await add({ url: 'https://www.linkedin.com/jobs/view/78', title: 'Stajyer yazılım geliştirici - Ankara', description: 'Uzun dönem stajyer arıyoruz.' });
    assert.equal(c.city, 'Ankara');
    assert.equal(c.in_turkey, 1);
    assert.ok(c.work_types.includes('internship'));
  });

  test('yabancı ilana İngilizce mesaj hazırlanır', async () => {
    const d = (await admin.req('GET', `/api/leads/${lead('Need a website for my cafe').id}`)).data;
    assert.equal(d.foreign, true);
    assert.match(d.message, /^Hello, I saw your project "Need a website for my cafe"/);
  });

  test('kota dolunca çeviri durur, tarama bozulmaz; sonra elle çevrilebilir', async () => {
    quotaLeft = 0;
    const r = await admin.req('POST', '/api/leads', { url: 'https://www.upwork.com/jobs/1', title: 'Looking for a web designer', description: 'We need a new website for our shop.' });
    assert.equal(r.status, 200);
    assert.match(r.data.translate_error, /kotası/);
    const l = get('SELECT * FROM leads WHERE id = ?', r.data.id);
    assert.equal(l.platform, 'upwork');
    assert.equal(l.lang, 'en');
    assert.equal(l.title_tr, null);
    quotaLeft = Infinity;
    const t = await admin.req('POST', `/api/leads/${l.id}/translate`);
    assert.equal(t.status, 200);
    assert.equal(t.data.title_tr, 'TR[Looking for a web designer]');
  });

  test('ikinci tarama aynı ilanları tekrar eklemez', async () => {
    const before = all('SELECT id FROM leads').length;
    const r = await admin.req('POST', '/api/leads/scan');
    assert.equal(r.data.added, 0);
    assert.equal(all('SELECT id FROM leads').length, before);
  });

  test('ilan listesi elenenleri ayrı gösterir ve hazır mesaj içerir', async () => {
    const d = (await admin.req('GET', '/api/leads')).data;
    assert.ok(d.leads.every((l) => l.status !== 'filtered_out'));
    assert.equal(d.counts.filtered_out, 3);
    const wp = d.leads.find((l) => l.title === 'WordPress kurumsal site');
    assert.match(wp.message, /"WordPress kurumsal site" ilanınızı gördüm/);
    const filtered = (await admin.req('GET', '/api/leads?status=filtered_out')).data.leads;
    assert.equal(filtered.length, 3);
  });

  test('yer imiyle LinkedIn\'den gelen ilan iş ilanı olarak kaydedilir', async () => {
    const r = await admin.req('POST', '/api/leads', { url: 'https://www.linkedin.com/jobs/view/1', title: 'Frontend Developer — İstanbul', description: 'React bilen frontend geliştirici arıyoruz.' });
    assert.equal(r.data.kind, 'job');
    const l = get('SELECT * FROM leads WHERE id = ?', r.data.id);
    assert.equal(l.platform, 'linkedin');
    assert.equal(l.kind, 'job');
    assert.equal(l.status, 'new', 'elle eklenen ilan elenmez');
  });

  test('yer imiyle gelen ilan site tanınarak kaydedilir, tekrar eklenmez', async () => {
    const body = { url: 'https://bionluk.com/istek/9', title: 'Diş kliniği için web sitesi', description: 'Detaylar için 0532 111 22 33 numarasından WhatsApp yazın' };
    const r = await admin.req('POST', '/api/leads', body);
    assert.equal(r.status, 200);
    assert.equal(r.data.duplicate, false);
    const l = get('SELECT * FROM leads WHERE id = ?', r.data.id);
    assert.equal(l.platform, 'bionluk');
    assert.equal(l.status, 'new');
    assert.equal(JSON.parse(l.contact).phone, '905321112233');
    assert.equal((await admin.req('POST', '/api/leads', body)).data.duplicate, true);
    assert.equal((await admin.req('POST', '/api/leads', { title: '' })).status, 400);
  });

  test('ilan sahibine yazma: e-posta SMTP ister, WhatsApp konuşma açar, cevap gelince işaretlenir', async () => {
    const wp = lead('WordPress kurumsal site');
    const e = await admin.req('POST', `/api/leads/${wp.id}/contact`, { channel: 'email' });
    assert.equal(e.status, 400);
    assert.match(e.data.error, /SMTP/);

    const dis = lead('Diş kliniği için web sitesi');
    const w = await admin.req('POST', `/api/leads/${dis.id}/contact`, { channel: 'whatsapp_link', message: 'Merhaba, bu işi yapabilirim.' });
    assert.equal(w.status, 200);
    assert.equal(w.data.status, 'contacted');
    assert.match(w.data.whatsapp_link, /^https:\/\/wa\.me\/905321112233\?text=/);
    const convId = w.data.conversation_id;
    assert.equal(get('SELECT sender FROM messages WHERE conversation_id = ?', convId).sender, 'admin');

    await admin.req('POST', `/api/conversations/${convId}/inbound`, { text: 'Merhaba, fiyat nedir?' });
    assert.equal(lead('Diş kliniği için web sitesi').status, 'replied');

    const kuafor = lead('Kuaför salonu için web sitesi yapılacak');
    const p = await admin.req('POST', `/api/leads/${kuafor.id}/contact`, { channel: 'platform' });
    assert.equal(p.data.status, 'contacted');
    assert.equal(p.data.conversation_id, null);
  });

  test('WhatsApp API yokken cevap yazınca panel wa.me bağlantısı açar', async () => {
    const dis = lead('Diş kliniği için web sitesi');
    const r = await admin.req('POST', `/api/conversations/${dis.conversation_id}/messages`, { text: '5.000 TL, 1 haftada teslim.' });
    assert.equal(r.status, 200);
    assert.equal(r.data.relay, true);
  });

  test('durum ve not güncellenir; mesaj şablonu ayarlardan değişir', async () => {
    const dis = lead('Diş kliniği için web sitesi');
    const r = await admin.req('PUT', `/api/leads/${dis.id}`, { status: 'won', notes: '5.000 TL anlaşıldı' });
    assert.equal(r.data.status, 'won');
    assert.equal(r.data.notes, '5.000 TL anlaşıldı');
    assert.equal((await admin.req('PUT', `/api/leads/${dis.id}`, { status: 'paid' })).status, 400);

    saveSection('templates', { lead_message: 'Selam{ad_bosluklu}! "{ilan}" için {isletmem} olarak buradayım.' });
    const l = (await admin.req('GET', `/api/leads/${dis.id}`)).data;
    assert.equal(l.message, 'Selam! "Diş kliniği için web sitesi" için Kalfa Test olarak buradayım.');
  });

  test('genel bakış ilan ve kaynak özetini döndürür', async () => {
    const d = (await admin.req('GET', '/api/dashboard')).data;
    assert.ok(d.kpis.new_leads >= 2);
    assert.equal(d.kpis.won, 1);
    assert.equal(d.days.length, 14);
    assert.ok(d.funnel.found >= d.funnel.contacted && d.funnel.contacted >= d.funnel.replied);
    assert.ok(d.sources.some((s) => s.last_status === 'error'));
  });

  test('ilanlar CSV olarak dışa aktarılır', async () => {
    const r = await admin.req('GET', '/api/export/leads.csv', null, { raw: true });
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.match(text, /WordPress kurumsal site/);
    assert.ok(!text.includes('Crypto trading bot'), 'elenen ilanlar dışa aktarılmaz');
  });
});
