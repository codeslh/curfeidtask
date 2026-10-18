import { audit, COOKIE, sessionFromToken } from '../services/security.js';
import { getSection } from '../services/settings.js';

export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function clientInfo(req) {
  return { ip: req.ip, userAgent: String(req.get('user-agent') || '').slice(0, 300) };
}

export function requireAuth(req, res, next) {
  const session = sessionFromToken(req.cookies?.[COOKIE], req.ip);
  if (!session) return res.status(401).json({ error: 'Oturum açmanız gerekiyor' });
  req.session = session;
  next();
}

/*
 * Role-based access. Paths are relative to /api.
 *   admin    - everything
 *   operator - day-to-day prospecting work; no exports, settings or team
 *   viewer   - read-only, no security/settings/team data
 * Every role may manage its own account (password, 2FA, own sessions).
 */
const OWN_ACCOUNT = [/^\/security\/(password|sessions|2fa)/, /^\/me$/];
const ADMIN_ONLY = [/^\/settings/, /^\/users/, /^\/audit/, /^\/backup/, /^\/jobs/, /^\/security\/events/];
const BULK_EXPORT = [/^\/export/];

export function canAccess(role, method, path) {
  if (role === 'admin') return true;
  if (OWN_ACCOUNT.some((r) => r.test(path))) return true;
  if (ADMIN_ONLY.some((r) => r.test(path))) return false;
  const read = method === 'GET' || method === 'HEAD';
  if (role === 'viewer') return read;
  if (role === 'operator') return !BULK_EXPORT.some((r) => r.test(path));
  return false;
}

export function authorize(req, res, next) {
  if (!canAccess(req.session.role, req.method, req.path)) {
    return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
  }
  // Optionally force admins to turn on 2FA before they can do anything else.
  if (req.session.role === 'admin' && !req.session.totp_enabled && getSection('security').require_2fa_for_admins
      && !OWN_ACCOUNT.some((r) => r.test(req.path))) {
    return res.status(403).json({ error: 'Devam etmek için iki adımlı doğrulamayı açmalısınız', code: '2fa_required' });
  }
  next();
}

const SECRET_FIELDS = /pass|secret|token|code/i;

function redact(body) {
  if (!body || typeof body !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = SECRET_FIELDS.test(k) ? '***' : typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v;
  }
  return JSON.stringify(out);
}

/** Audit every state-changing request once the response is sent. */
export function auditTrail(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const { ip, userAgent } = clientInfo(req);
  res.on('finish', () => {
    audit({
      user_id: req.session?.user_id ?? null,
      email: req.session?.email ?? null,
      action: `${req.method} ${req.baseUrl}${req.path}`,
      status: res.statusCode,
      detail: redact(req.body),
      ip, user_agent: userAgent,
    });
  });
  next();
}
