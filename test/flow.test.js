import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-test-'));
process.env.DATA_DIR = tmp;
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.AI_MOCK = '1';
process.env.PUBLIC_URL = 'http://localhost';

const { openDb, get, all, insert } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { saveSection } = await import('../src/services/settings.js');
const { waitForBuild } = await import('../src/services/projects.js');
const { filterLead, extractContact } = await import('../src/services/scanner.js');
const { parseFeed } = await import('../src/services/platforms/rss.js');

let server;
let base;
let cookie = '';

async function api(method, url, body, { raw = false, headers = {} } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    redirect: 'manual',
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  if (raw) return res;
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

before(async () => {
  openDb();
  insert('products', { name: 'Landing Page', price: 4000, currency: 'TRY', description: 'Tek sayfa' });
  insert('themes', { name: 'Minimal' });
  insert('languages', { name: 'HTML/CSS/JavaScript' });
  saveSection('business', { iban: 'TR000000000000000000000000', iban_holder: 'Test Kişi' });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('kurulum ve güvenlik', () => {
  test('ilk admin kurulumu ve giriş', async () => {
    let r = await api('GET', '/api/auth/status');
    assert.equal(r.data.needs_setup, true);
    r = await api('POST', '/api/auth/setup', { email: 'a@b.com', password: 'kisa' });
    assert.equal(r.status, 400);
    r = await api('POST', '/api/auth/setup', { email: 'a@b.com', name: 'A', password: 'GucluSifre123' });
    assert.equal(r.status, 200);
    r = await api('POST', '/api/auth/setup', { email: 'x@b.com', password: 'GucluSifre123' });
    assert.equal(r.status, 403);
    r = await api('GET', '/api/dashboard');
    assert.equal(r.status, 200);
  });

  test('JSON olmayan istekler reddedilir (CSRF)', async () => {
    const res = await fetch(`${base}/api/conversations/1/takeover`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
    assert.equal(res.status, 415);
  });

  test('hatalı girişler kilitlenir ve bildirim oluşur', async () => {
    const saved = cookie;
    cookie = '';
    for (let i = 0; i < 5; i++) assert.equal((await api('POST', '/api/auth/login', { email: 'a@b.com', password: 'yanlis' })).status, 401);
    assert.equal((await api('POST', '/api/auth/login', { email: 'a@b.com', password: 'GucluSifre123' })).status, 429);
    assert.ok(get(`SELECT id FROM notifications WHERE type = 'security'`));
    cookie = saved;
    const events = (await api('GET', '/api/security/events')).data;
    assert.ok(events.some((e) => e.event === 'login_blocked' && e.suspicious === 1));
  });

  test('oturum yok -> 401', async () => {
    const res = await fetch(`${base}/api/dashboard`);
    assert.equal(res.status, 401);
  });
});

describe('satış -> proje -> demo -> ödeme -> iade', () => {
  let token;
  let projectId;

  test('web sohbetinde yapay zeka fiyat verir', async () => {
    token = (await api('POST', '/api/chat/start', { name: 'Ayşe' })).data.token;
    const r = await api('POST', `/api/chat/${token}/messages`, { text: 'Merhaba, fiyatlarınız ne kadar?' });
    assert.match(r.data.reply, /Landing Page: 4000 TRY/);
  });

  test('anlaşma sağlanınca proje oluşur ve yapay zeka geliştirir', async () => {
    await api('POST', `/api/chat/${token}/messages`, { text: 'Tamam anlaştık, başlayalım' });
    const project = get('SELECT * FROM projects ORDER BY id DESC LIMIT 1');
    assert.ok(project);
    projectId = project.id;
    await waitForBuild(projectId); // background job started automatically
    const p = (await api('GET', `/api/projects/${projectId}`)).data;
    assert.equal(p.project.status, 'review');
    assert.equal(p.project.current_version, 1);
    assert.ok(p.files.some((f) => f.path === 'index.html'));
    const preview = await fetch(p.versions[0].preview_url.replace('http://localhost', base));
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-security-policy'), /sandbox/);
    const forged = await fetch(`${base}/preview/${projectId}/1/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/`);
    assert.equal(forged.status, 403);
  });

  test('admin düzeltme ister, yapay zeka yeni sürüm üretir', async () => {
    const r = await api('POST', `/api/projects/${projectId}/feedback`, { feedback: 'Başlık rengini kırmızı yap' });
    assert.equal(r.status, 200);
    await waitForBuild(projectId);
    const p = (await api('GET', `/api/projects/${projectId}`)).data;
    assert.equal(p.project.current_version, 2);
    assert.equal(p.project.status, 'review');
  });

  test('onay + demo yayını müşteriye iletilir', async () => {
    assert.equal((await api('POST', `/api/projects/${projectId}/deploy`)).status, 400); // not approved yet
    await api('POST', `/api/projects/${projectId}/approve`);
    const r = await api('POST', `/api/projects/${projectId}/deploy`);
    assert.equal(r.status, 200);
    const url = r.data.result.replace('http://localhost', base);
    const demo = await fetch(url);
    assert.equal(demo.status, 200);
    assert.match(await demo.text(), /Başlık rengini kırmızı yap/);
    const msgs = (await api('GET', `/api/chat/${token}/messages`)).data.messages;
    assert.ok(msgs.some((m) => m.body.includes('/demo/')));
  });

  test('müşteri beğenince IBAN otomatik gönderilir', async () => {
    await api('POST', `/api/chat/${token}/messages`, { text: 'Çok beğendim, harika!' });
    const project = get('SELECT status FROM projects WHERE id = ?', projectId);
    assert.equal(project.status, 'awaiting_payment');
    const msgs = (await api('GET', `/api/chat/${token}/messages`)).data.messages;
    assert.ok(msgs.some((m) => m.body.includes('TR000000000000000000000000')));
  });

  test('ödeme onayı fatura oluşturur, kısmi ve tam iade', async () => {
    const pay = get('SELECT * FROM payments WHERE project_id = ?', projectId);
    await api('POST', `/api/payments/${pay.id}/mark-paid`);
    assert.equal(get('SELECT status FROM projects WHERE id = ?', projectId).status, 'paid');
    const invoices = (await api('GET', '/api/invoices')).data;
    assert.equal(invoices[0].total, 4000);
    assert.equal(invoices[0].tax_amount, 666.67);
    const pdf = await api('GET', `/api/invoices/${invoices[0].id}/pdf`, null, { raw: true });
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');

    assert.equal((await api('POST', `/api/payments/${pay.id}/refund`, { amount: 5000 })).status, 400);
    let r = await api('POST', `/api/payments/${pay.id}/refund`, { amount: 1000, reason: 'Gecikme' });
    assert.equal(r.data.result.status, 'partially_refunded');
    r = await api('POST', `/api/payments/${pay.id}/refund`, { reason: 'İptal' });
    assert.equal(r.data.result.status, 'refunded');
    assert.equal(all(`SELECT * FROM invoices WHERE kind = 'refund'`).length, 2);
  });

  test('dashboard ve aylık PDF', async () => {
    const d = (await api('GET', '/api/dashboard')).data;
    assert.equal(d.stats.gross_revenue, 4000);
    assert.equal(d.stats.revenue, 0);
    assert.equal(d.trend.length, 12);
    const a = (await api('POST', '/api/dashboard/analysis', {})).data;
    assert.match(a.analysis, /Durum değerlendirmesi/);
    const pdf = await api('GET', '/api/reports/monthly.pdf?analysis=1', null, { raw: true });
    assert.equal(pdf.status, 200);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  });
});

describe('yöneticiye aktarma', () => {
  test('müşteri yetkili isteyince konuşma admine geçer', async () => {
    const token = (await api('POST', '/api/chat/start', {})).data.token;
    await api('POST', `/api/chat/${token}/messages`, { text: 'Bir yetkiliyle görüşmek istiyorum' });
    const conv = get(`SELECT * FROM conversations WHERE external_id = ?`, token);
    assert.equal(conv.mode, 'human');
    assert.equal(conv.status, 'escalated');
    assert.ok(get(`SELECT id FROM notifications WHERE type = 'escalation'`));
    // Human mode: AI stays silent, admin answers.
    const r = await api('POST', `/api/chat/${token}/messages`, { text: 'Merhaba?' });
    assert.equal(r.data.reply, null);
    await api('POST', `/api/conversations/${conv.id}/messages`, { text: 'Merhaba, ben Ali, yardımcı olayım.' });
    const msgs = (await api('GET', `/api/chat/${token}/messages`)).data.messages;
    assert.equal(msgs.at(-1).sender, 'admin');
    await api('POST', `/api/conversations/${conv.id}/release`);
    assert.equal(get('SELECT mode FROM conversations WHERE id = ?', conv.id).mode, 'ai');
  });

  test('token bütçesi biterse admine aktarılır', async () => {
    saveSection('ai', { monthly_token_budget: 1 });
    insert('ai_usage', { purpose: 'test', model: 'x', input_tokens: 10, output_tokens: 0 });
    const token = (await api('POST', '/api/chat/start', {})).data.token;
    const r = await api('POST', `/api/chat/${token}/messages`, { text: 'Merhaba' });
    assert.equal(r.data.reply, null);
    const conv = get(`SELECT * FROM conversations WHERE external_id = ?`, token);
    assert.equal(conv.mode, 'human');
    assert.match(conv.escalation_reason, /bütçesi/);
    saveSection('ai', { monthly_token_budget: 0 });
  });

  test('IBAN değişikliği güvenlik uyarısı üretir', async () => {
    const before = all(`SELECT id FROM notifications WHERE subject LIKE 'Ödeme/iletişim%'`).length;
    await api('PUT', '/api/settings/business', { iban: 'TR111111111111111111111111' });
    assert.equal(all(`SELECT id FROM notifications WHERE subject LIKE 'Ödeme/iletişim%'`).length, before + 1);
  });
});

describe('platform tarama', () => {
  test('kapsam filtresi ve iletişim çıkarımı', () => {
    const scope = { keywords: ['website'], exclude_keywords: ['kripto'], min_budget: 5000, max_budget: 0, currencies: [], max_age_hours: 0 };
    assert.equal(filterLead({ title: 'Website lazım', description: '', budget_max: 6000, currency: 'TRY' }, scope), null);
    assert.match(filterLead({ title: 'Website kripto', description: '' }, scope), /Hariç/);
    assert.match(filterLead({ title: 'Website', description: '', budget_max: 100, currency: 'TRY' }, scope), /alt sınır/);
    assert.match(filterLead({ title: 'Logo', description: '' }, scope), /Anahtar/);
    assert.deepEqual(extractContact('Ulaşın: 0555 111 22 33 veya x@y.com'), { email: 'x@y.com', phone: '905551112233' });
  });

  test('RSS ayrıştırma', () => {
    const items = parseFeed(`<rss><channel><item><title><![CDATA[Web site]]></title><link>https://x.com/1</link><guid>1</guid><description>Budget: $500</description></item></channel></rss>`);
    assert.equal(items[0].title, 'Web site');
    assert.equal(items[0].budget_max, 500);
    assert.equal(items[0].currency, 'USD');
  });

  test('demo platform taraması: iletişimi olana yazılır, olmayan admine gider', async () => {
    saveSection('scanner', { enabled_platforms: ['mock'], keywords: ['web', 'landing'], exclude_keywords: ['kripto'], min_budget: 0, max_budget: 0, max_age_hours: 0 });
    const r = (await api('POST', '/api/leads/scan')).data;
    assert.equal(r.fetched, 4);
    assert.equal(r.contacted, 2);
    assert.equal(r.needs_admin, 1);
    assert.equal(r.filtered, 1);
    const again = (await api('POST', '/api/leads/scan')).data;
    assert.equal(again.duplicate, 4);
  });
});
