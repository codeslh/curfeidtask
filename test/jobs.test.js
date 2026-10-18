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
  saveSection('business', { timezone: 'Europe/Istanbul' });
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
    assert.ok(list.length >= 8);
    assert.ok(list.find((j) => j.name === 'daily_digest').schedule_text.includes('Her gün'));
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
    run(`UPDATE jobs SET enabled = 0 WHERE name IN ('platform_scan', 'prospect_scan', 'backup', 'daily_digest')`);
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

  before(() => {
    const customer = insert('customers', { name: 'Mehmet', phone: '905551234567' });
    convId = insert('conversations', { customer_id: customer, channel: 'whatsapp', external_id: '905551234567', mode: 'human' });
    insert('messages', { conversation_id: convId, sender: 'admin', body: 'Merhaba, ilanınızı gördüm.' });
    insert('messages', { conversation_id: convId, sender: 'customer', body: 'Fiyat nedir?' });
    run(`UPDATE conversations SET last_message_at = datetime('now', '-6 hours') WHERE id = ?`, convId);
  });

  test('cevap bekleyen konuşma için hatırlatma bir kez gider', async () => {
    await scheduler.runJob('reply_reminders');
    assert.equal(notes('Cevabınızı bekliyor%').length, 1);
    await scheduler.runJob('reply_reminders');
    assert.equal(notes('Cevabınızı bekliyor%').length, 1, 'aynı konuşma için hemen tekrar uyarmamalı');
  });

  test('siz cevap verdikten sonra hatırlatma gitmez', async () => {
    insert('messages', { conversation_id: convId, sender: 'admin', body: '3.000 TL' });
    run(`UPDATE conversations SET last_message_at = datetime('now', '-6 hours'), last_reminder_at = NULL WHERE id = ?`, convId);
    const r = await scheduler.runJob('reply_reminders');
    assert.match(r.message, /^0 konuşma/);
  });

  test('güvenlik taraması çok sayıda IP adresinden kullanımı yakalar', async () => {
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      insert('sessions', { id: `s-${ip}`, user_id: 1, ip, expires_at: '2999-01-01T00:00:00Z' });
    }
    await scheduler.runJob('security_scan');
    const n = notes('Güvenlik taraması%');
    assert.equal(n.length, 1);
    assert.match(n[0].body, /farklı IP/);
  });

  test('günlük özet bulunan ilanları ve bekleyenleri listeler', async () => {
    insert('leads', { platform: 'r10', external_id: 'x1', title: 'Kuaför sitesi yapılacak', status: 'new', score: 80, url: 'https://www.r10.net/x1' });
    await scheduler.runJob('daily_digest');
    const body = notes('Günlük özet%')[0].body;
    assert.match(body, /Yeni uygun ilan: 1/);
    assert.match(body, /Kuaför sitesi yapılacak/);
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
