import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { client, tmp } from './helpers.js';

process.env.NETLIFY_TOKEN = 'nf-test';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';

const { openDb, get, all, insert } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { saveSection } = await import('../src/services/settings.js');
const { setFetch, setLookup, assertPublicUrl } = await import('../src/services/http.js');
const prospecting = await import('../src/services/prospecting.js');
const { cleanReply, processParsedMail } = await import('../src/services/mailbox.js');
const { syncStripePayments } = await import('../src/services/payments.js');
const { deployDemo, versionDir } = await import('../src/services/projects.js');
await import('../src/services/jobs.js');
const scheduler = await import('../src/services/scheduler.js');

const year = new Date().getFullYear();
const calls = [];
let overpassCalls = 0;
const netlifyCalls = [];

const osm = (type, id, tags, lat = 41.0, lng = 29.0) => ({ type, id, lat, lon: lng, tags });
function overpassElements() {
  const els = [
    osm('node', 1, { name: 'Makas Kuaför', shop: 'hairdresser', phone: '0532 111 22 33' }),
    osm('node', 2, { name: 'Lezzet Lokantası', amenity: 'restaurant', email: 'info@lezzet.test', website: 'http://lezzet.test' }),
    { type: 'way', id: 3, center: { lat: 41.001, lon: 29.001 }, tags: { name: 'Gülüş Diş', amenity: 'dentist', 'contact:instagram': 'https://instagram.com/gulus', phone: '0216 333 44 55' } },
    osm('node', 4, { name: 'Modern Kahve', amenity: 'cafe', email: 'merhaba@modern.test', website: 'https://modern.test' }),
    osm('node', 5, { name: 'Starbucks', amenity: 'cafe', brand: 'Starbucks', phone: '0212 999 88 77' }),
    osm('node', 6, { name: 'İç Ağ Lokanta', amenity: 'restaurant', website: 'http://intranet.test' }),
  ];
  // Second scan: same phone as the dentist under a different OSM id.
  if (overpassCalls > 1) els.push(osm('node', 7, { name: 'Gülüş Diş (şube)', amenity: 'dentist', phone: '02163334455' }));
  return els;
}

const html = (body) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });
async function fakeFetch(url, init = {}) {
  url = String(url);
  calls.push(url);
  if (url.includes('nominatim')) return Response.json([{ lat: '41.0', lon: '29.0', display_name: 'Kadıköy, İstanbul' }]);
  if (url.includes('overpass')) { overpassCalls++; return Response.json({ elements: overpassElements() }); }
  if (url.startsWith('http://lezzet.test')) return html('<html><head><title>Lezzet</title></head><body>© 2015 Lezzet</body></html>');
  if (url.startsWith('https://modern.test')) return html(`<html><head><meta name="viewport" content="width=device-width"><title>Modern</title></head><body>© ${year}</body></html>`);
  if (url.startsWith('https://api.stripe.com/v1/checkout/sessions/cs_test_1')) return Response.json({ id: 'cs_test_1', payment_status: 'paid', payment_intent: 'pi_1' });
  if (url.startsWith('https://api.stripe.com/v1/checkout/sessions/')) return Response.json({ payment_status: 'unpaid' });
  if (url.startsWith('https://api.netlify.com/api/v1/')) {
    netlifyCalls.push({ url, init });
    if (url.endsWith('/sites')) return Response.json({ id: 'site-1', ssl_url: 'https://kalfa-demo.netlify.app' });
    return Response.json({ id: 'dep-1', ssl_url: 'https://kalfa-demo.netlify.app' });
  }
  throw new Error(`beklenmeyen istek: ${url}`);
}

let server;
let admin;

