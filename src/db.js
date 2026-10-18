import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config, dataPath } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  password_changed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,               -- sha256 of the cookie token
  user_id INTEGER NOT NULL REFERENCES users(id),
  ip TEXT, user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS login_events (
  id INTEGER PRIMARY KEY,
  user_id INTEGER, email TEXT,
  event TEXT NOT NULL,               -- login_success | login_failed | logout | password_changed | session_revoked
  ip TEXT, user_agent TEXT,
  suspicious INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT, phone TEXT,
  platform TEXT, platform_user TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  channel TEXT NOT NULL,                 -- whatsapp | web | platform | email
  external_id TEXT,                      -- phone number / platform thread id / web token
  mode TEXT NOT NULL DEFAULT 'human',    -- legacy column, always human now
  status TEXT NOT NULL DEFAULT 'open',   -- open | closed
  escalation_reason TEXT,
  project_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS conversations_ext ON conversations(channel, external_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  sender TEXT NOT NULL,                  -- customer | admin | system
  body TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL,                -- freelancer | bionluk | armut | r10 | hallederim | rss | web | manual ...
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  budget_min REAL, budget_max REAL,
  currency TEXT,
  url TEXT,
  skills TEXT NOT NULL DEFAULT '',
  client_name TEXT,
  contact TEXT,                          -- JSON {email, phone}
  status TEXT NOT NULL DEFAULT 'new',    -- new | filtered_out | contacted | replied | won | lost | ignored
  filter_reason TEXT,
  customer_id INTEGER, conversation_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(platform, external_id)
);

-- Where leads come from: Freelancer.com API, RSS feeds and watched public listing pages.
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,                    -- freelancer_api | rss | page
  platform TEXT NOT NULL DEFAULT 'web',  -- see PLATFORMS in services/sources.js
  name TEXT NOT NULL,
  url TEXT,
  link_pattern TEXT,                     -- page: only links containing this text (or /regex/)
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT, last_status TEXT, last_message TEXT, last_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  emailed INTEGER NOT NULL DEFAULT 0,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pending second factor after a correct password (short-lived).
CREATE TABLE IF NOT EXISTS login_challenges (
  id TEXT PRIMARY KEY,               -- sha256 of the challenge token
  user_id INTEGER NOT NULL REFERENCES users(id),
  ip TEXT, user_agent TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,               -- sha256 of the e-mailed token
  user_id INTEGER NOT NULL REFERENCES users(id),
  ip TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every state-changing action taken through the panel.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER, email TEXT,
  action TEXT NOT NULL,              -- e.g. "POST /api/payments/3/refund"
  status INTEGER,
  detail TEXT,
  ip TEXT, user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS jobs (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  schedule TEXT NOT NULL,            -- JSON: {type:'interval',minutes} | {type:'daily',time} | {type:'monthly',day,time}
  state TEXT NOT NULL DEFAULT '{}',  -- job-private JSON (e.g. last month reported)
  last_run_at TEXT, last_status TEXT, last_message TEXT,
  next_run_at TEXT
);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL,
  trigger TEXT NOT NULL,             -- schedule | manual
  status TEXT NOT NULL,              -- running | ok | error
  message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS job_runs_job ON job_runs(job, id);

-- Local business prospecting ("Bölge taraması").
CREATE TABLE IF NOT EXISTS prospects (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,                  -- osm | google | demo
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  address TEXT,
  lat REAL, lng REAL,
  phone TEXT, email TEXT, website TEXT,
  raw TEXT,                              -- JSON of the source record (tags)
  site_check TEXT,                       -- JSON result of the website inspection
  signals TEXT,                          -- JSON array of human-readable findings
  score INTEGER,                         -- 0-100 likelihood of needing a website
  score_reason TEXT,
  suggested_product TEXT,                -- unused (kept for older databases)
  message TEXT,                          -- drafted outreach message (editable)
  status TEXT NOT NULL DEFAULT 'new',    -- new | analyzed | contacted | replied | opted_out | skipped | converted
  channel TEXT,                          -- email | whatsapp | whatsapp_link | phone
  customer_id INTEGER, conversation_id INTEGER,
  scan_id INTEGER,
  analyzed_at TEXT, contacted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS prospects_status ON prospects(status, score);

CREATE TABLE IF NOT EXISTS prospect_scans (
  id INTEGER PRIMARY KEY,
  location TEXT, lat REAL, lng REAL, radius_km REAL, categories TEXT, source TEXT,
  found INTEGER NOT NULL DEFAULT 0, added INTEGER NOT NULL DEFAULT 0, analyzed INTEGER NOT NULL DEFAULT 0, contacted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running', message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
);

-- People who asked not to be contacted again. Checked before every outreach.
CREATE TABLE IF NOT EXISTS do_not_contact (
  id INTEGER PRIMARY KEY,
  phone TEXT, email TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Columns added after the first release; ALTER them into older databases.
const COLUMNS = {
  users: {
    active: 'INTEGER NOT NULL DEFAULT 1',
    notify: 'INTEGER NOT NULL DEFAULT 1',
    totp_secret: 'TEXT',
    totp_enabled: 'INTEGER NOT NULL DEFAULT 0',
    recovery_codes: 'TEXT',
    last_login_at: 'TEXT',
    totp_last_counter: 'INTEGER NOT NULL DEFAULT 0', // blocks replay of an already used code
  },
  leads: {
    score: 'INTEGER',                    // keyword/budget match, 0-100
    posted_at: 'TEXT',
    contacted_at: 'TEXT',
    notes: "TEXT NOT NULL DEFAULT ''",
    source_id: 'INTEGER',
  },
  conversations: {
    followup_count: 'INTEGER NOT NULL DEFAULT 0',
    last_escalation_notice_at: 'TEXT',
    last_reminder_at: 'TEXT',            // "unanswered message" alert
  },
};

function migrate(d) {
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const existing = new Set(d.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [col, def] of Object.entries(cols)) {
      if (!existing.has(col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  }
  // Statuses from the earlier AI version that no longer exist.
  d.exec(`UPDATE leads SET status = 'new' WHERE status = 'needs_admin';
          UPDATE conversations SET status = 'open', mode = 'human' WHERE status = 'escalated' OR mode = 'ai';`);
}

let db;

export function openDb(file) {
  if (db) db.close();
  const target = file || config.dbFile || dataPath('app.db');
  if (target !== ':memory:') fs.mkdirSync(config.dataDir, { recursive: true });
  db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export function getDb() {
  if (!db) openDb();
  return db;
}

// Small helpers so call sites stay short.
export const all = (sql, ...p) => getDb().prepare(sql).all(...p);
export const get = (sql, ...p) => getDb().prepare(sql).get(...p);
export const run = (sql, ...p) => getDb().prepare(sql).run(...p);

export function insert(table, row) {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return Number(run(sql, ...keys.map((k) => row[k] ?? null)).lastInsertRowid);
}

export function update(table, id, row) {
  const keys = Object.keys(row);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => row[k] ?? null), id);
}

export function tx(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}
