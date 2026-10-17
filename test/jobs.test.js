import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { client, tmp } from './helpers.js';

const { openDb, get, all, insert, run } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { saveSection } = await import('../src/services/settings.js');
await import('../src/services/jobs.js');
const scheduler = await import('../src/services/scheduler.js');

let server;
let admin;

before(async () => {
  openDb();
  scheduler.syncJobs();
  saveSection('business', { iban: 'TR990000000000000000000001', timezone: 'Europe/Istanbul' });
  server = createApp().listen(0);
  admin = client(`http://127.0.0.1:${server.address().port}`);
  await admin.req('POST', '/api/auth/setup', { email: 'admin@test.com', password: 'GucluSifre123' });
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const notes = (like) => all('SELECT * FROM notifications WHERE subject LIKE ?', like);

describe('zamanlama hesapları', () => {
  test('günlük görev İstanbul saatine göre planlanır', () => {
    const from = new Date('2026-03-10T06:00:00Z'); // 09:00 in Istanbul (UTC+3)
    assert.equal(scheduler.nextRun({ type: 'daily', time: '10:00' }, from, 'Europe/Istanbul').toISOString(), '2026-03-10T07:00:00.000Z');
    assert.equal(scheduler.nextRun({ type: 'daily', time: '08:30' }, from, 'Europe/Istanbul').toISOString(), '2026-03-11T05:30:00.000Z');
  });

  test('aylık ve aralıklı görevler', () => {
    const from = new Date('2026-12-15T12:00:00Z');
    assert.equal(scheduler.nextRun({ type: 'monthly', day: 1, time: '09:00' }, from, 'Europe/Istanbul').toISOString(), '2027-01-01T06:00:00.000Z');
    assert.equal(scheduler.nextRun({ type: 'interval', minutes: 30 }, from).toISOString(), '2026-12-15T12:30:00.000Z');
  });

  test('geçersiz zamanlamalar reddedilir', () => {
    assert.throws(() => scheduler.validateSchedule({ type: 'daily', time: '25:00' }));
    assert.throws(() => scheduler.validateSchedule({ type: 'monthly', day: 31, time: '09:00' }));
    assert.throws(() => scheduler.validateSchedule({ type: 'interval', minutes: 0 }));
    assert.deepEqual(scheduler.validateSchedule({ type: 'interval', minutes: '15' }), { type: 'interval', minutes: 15 });
  });
});

describe('panelden görev yönetimi', () => {
  test('görevler listelenir, kapatılır, zamanı değiştirilir ve elle çalıştırılır', async () => {
    const list = (await admin.req('GET', '/api/jobs')).data.jobs;
    assert.ok(list.length >= 10);
    assert.ok(list.find((j) => j.name === 'payment_reminders').schedule_text.includes('Her gün'));
    assert.equal((await admin.req('PUT', '/api/jobs/cleanup', { schedule: { type: 'daily', time: '99:00' } })).status, 400);
    assert.equal((await admin.req('PUT', '/api/jobs/cleanup', { schedule: { type: 'daily', time: '05:15' }, enabled: false })).status, 200);
    const job = get(`SELECT * FROM jobs WHERE name = 'cleanup'`);
    assert.equal(job.enabled, 0);
    assert.equal(JSON.parse(job.schedule).time, '05:15');
    const r = await admin.req('POST', '/api/jobs/cleanup/run');
    assert.equal(r.data.status, 'ok');
    assert.equal(get(`SELECT trigger FROM job_runs WHERE job = 'cleanup' ORDER BY id DESC`).trigger, 'manual');
  });

  test('zamanı gelen etkin görevler çalışır, kapalılar çalışmaz', async () => {
    run(`UPDATE jobs SET next_run_at = '2000-01-01T00:00:00Z'`);
    run(`UPDATE jobs SET enabled = 0 WHERE name IN ('platform_scan', 'monthly_report', 'backup', 'daily_digest')`);
    const ran = await scheduler.tick();
    assert.ok(ran.includes('security_scan'));
    assert.ok(!ran.includes('backup'));
    const job = get(`SELECT * FROM jobs WHERE name = 'security_scan'`);
    assert.equal(job.last_status, 'ok');
    assert.ok(job.next_run_at > new Date().toISOString(), 'sonraki çalışma ileri alınmalı');
  });

  test('başarısız görev admine bildirilir', async () => {
    scheduler.defineJob('always_fails', { label: 'Test', description: '', defaultSchedule: { type: 'interval', minutes: 5 }, run: () => { throw new Error('bozuk'); } });
    scheduler.syncJobs();
    const r = await scheduler.runJob('always_fails');
    assert.equal(r.status, 'error');
    assert.equal(notes('Zamanlanmış görev başarısız%').length, 1);
  });
});

describe('otomasyon görevleri', () => {
  let convId;
  let paymentId;

  before(() => {
    const customer = insert('customers', { name: 'Mehmet', phone: '905551234567' });
    convId = insert('conversations', { customer_id: customer, channel: 'whatsapp', external_id: '905551234567' });
    insert('messages', { conversation_id: convId, sender: 'customer', body: 'Fiyat nedir?' });
    insert('messages', { conversation_id: convId, sender: 'ai', body: 'Landing page 4000 TRY.' });
    run(`UPDATE conversations SET last_message_at = datetime('now', '-30 hours') WHERE id = ?`, convId);
  });

  test('cevap vermeyen müşteriye bir kez takip mesajı gider', async () => {
    await scheduler.runJob('customer_followups');
    const last = get('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC', convId);
    assert.equal(last.sender, 'ai');
    assert.match(last.body, /dönüş yapmak istedik/);
    run(`UPDATE conversations SET last_message_at = datetime('now', '-30 hours') WHERE id = ?`, convId);
    const r = await scheduler.runJob('customer_followups');
    assert.match(r.message, /^0 takip/);
  });

  test('bekleyen ödeme için hatırlatma ve vade aşımı bildirimi', async () => {
    const project = insert('projects', { customer_id: 1, conversation_id: convId, title: 'Landing', price: 4000, status: 'awaiting_payment' });
    paymentId = insert('payments', { project_id: project, customer_id: 1, amount: 4000, method: 'iban', reference: 'PRJ1-ABC' });
    run(`UPDATE payments SET created_at = datetime('now', '-10 days') WHERE id = ?`, paymentId);
    const r = await scheduler.runJob('payment_reminders');
    assert.equal(r.message, '1 hatırlatma, 1 vadesi geçmiş ödeme bildirimi');
    const msg = get(`SELECT body FROM messages WHERE conversation_id = ? ORDER BY id DESC`, convId);
    assert.match(msg.body, /TR990000000000000000000001/);
    assert.match(msg.body, /PRJ1-ABC/);
    // Same day again: neither the reminder nor the overdue notice repeats.
    assert.equal((await scheduler.runJob('payment_reminders')).message, '0 hatırlatma, 0 vadesi geçmiş ödeme bildirimi');
  });

  test('admine aktarılmış ama yanıtlanmamış konuşma için tekrar uyarı', async () => {
    run(`UPDATE conversations SET status = 'escalated', mode = 'human', last_message_at = datetime('now', '-5 hours') WHERE id = ?`, convId);
    await scheduler.runJob('escalation_reminders');
    assert.equal(notes('Hâlâ cevap bekleniyor%').length, 1);
    await scheduler.runJob('escalation_reminders');
    assert.equal(notes('Hâlâ cevap bekleniyor%').length, 1, 'aynı konuşma için hemen tekrar uyarmamalı');
  });

  test('token bütçesi eşiği ayda bir kez uyarır', async () => {
    saveSection('ai', { monthly_token_budget: 1000 });
    insert('ai_usage', { purpose: 'sales', model: 'x', input_tokens: 850, output_tokens: 0 });
    await scheduler.runJob('token_budget_watch');
    await scheduler.runJob('token_budget_watch');
    assert.equal(notes('Yapay zeka bütçesinin %85%').length, 1);
    insert('ai_usage', { purpose: 'sales', model: 'x', input_tokens: 200, output_tokens: 0 });
    await scheduler.runJob('token_budget_watch');
    assert.equal(notes('Yapay zeka aylık bütçesi DOLDU').length, 1);
    saveSection('ai', { monthly_token_budget: 0 });
  });

  test('güvenlik taraması olağan dışı iade sayısını yakalar', async () => {
    run(`UPDATE payments SET status = 'paid' WHERE id = ?`, paymentId);
    for (let i = 0; i < 4; i++) insert('refunds', { payment_id: paymentId, amount: 1 });
    await scheduler.runJob('security_scan');
    const n = notes('Güvenlik taraması%');
    assert.equal(n.length, 1);
    assert.match(n[0].body, /4 iade/);
  });

  test('günlük özet ve aylık PDF rapor', async () => {
    await scheduler.runJob('daily_digest');
    assert.match(notes('Günlük özet%')[0].body, /Bekleyen ödeme: 0/);
    const r = await scheduler.runJob('monthly_report');
    assert.equal(r.status, 'ok');
    assert.equal(notes('%aylık raporu').length, 1);
  });

  test('yedek alınır ve eski yedekler silinir', async () => {
    saveSection('automation', { backup_keep: 2 });
    for (let i = 0; i < 3; i++) {
      await scheduler.runJob('backup');
      await new Promise((r) => setTimeout(r, 5));
    }
    const files = fs.readdirSync(path.join(tmp, 'backups'));
    assert.equal(files.length, 2);
    assert.equal(fs.readFileSync(path.join(tmp, 'backups', files[0])).subarray(0, 15).toString(), 'SQLite format 3');
  });

  test('temizlik süresi dolmuş kayıtları siler', async () => {
    insert('login_challenges', { id: 'x', user_id: 1, expires_at: '2000-01-01T00:00:00Z' });
    const r = await scheduler.runJob('cleanup');
    assert.match(r.message, /challenges: 1/);
  });
});
