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

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'TRY',
  features TEXT NOT NULL DEFAULT '',
  demo_url TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  preview_url TEXT NOT NULL DEFAULT '',
  style_guide TEXT NOT NULL DEFAULT '',  -- colours/fonts/layout notes handed to the AI builder
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS languages (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,                    -- e.g. "HTML/CSS/JS", "React", "Laravel"
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  mode TEXT NOT NULL DEFAULT 'ai',       -- ai | human
  status TEXT NOT NULL DEFAULT 'open',   -- open | escalated | closed
  escalation_reason TEXT,
  project_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS conversations_ext ON conversations(channel, external_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  sender TEXT NOT NULL,                  -- customer | ai | admin | system
  body TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  budget_min REAL, budget_max REAL,
  currency TEXT,
  url TEXT,
  skills TEXT NOT NULL DEFAULT '',
  client_name TEXT,
  contact TEXT,                          -- JSON {email, phone, platform_message}
  status TEXT NOT NULL DEFAULT 'new',    -- new | filtered_out | contacted | needs_admin | won | lost
  filter_reason TEXT,
  customer_id INTEGER, conversation_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(platform, external_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  conversation_id INTEGER,
  lead_id INTEGER,
  title TEXT NOT NULL,
  requirements TEXT NOT NULL DEFAULT '',
  theme_id INTEGER, language_id INTEGER,
  status TEXT NOT NULL DEFAULT 'won',
  price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'TRY',
  current_version INTEGER NOT NULL DEFAULT 0,
  demo_slug TEXT UNIQUE,
  demo_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_versions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  feedback TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, version)
);

CREATE TABLE IF NOT EXISTS project_events (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  project_id INTEGER, customer_id INTEGER,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TRY',
  method TEXT NOT NULL,                  -- iban | stripe
  status TEXT NOT NULL DEFAULT 'pending',-- pending | paid | refunded | partially_refunded | failed | cancelled
  reference TEXT NOT NULL,               -- payment reference the customer writes on the transfer
  provider_ref TEXT,
  checkout_url TEXT,
  refunded_amount REAL NOT NULL DEFAULT 0,
  note TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  amount REAL NOT NULL,
  reason TEXT,
  provider_ref TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'sale',     -- sale | refund
  payment_id INTEGER, project_id INTEGER, customer_id INTEGER,
  subtotal REAL NOT NULL, tax_rate REAL NOT NULL, tax_amount REAL NOT NULL, total REAL NOT NULL,
  currency TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,                -- ai | hosting | ads | software | other
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TRY',
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
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
  suggested_product TEXT,
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
  conversations: {
    followup_count: 'INTEGER NOT NULL DEFAULT 0',
    last_escalation_notice_at: 'TEXT',
  },
  payments: {
    reminder_count: 'INTEGER NOT NULL DEFAULT 0',
    last_reminder_at: 'TEXT',
    overdue_notified: 'INTEGER NOT NULL DEFAULT 0',
  },
};

function migrate(d) {
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const existing = new Set(d.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [col, def] of Object.entries(cols)) {
      if (!existing.has(col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  }
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