before(async () => {
  openDb();
  scheduler.syncJobs();
  setFetch(fakeFetch);
  setLookup(async (host) => [{ address: host === 'intranet.test' ? '10.0.0.5' : '93.184.216.34' }]);
  insert('products', { name: 'Landing Page', price: 4000, currency: 'TRY', description: 'Tek sayfa' });
  saveSection('business', { name: 'Kalfa Test', owner_name: 'Deniz' });
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

const byName = (name) => get('SELECT * FROM prospects WHERE name = ?', name);

describe('bölge taraması', () => {
  test('iç ağ adresleri engellenir', async () => {
    await assert.rejects(assertPublicUrl('http://localhost:3000'));
    await assert.rejects(assertPublicUrl('http://192.168.1.1/'));
    await assert.rejects(assertPublicUrl('file:///etc/passwd'));
    await assert.rejects(assertPublicUrl('http://intranet.test/'));
    await assertPublicUrl('https://modern.test/');
  });

  test('konum bulunur, işletmeler taranır, puanlanır ve mesaj hazırlanır', async () => {
    const r = await admin.req('POST', '/api/prospects/scan', { location: 'Kadıköy', radius_km: 1, categories: ['hairdresser', 'restaurant', 'dentist', 'cafe'] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.found, 6);
    assert.equal(r.data.added, 6);
    assert.equal(r.data.analyzed, 6);

    const makas = byName('Makas Kuaför');
    assert.equal(makas.phone, '905321112233');
    assert.equal(makas.status, 'analyzed');
    assert.match(makas.message, /Makas Kuaför/);
    assert.ok(JSON.parse(makas.signals).includes('Web sitesi yok'));

    const lezzet = byName('Lezzet Lokantası');
    const site = JSON.parse(lezzet.site_check);
    assert.equal(site.https, false);
    assert.equal(site.mobile, false);
    assert.equal(site.copyright_year, 2015);

    assert.equal(JSON.parse(byName('Gülüş Diş').site_check).social_only, true);
    const icAg = JSON.parse(byName('İç Ağ Lokanta').site_check);
    assert.equal(icAg.ok, false);
    assert.ok(!calls.some((u) => u.includes('intranet.test')), 'iç ağdaki siteye istek atılmamalı');

    // Needs a site most → least: no site > social-only > outdated > modern / chain.
    assert.ok(makas.score > lezzet.score);
    assert.ok(byName('Gülüş Diş').score > lezzet.score);
    assert.ok(lezzet.score > byName('Modern Kahve').score);
    assert.ok(byName('Starbucks').score < 40);
    assert.ok(byName('Modern Kahve').score < 40);

    const list = (await admin.req('GET', '/api/prospects')).data;
    assert.equal(list.prospects[0].name, 'Makas Kuaför');
    assert.match(list.prospects[0].whatsapp_link, /^https:\/\/wa\.me\/905321112233\?text=/);
    assert.match(list.prospects[0].full_message, /İPTAL/);
    assert.match(list.prospects[0].full_message, /Deniz · Kalfa Test/);
    assert.equal(list.capabilities.smtp, false);
    assert.ok(list.stats.hot >= 2);
  });

  test('SMTP yokken e-posta gönderimi anlaşılır bir hata verir', async () => {
    const r = await admin.req('POST', `/api/prospects/${byName('Lezzet Lokantası').id}/contact`, { channel: 'email' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /SMTP/);
    assert.equal(byName('Lezzet Lokantası').status, 'analyzed');
  });

  test('otomatik gönderim SMTP/WhatsApp şablonu yoksa kimseye yazmaz', async () => {
    const r = await admin.req('POST', '/api/prospects/auto-send', {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.sent, []);
    assert.ok(r.data.skipped.length >= 1);
  });

  test('WhatsApp bağlantısıyla yazılınca konuşma açılır, aracı modunda cevap işlenir', async () => {
    const makas = byName('Makas Kuaför');
    const r = await admin.req('POST', `/api/prospects/${makas.id}/contact`, { channel: 'whatsapp_link', message: 'Merhaba Makas Kuaför, size bir demo hazırlayabilirim.' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.status, 'contacted');
    const convId = r.data.conversation_id;
    assert.ok(convId);

    const conv = (await admin.req('GET', `/api/conversations/${convId}`)).data;
    assert.equal(conv.relay, true);
    assert.match(conv.messages[0].body, /demo hazırlayabilirim[\s\S]*İPTAL/);

    const inbound = await admin.req('POST', `/api/conversations/${convId}/inbound`, { text: 'Merhaba, fiyatınız ne kadar?' });
    assert.equal(inbound.status, 200);
    assert.ok(inbound.data.reply);
    assert.equal(byName('Makas Kuaför').status, 'replied');
    assert.ok(get(`SELECT id FROM notifications WHERE type = 'prospect_replied'`));

    const again = await admin.req('POST', `/api/prospects/${makas.id}/contact`, { channel: 'whatsapp_link' });
    assert.equal(again.status, 400);
  });

  test('İPTAL yazan işletme kara listeye alınır ve bir daha yazılmaz', async () => {
    const gulus = byName('Gülüş Diş');
    const r = await admin.req('POST', `/api/prospects/${gulus.id}/contact`, { channel: 'whatsapp_link' });
    const convId = r.data.conversation_id;
    const out = await admin.req('POST', `/api/conversations/${convId}/inbound`, { text: 'İPTAL' });
    assert.equal(out.data.optedOut, true);
    assert.equal(byName('Gülüş Diş').status, 'opted_out');
    assert.ok(get('SELECT id FROM do_not_contact WHERE phone = ?', '902163334455'));
    assert.equal(get('SELECT status FROM conversations WHERE id = ?', convId).status, 'closed');
  });

  test('yeniden tarama aynı işletmeleri ve kara listedekileri eklemez', async () => {
    const r = await prospecting.scan();
    assert.equal(r.found, 7);
    assert.equal(r.added, 0);
    assert.equal(r.skipped, 1);
    assert.equal(all('SELECT id FROM prospects').length, 6);
  });

  test('günlük sınır dolunca otomatik gönderim durur', async () => {
    saveSection('prospecting', { daily_limit: 2 });
    const r = await prospecting.autoSend();
    assert.match(r.reason, /sınır/);
    saveSection('prospecting', { daily_limit: 20 });
  });

  test('zamanlanmış bölge taraması görevi çalışır', async () => {
    const r = await admin.req('POST', '/api/jobs/prospect_scan/run', {});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const run = get(`SELECT * FROM job_runs WHERE job = 'prospect_scan' ORDER BY id DESC`) || get(`SELECT * FROM job_runs ORDER BY id DESC`);
    assert.equal(run.status, 'ok', run.message || run.output);
  });
});

describe('yerelde çalışma yardımcıları', () => {
  test('e-posta cevabındaki alıntılar temizlenir', () => {
    assert.equal(cleanReply('Evet, ilgileniyorum.\n\nOn Mon, 1 Jan 2026 Kalfa wrote:\n> Merhaba'), 'Evet, ilgileniyorum.');
    assert.equal(cleanReply('Tamam\n-- \nAhmet'), 'Tamam');
    assert.equal(cleanReply('Olur\n1 Oca 2026 tarihinde Kalfa şunu yazdı:\n> ...'), 'Olur');
  });

  test('IMAP: yalnızca tanıdık adreslerden gelen e-postalar konuşmaya eklenir', async () => {
    const mail = (address, text) => ({ from: { value: [{ address, name: 'Lezzet' }] }, text });
    assert.equal(await processParsedMail(mail('bulten@rastgele.test', 'Kampanya!')), false);
    assert.equal(await processParsedMail(mail('noreply@lezzet.test', 'otomatik')), false);
    assert.equal(await processParsedMail(mail('INFO@lezzet.test', 'Merhaba, web sitesi fiyatı nedir?\n\nOn Mon Kalfa wrote:\n> eski')), true);
    const conv = get(`SELECT * FROM conversations WHERE channel = 'email' AND external_id = 'info@lezzet.test'`);
    assert.ok(conv);
    const msgs = all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id', conv.id);
    assert.equal(msgs[0].body, 'Merhaba, web sitesi fiyatı nedir?');
    assert.ok(msgs.some((m) => m.sender === 'ai'));
  });

  test('Stripe ödemeleri webhook olmadan sorgulanıp işaretlenir', async () => {
    const customerId = insert('customers', { name: 'Kart Müşterisi', email: 'kart@test.com' });
    const paid = insert('payments', { customer_id: customerId, amount: 1000, method: 'stripe', reference: 'KLF-1', provider_ref: 'cs_test_1' });
    const waiting = insert('payments', { customer_id: customerId, amount: 500, method: 'stripe', reference: 'KLF-2', provider_ref: 'cs_test_2' });
    const r = await syncStripePayments();
    assert.deepEqual(r, { checked: 2, paid: 1 });
    assert.equal(get('SELECT status FROM payments WHERE id = ?', paid).status, 'paid');
    assert.equal(get('SELECT status FROM payments WHERE id = ?', waiting).status, 'pending');
  });

  test('NETLIFY_TOKEN varsa demo herkese açık adrese yüklenir', async () => {
    const customerId = insert('customers', { name: 'Demo Müşterisi' });
    const projectId = insert('projects', { customer_id: customerId, title: 'Demo', status: 'approved', current_version: 1 });
    const dir = versionDir(projectId, 1);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<h1>Merhaba</h1>');

    const url = await deployDemo(projectId);
    assert.equal(url, 'https://kalfa-demo.netlify.app/');
    assert.equal(get('SELECT demo_url FROM projects WHERE id = ?', projectId).demo_url, url);
    const deploy = netlifyCalls.find((c) => c.url.endsWith('/deploys'));
    assert.equal(deploy.init.headers['Content-Type'], 'application/zip');
    assert.equal(Buffer.from(deploy.init.body).subarray(0, 2).toString(), 'PK');

    // Redeploy reuses the same Netlify site.
    netlifyCalls.length = 0;
    await deployDemo(projectId);
    assert.ok(!netlifyCalls.some((c) => c.url.endsWith('/sites')));
    assert.ok(netlifyCalls.some((c) => c.url.includes('/sites/site-1/deploys')));
  });
});
