// Optional public hosting for demos. Customers can't open http://localhost links,
// so when NETLIFY_TOKEN is set each demo is also published to a *.netlify.app site.
import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { httpFetch } from './http.js';

export const netlifyReady = () => Boolean(config.netlifyToken);
export const isLocalUrl = (u) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/i.test(u || '');

async function zipDir(dir) {
  const zip = new JSZip();
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else zip.file(path.relative(dir, full).split(path.sep).join('/'), fs.readFileSync(full));
    }
  };
  walk(dir);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function netlify(pathname, init = {}) {
  const res = await httpFetch(`https://api.netlify.com/api/v1${pathname}`, {
    ...init, headers: { Authorization: `Bearer ${config.netlifyToken}`, ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Netlify: ${data.message || res.status}`);
  return data;
}

/** Publish `dir` to Netlify. Reuses `siteId` when given. Returns { siteId, url }. */
export async function publishToNetlify(dir, { siteId, name } = {}) {
  let site = siteId ? { id: siteId } : null;
  if (!site) site = await netlify('/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(name ? { name } : {}) });
  const deployRes = await netlify(`/sites/${site.id}/deploys`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: await zipDir(dir) });
  const url = deployRes.ssl_url || deployRes.url || site.ssl_url || site.url;
  return { siteId: site.id, url: url.endsWith('/') ? url : `${url}/` };
}
