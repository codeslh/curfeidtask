import express from 'express';
import { config } from '../config.js';
import { get } from '../db.js';
import { COOKIE, createUser, login, logout, publicUser, sessionFromToken } from '../services/security.js';
import { asyncRoute, clientInfo, requireAuth } from './util.js';

export const router = express.Router();

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: config.publicUrl.startsWith('https://'),
  maxAge: config.sessionDays * 864e5,
  path: '/',
});

router.get('/status', (req, res) => {
  const session = sessionFromToken(req.cookies?.[COOKIE]);
  res.json({
    needs_setup: !get('SELECT id FROM users LIMIT 1'),
    user: session ? { id: session.user_id, email: session.email, name: session.name, role: session.role } : null,
  });
});

// First-run only: create the initial admin account.
router.post('/setup', asyncRoute(async (req, res) => {
  if (get('SELECT id FROM users LIMIT 1')) return res.status(403).json({ error: 'Kurulum zaten tamamlanmış' });
  const { email, name, password } = req.body || {};
  if (!email) return res.status(400).json({ error: 'E-posta zorunlu' });
  try {
    await createUser({ email, name: name || 'Admin', password });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const { ip, userAgent } = clientInfo(req);
  const { token, user } = await login(email, password, ip, userAgent);
  res.cookie(COOKIE, token, cookieOptions()).json({ user });
}));

router.post('/login', asyncRoute(async (req, res) => {
  const { ip, userAgent } = clientInfo(req);
  try {
    const { token, user } = await login(req.body?.email, req.body?.password, ip, userAgent);
    res.cookie(COOKIE, token, cookieOptions()).json({ user });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
}));

router.post('/logout', requireAuth, (req, res) => {
  const { ip, userAgent } = clientInfo(req);
  logout(req.session, ip, userAgent);
  res.clearCookie(COOKIE, { path: '/' }).json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(publicUser(get('SELECT * FROM users WHERE id = ?', req.session.user_id)));
});
