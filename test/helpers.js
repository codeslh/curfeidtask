import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Must be imported before any src/ module so config picks up the test environment.
export const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-test-'));
process.env.DATA_DIR = tmp;
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.AI_MOCK = '1';
process.env.PUBLIC_URL = 'http://localhost';

/** Tiny cookie-aware API client bound to one server. */
export function client(base) {
  const c = { cookie: '' };
  c.req = async (method, url, body, { raw = false } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: c.cookie },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      redirect: 'manual',
    });
    const set = res.headers.get('set-cookie');
    if (set) c.cookie = set.split(';')[0];
    if (raw) return res;
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
  return c;
}
