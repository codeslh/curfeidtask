import express from 'express';
import { config } from '../config.js';
import { get } from '../db.js';
import { rateLimit } from '../services/ratelimit.js';
import {
  COOKIE, createUser, login, logout, publicUser, requestPasswordReset, resetPassword, sessionFromToken, verifyChallenge,
} from '../services/security.js';
import { asyncRoute, auditTrail, clientInfo, requireAuth } from './util.js';

export const router = express.Router();

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: config.publicUrl.startsWith('https://'),
  maxAge: config.sessionDays * 864e5,
  path: '/',
});

const fail = (res, err) => res.status(err.status || 400).json({ error: err.message });
const authLimit = rateLimit({ name: 'auth', windowMs: 60_000, max: 20 });

router.get('/status', (req, res) => {
  const session = sessionFromToken(req.cookies?.[COOKIE], req.ip);
  res.json({
    needs_setup: !get('SELECT id FROM users LIMIT 1'),
    user: session ? publicUser({ ...session, id: session.user_id }) : null,
  });
});

// First-run only: create the initial admin account.
router.post('/setup', authLimit, asyncRoute(async (req, res) => {
  if (get('SELECT id FROM users LIMIT 1')) return res.status(403).json({ error: 'Kurulum zaten tamamlanmış' });
  const { email, name, password } = req.body || {};
  const { ip, userAgent } = clientInfo(req);
  try {
    await createUser({ email, name: name || 'Admin', password, role: 'admin' });
    const { token, user } = await login(email, password, ip, userAgent);
    res.cookie(COOKIE, token, cookieOptions()).json({ user });
  } catch (err) {
    fail(res, err);
  }
}));

router.post('/login', authLimit, asyncRoute(async (req, res) => {
  const { ip, userAgent } = clientInfo(req);
  try {
    const result = await login(req.body?.email, req.body?.password, ip, userAgent);
    if (result.challenge) return res.json({ needs_2fa: true, challenge: result.challenge });
    res.cookie(COOKIE, result.token, cookieOptions()).json({ user: result.user });
  } catch (err) {
    fail(res, err);
  }
}));

router.post('/2fa', authLimit, asyncRoute(async (req, res) => {
  const { ip, userAgent } = clientInfo(req);
  try {
    const { token, user } = await verifyChallenge(req.body?.challenge, req.body?.code, ip, userAgent);
    res.cookie(COOKIE, token, cookieOptions()).json({ user });
  } catch (err) {
    fail(res, err);
  }
}));

router.post('/forgot', rateLimit({ name: 'forgot', windowMs: 3_600_000, max: 5 }), asyncRoute(async (req, res) => {
  const { ip, userAgent } = clientInfo(req);
  await requestPasswordReset(req.body?.email, ip, userAgent);
  res.json({ ok: true, message: 'Bu e-posta kayıtlıysa sıfırlama bağlantısı gönderildi.' });
}));

router.post('/reset', authLimit, auditTrail, asyncRoute(async (req, res) => {
  const { ip, userAgent } = clientInfo(req);
  try {
    await resetPassword(req.body?.token, req.body?.password, ip, userAgent);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
}));

router.post('/logout', requireAuth, (req, res) => {
  const { ip, userAgent } = clientInfo(req);
  logout(req.session, ip, userAgent);
  res.clearCookie(COOKIE, { path: '/' }).json({ ok: true });
});
