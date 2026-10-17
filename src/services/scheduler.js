import { all, get, insert, run, update } from '../db.js';
import { notifyAdmin } from './notify.js';
import { getSection } from './settings.js';

/*
 * Database-backed task scheduler. Each job has a schedule (interval / daily / monthly),
 * can be switched off or run by hand from the panel, and keeps a run history.
 * A single timer ticks every 30 seconds and starts whatever is due.
 */

const registry = new Map(); // name -> { label, description, defaultSchedule, defaultEnabled, run(ctx) }
const running = new Set();
let timer;

export function defineJob(name, def) {
  registry.set(name, def);
}

// --- Time zone helpers (Intl, no dependency) -----------------------------------

function zoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute, s: p.second };
}

/** UTC instant for a wall-clock time in `timeZone`. */
function zonedToUtc({ y, m, d, h, min }, timeZone) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const p = zoneParts(new Date(guess), timeZone);
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - guess;
  return new Date(guess - offset);
}

export function nextRun(schedule, from = new Date(), timeZone = getSection('business').timezone || 'UTC') {
  if (schedule.type === 'interval') return new Date(from.getTime() + Math.max(1, schedule.minutes) * 60_000);
  const [h, min] = String(schedule.time || '08:00').split(':').map(Number);
  const local = zoneParts(from, timeZone);
  if (schedule.type === 'daily') {
    let at = zonedToUtc({ ...local, h, min }, timeZone);
    if (at <= from) at = zonedToUtc({ ...zoneParts(new Date(at.getTime() + 864e5), timeZone), h, min }, timeZone);
    return at;
  }
  if (schedule.type === 'monthly') {
    const day = Math.min(Math.max(1, schedule.day || 1), 28);
    let at = zonedToUtc({ y: local.y, m: local.m, d: day, h, min }, timeZone);
    if (at <= from) {
      const ny = local.m === 12 ? local.y + 1 : local.y;
      const nm = local.m === 12 ? 1 : local.m + 1;
      at = zonedToUtc({ y: ny, m: nm, d: day, h, min }, timeZone);
    }
    return at;
  }
  throw new Error(`Bilinmeyen zamanlama: ${schedule.type}`);
}

export function describeSchedule(s) {
  if (s.type === 'interval') return s.minutes % 60 === 0 ? `Her ${s.minutes / 60} saatte bir` : `Her ${s.minutes} dakikada bir`;
  if (s.type === 'daily') return `Her gün ${s.time}`;
  if (s.type === 'monthly') return `Her ayın ${s.day}. günü ${s.time}`;
  return '-';
}

export function validateSchedule(s) {
  if (!s || typeof s !== 'object') throw new Error('Zamanlama gerekli');
  if (s.type === 'interval') {
    if (!(Number(s.minutes) >= 1 && Number(s.minutes) <= 7 * 1440)) throw new Error('Aralık 1 dakika ile 7 gün arasında olmalı');
    return { type: 'interval', minutes: Math.round(Number(s.minutes)) };
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time || '')) throw new Error('Saat SS:DD biçiminde olmalı');
  if (s.type === 'daily') return { type: 'daily', time: s.time };
  if (s.type === 'monthly') {
    if (!(Number(s.day) >= 1 && Number(s.day) <= 28)) throw new Error('Gün 1-28 arasında olmalı');
    return { type: 'monthly', day: Number(s.day), time: s.time };
  }
  throw new Error('Zamanlama türü interval, daily veya monthly olmalı');
}

// --- Persistence -----------------------------------------------------------------

/** Insert rows for newly defined jobs; keeps admin edits for existing ones. */
export function syncJobs() {
  for (const [name, def] of registry) {
    if (!get('SELECT name FROM jobs WHERE name = ?', name)) {
      insert('jobs', {
        name, enabled: def.defaultEnabled === false ? 0 : 1,
        schedule: JSON.stringify(def.defaultSchedule),
        next_run_at: nextRun(def.defaultSchedule).toISOString(),
      });
    }
  }
}

export function listJobs() {
  return all('SELECT * FROM jobs ORDER BY name').filter((j) => registry.has(j.name)).map((j) => {
    const schedule = JSON.parse(j.schedule);
    const def = registry.get(j.name);
    return {
      ...j, schedule, state: undefined,
      label: def.label, description: def.description, schedule_text: describeSchedule(schedule), running: running.has(j.name),
    };
  });
}

export function jobRuns(name, limit = 50) {
  return name
    ? all('SELECT * FROM job_runs WHERE job = ? ORDER BY id DESC LIMIT ?', name, limit)
    : all('SELECT * FROM job_runs ORDER BY id DESC LIMIT ?', limit);
}

export function updateJob(name, { enabled, schedule }) {
  const job = get('SELECT * FROM jobs WHERE name = ?', name);
  if (!job || !registry.has(name)) throw Object.assign(new Error('Görev bulunamadı'), { status: 404 });
  const patch = {};
  if (enabled !== undefined) patch.enabled = enabled ? 1 : 0;
  if (schedule !== undefined) {
    const s = validateSchedule(schedule);
    patch.schedule = JSON.stringify(s);
    patch.next_run_at = nextRun(s).toISOString();
  }
  run(`UPDATE jobs SET ${Object.keys(patch).map((k) => `${k} = ?`).join(', ')} WHERE name = ?`, ...Object.values(patch), name);
}

// --- Execution ---------------------------------------------------------------------

export async function runJob(name, trigger = 'manual') {
  const def = registry.get(name);
  if (!def) throw Object.assign(new Error('Görev bulunamadı'), { status: 404 });
  if (running.has(name)) throw Object.assign(new Error('Görev zaten çalışıyor'), { status: 409 });
  running.add(name);
  const job = get('SELECT * FROM jobs WHERE name = ?', name);
  const runId = insert('job_runs', { job: name, trigger, status: 'running', started_at: new Date().toISOString() });
  const state = JSON.parse(job?.state || '{}');
  let status = 'ok';
  let message;
  try {
    message = (await def.run({ state, trigger })) || 'Tamamlandı';
  } catch (err) {
    status = 'error';
    message = err.message;
    console.error(`Görev hatası (${name}):`, err);
    await notifyAdmin('job_failed', `Zamanlanmış görev başarısız: ${def.label}`, err.message, '/jobs');
  } finally {
    running.delete(name);
  }
  const finished = new Date();
  update('job_runs', runId, { status, message: String(message).slice(0, 2000), finished_at: finished.toISOString() });
  const schedule = JSON.parse(job?.schedule || JSON.stringify(def.defaultSchedule));
  run('UPDATE jobs SET state = ?, last_run_at = ?, last_status = ?, last_message = ?, next_run_at = ? WHERE name = ?',
    JSON.stringify(state), finished.toISOString(), status, String(message).slice(0, 500),
    trigger === 'schedule' ? nextRun(schedule, finished).toISOString() : (job?.next_run_at ?? nextRun(schedule).toISOString()), name);
  return { status, message };
}

export async function tick(now = new Date()) {
  const due = all('SELECT name FROM jobs WHERE enabled = 1 AND next_run_at <= ?', now.toISOString());
  for (const { name } of due) {
    if (registry.has(name) && !running.has(name)) await runJob(name, 'schedule').catch((e) => console.error(e));
  }
  return due.map((d) => d.name);
}

export function startScheduler() {
  if (timer) return;
  syncJobs();
  timer = setInterval(() => tick().catch((e) => console.error('Zamanlayıcı hatası:', e)), 30_000);
  timer.unref();
}

export function stopScheduler() {
  clearInterval(timer);
  timer = undefined;
}
