import dns from 'node:dns/promises';
import net from 'node:net';

// All outbound HTTP goes through here so tests can stub it and so URLs that come
// from third-party data (business websites) can't make us call the local network.
let impl = (...args) => globalThis.fetch(...args);
export const httpFetch = (...args) => impl(...args);
export function setFetch(fn) { impl = fn || ((...args) => globalThis.fetch(...args)); }

let lookupImpl = (host, opts) => dns.lookup(host, opts);
export function setLookup(fn) { lookupImpl = fn || ((host, opts) => dns.lookup(host, opts)); }

export const USER_AGENT = 'Kalfa/0.1 (+https://github.com/codeslh/curfeidtask)';

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:127.')
    || v6.startsWith('::ffff:10.') || v6.startsWith('::ffff:192.168.');
}

/** Throws unless `url` is http(s) and resolves only to public addresses. */
export async function assertPublicUrl(url, { lookup = lookupImpl } = {}) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Geçersiz adres'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Yalnızca http/https adresleri');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Yerel adreslere istek atılmaz');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('Yerel ağ adreslerine istek atılmaz');
  return u;
}
