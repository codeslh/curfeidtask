import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { client, tmp } from './helpers.js';

const { openDb, get, all, run } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { saveSection } = await import('../src/services/settings.js');
const { codeAt, counterNow } = await import('../src/services/totp.js');
const { canAccess } = await import('../src/routes/util.js');
const { resetRateLimits } = await import('../src/services/ratelimit.js');

let server;
let base;
let admin;
const PW = 'GucluSifre123';

before(async () => {
  openDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = client(base);
  assert.equal((await admin.req('POST', '/api/auth/setup', { email: 'admin@test.com', name: 'Admin', password: PW })).status, 200);
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('iki adımlı doğrulama (TOTP)', () => {
  let secret;
  let recovery;

  test('kurulum yanlış kodla açılmaz, doğru kodla açılır ve kurtarma kodları verir', async () => {
    const setup = await admin.req('POST', '/api/security/2fa/setup');
    assert.equal(setup.status, 200);
    assert.match(setup.data.qr, /^data:image\/png;base64,/);
    assert.match(setup.data.otpauth_url, /^otpauth:\/\/totp\//);
    secret = setup.data.secret;
    assert.equal((await admin.req('POST', '/api/security/2fa/enable', { code: '000000' })).status, 400);
    const ok = await admin.req('POST', '/api/security/2fa/enable', { code: codeAt(secret, counterNow()) });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.recovery_codes.length, 8);
    recovery = ok.data.recovery_codes;
  });

  test('girişte şifreden sonra kod istenir; hatalı kod, tekrar kullanılan kod reddedilir', async () => {
    const c = client(base);
    const step1 = await c.req('POST', '/api/auth/login', { email: 'admin@test.com', password: PW });
    assert.equal(step1.data.needs_2fa, true);
    assert.equal(c.cookie, '', 'şifre tek başına oturum açmamalı');
    assert.equal((await c.req('GET', '/api/dashboard')).status, 401);
    assert.equal((await c.req('POST', '/api/auth/2fa', { challenge: step1.data.challenge, code: '123456' })).status, 401);
    // The enable step already consumed the current code, so it must not work again (replay).
    assert.equal((await c.req('POST', '/api/auth/2fa', { challenge: step1.data.challenge, code: codeAt(secret, counterNow()) })).status, 401);
    // Next time step is accepted (±1 drift window).
    const ok = await c.req('POST', '/api/auth/2fa', { challenge: step1.data.challenge, code: codeAt(secret, counterNow() + 1) });
    assert.equal(ok.status, 200);
    assert.equal((await c.req('GET', '/api/dashboard')).status, 200);
  });

  test('kurtarma kodu bir kez çalışır ve uyarı oluşturur', async () => {
    const c = client(base);
    const s1 = await c.req('POST', '/api/auth/login', { email: 'admin@test.com', password: PW });
    assert.equal((await c.req('POST', '/api/auth/2fa', { challenge: s1.data.challenge, code: recovery[0] })).status, 200);
    assert.ok(get(`SELECT id FROM notifications WHERE subject = 'Kurtarma kodu ile giriş yapıldı'`));
    const c2 = client(base);
    const s2 = await c2.req('POST', '/api/auth/login', { email: 'admin@test.com', password: PW });
    assert.equal((await c2.req('POST', '/api/auth/2fa', { challenge: s2.data.challenge, code: recovery[0] })).status, 401);
  });

  test('doğrulama 5 hatalı denemeden sonra geçersiz olur', async () => {
    const c = client(base);
    run(`DELETE FROM login_events`); // start below the account lockout threshold
    const s = await c.req('POST', '/api/auth/login', { email: 'admin@test.com', password: PW });
    for (let i = 0; i < 5; i++) await c.req('POST', '/api/auth/2fa', { challenge: s.data.challenge, code: '111111' });
    const r = await c.req('POST', '/api/auth/2fa', { challenge: s.data.challenge, code: codeAt(secret, counterNow() + 1) });
    assert.equal(r.status, 401);
    assert.match(r.data.error, /süresi doldu/);
  });

  test('kapatmak için şifre ve kod gerekir', async () => {
    assert.equal((await admin.req('POST', '/api/security/2fa/disable', { password: 'yanlis', code: '000000' })).status, 400);
    run('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE email = ?', 'admin@test.com');
    run(`DELETE FROM login_events`);
  });
});

describe('roller ve yetkiler', () => {
  let operator;
  let viewer;

  test('yönetici ekip üyesi ekler', async () => {
    assert.equal((await admin.req('POST', '/api/users', { email: 'op@test.com', name: 'Op', password: PW, role: 'operator' })).status, 200);
    assert.equal((await admin.req('POST', '/api/users', { email: 'v@test.com', name: 'V', password: PW, role: 'viewer' })).status, 200);
    assert.equal((await admin.req('POST', '/api/users', { email: 'x@test.com', password: 'kisa', role: 'viewer' })).status, 400);
    assert.equal((await admin.req('POST', '/api/users', { email: 'op@test.com', password: PW })).status, 400);
    operator = client(base);
    viewer = client(base);
    assert.equal((await operator.req('POST', '/api/auth/login', { email: 'op@test.com', password: PW })).status, 200);
    assert.equal((await viewer.req('POST', '/api/auth/login', { email: 'v@test.com', password: PW })).status, 200);
  });

  test('operatör satış işlerini yapar ama para/ayar/ekip işlemlerine erişemez', async () => {
    assert.equal((await operator.req('GET', '/api/conversations')).status, 200);
    assert.equal((await operator.req('POST', '/api/products', { name: 'Yeni', price: 10 })).status, 200);
    assert.equal((await operator.req('GET', '/api/payments')).status, 200);
    assert.equal((await operator.req('POST', '/api/payments/1/refund', { amount: 1 })).status, 403);
    assert.equal((await operator.req('GET', '/api/settings')).status, 403);
    assert.equal((await operator.req('GET', '/api/users')).status, 403);
    assert.equal((await operator.req('GET', '/api/backup')).status, 403);
    assert.equal((await operator.req('GET', '/api/export/payments.csv')).status, 403);
    assert.equal((await operator.req('GET', '/api/security/sessions')).status, 200);
  });

  test('izleyici sadece okuyabilir', async () => {
    assert.equal((await viewer.req('GET', '/api/dashboard')).status, 200);
    assert.equal((await viewer.req('POST', '/api/products', { name: 'X' })).status, 403);
    assert.equal((await viewer.req('POST', '/api/leads/scan')).status, 403);
    assert.equal((await viewer.req('GET', '/api/audit')).status, 403);
  });

  test('yetki tablosu', () => {
    assert.equal(canAccess('operator', 'POST', '/projects/1/deploy'), true);
    assert.equal(canAccess('operator', 'POST', '/expenses'), false);
    assert.equal(canAccess('viewer', 'POST', '/security/password'), true);
    assert.equal(canAccess('viewer', 'GET', '/jobs'), false);
  });

  test('pasif edilen kullanıcının oturumu kapanır, son yönetici düşürülemez', async () => {
    const op = get(`SELECT id FROM users WHERE email = 'op@test.com'`);
    assert.equal((await admin.req('PUT', `/api/users/${op.id}`, { active: false })).status, 200);
    assert.equal((await operator.req('GET', '/api/conversations')).status, 401);
    assert.equal((await operator.req('POST', '/api/auth/login', { email: 'op@test.com', password: PW })).status, 401);
    const me = get(`SELECT id FROM users WHERE email = 'admin@test.com'`);
    const r = await admin.req('PUT', `/api/users/${me.id}`, { role: 'viewer' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /en az bir aktif yönetici/);
  });
});

describe('denetim kaydı, oturum ve erişim kuralları', () => {
  // The login endpoints are rate limited per IP; every test here logs in from 127.0.0.1.
  beforeEach(() => resetRateLimits());

  test('her değişiklik denetim kaydına gizli alanlar maskelenerek yazılır', async () => {
    await admin.req('PUT', '/api/settings/business', { name: 'Test Stüdyo', iban: 'TR12' });
    const rows = (await admin.req('GET', '/api/audit?q=settings')).data;
    const row = rows.find((r) => r.action === 'PUT /api/settings/business');
    assert.ok(row);
    assert.equal(row.email, 'admin@test.com');
    assert.equal(JSON.parse(row.detail).iban, '***');
    assert.equal(JSON.parse(row.detail).name, 'Test Stüdyo');
    const users = all(`SELECT detail FROM audit_log WHERE action = 'POST /api/users'`);
    assert.ok(users.every((u) => JSON.parse(u.detail).password === '***'));
  });

  test('hareketsiz kalan oturum sona erer', async () => {
    const c = client(base);
    await c.req('POST', '/api/auth/login', { email: 'v@test.com', password: PW });
    saveSection('security', { idle_timeout_minutes: 30 });
    run(`UPDATE sessions SET last_seen_at = datetime('now', '-31 minutes') WHERE user_id = (SELECT id FROM users WHERE email = 'v@test.com')`);
    assert.equal((await c.req('GET', '/api/dashboard')).status, 401);
    assert.ok(get(`SELECT id FROM login_events WHERE event = 'session_expired'`));
  });

  test('IP izin listesi dışından erişim engellenir', async () => {
    saveSection('security', { allowed_ips: ['10.1.1.*'] });
    assert.equal((await admin.req('GET', '/api/dashboard')).status, 401);
    assert.equal((await client(base).req('POST', '/api/auth/login', { email: 'admin@test.com', password: PW })).status, 403);
    saveSection('security', { allowed_ips: ['127.0.0.1', '::1'] });
    assert.equal((await admin.req('GET', '/api/dashboard')).status, 200);
    saveSection('security', { allowed_ips: [] });
  });

  test('yöneticiler için 2FA zorunlu tutulabilir', async () => {
    saveSection('security', { require_2fa_for_admins: true });
    const r = await admin.req('GET', '/api/dashboard');
    assert.equal(r.status, 403);
    assert.equal(r.data.code, '2fa_required');
    assert.equal((await admin.req('POST', '/api/security/2fa/setup')).status, 200);
    saveSection('security', { require_2fa_for_admins: false });
  });

  test('şifre sıfırlama bağlantısı bir kez çalışır ve oturumları kapatır', async () => {
    const r = await client(base).req('POST', '/api/auth/forgot', { email: 'yok@test.com' });
    assert.equal(r.status, 200); // same answer for unknown accounts
    const token = 'test-token-123';
    const v = get(`SELECT id FROM users WHERE email = 'v@test.com'`);
    run(`INSERT INTO password_resets (id, user_id, expires_at) VALUES (?, ?, ?)`,
      crypto.createHash('sha256').update(token).digest('hex'), v.id, new Date(Date.now() + 6e5).toISOString());
    const c = client(base);
    assert.equal((await c.req('POST', '/api/auth/reset', { token, password: 'kisa' })).status, 400);
    assert.equal((await c.req('POST', '/api/auth/reset', { token, password: 'YeniSifre4567' })).status, 200);
    assert.equal((await c.req('POST', '/api/auth/reset', { token, password: 'YeniSifre4567' })).status, 400);
    assert.equal((await c.req('POST', '/api/auth/login', { email: 'v@test.com', password: 'YeniSifre4567' })).status, 200);
  });

  test('yedek indirme ve CSV dışa aktarma', async () => {
    const backup = await admin.req('GET', '/api/backup', null, { raw: true });
    assert.equal(backup.status, 200);
    assert.equal(Buffer.from(await backup.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
    assert.ok(get(`SELECT id FROM notifications WHERE subject = 'Veritabanı yedeği indirildi'`));
    run(`INSERT INTO customers (name, email) VALUES ('=HYPERLINK("x")', 'a@b.c'), ('Şule Öztürk', NULL)`);
    const csv = await admin.req('GET', '/api/export/customers.csv', null, { raw: true });
    const text = await csv.text();
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(text, /Şule Öztürk/);
    assert.match(text, /'=HYPERLINK/, 'formüller etkisizleştirilmeli');
  });

  test('güvenlik başlıkları', async () => {
    const res = await fetch(`${base}/`);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  test('ikon ve yazı tipi dosyaları sunulur', async () => {
    const sprite = await fetch(`${base}/assets/icons.svg`);
    assert.equal(sprite.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
    const svg = await sprite.text();
    for (const id of ['sparkles', 'layout-dashboard', 'shield-check', 'triangle-alert']) assert.match(svg, new RegExp(`<symbol id="${id}"`));
    const font = await fetch(`${base}/assets/fonts/inter-latin-ext-wght-normal.woff2`);
    assert.equal(font.status, 200);
    assert.equal((await fetch(`${base}/assets/fonts/../../package.json`)).status, 404);
  });

  test('müşteri sohbeti hız sınırına takılır', async () => {
    resetRateLimits();
    const c = client(base);
    const { token } = (await c.req('POST', '/api/chat/start', { name: 'Spam' })).data;
    const codes = [];
    for (let i = 0; i < 17; i++) codes.push((await c.req('POST', `/api/chat/${token}/messages`, { text: `mesaj ${i}` })).status);
    assert.equal(codes.filter((s) => s === 429).length, 2);
  });
});
