import { COOKIE, sessionFromToken } from '../services/security.js';

export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function clientInfo(req) {
  return { ip: req.ip, userAgent: String(req.get('user-agent') || '').slice(0, 300) };
}

export function requireAuth(req, res, next) {
  const session = sessionFromToken(req.cookies?.[COOKIE]);
  if (!session) return res.status(401).json({ error: 'Oturum açmanız gerekiyor' });
  req.session = session;
  next();
}
