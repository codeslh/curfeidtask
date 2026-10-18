import cookieParser from 'cookie-parser';
import express from 'express';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { router as adminRouter } from './routes/admin.js';
import { router as assetsRouter } from './routes/assets.js';
import { router as authRouter } from './routes/auth.js';
import { router as publicRouter } from './routes/public.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(express.json({
    limit: '2mb',
    // Webhook signatures are computed over the exact raw body.
    verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
  }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Content-Type-Options', 'nosniff');
    // Geolocation stays allowed for our own pages: "Konumumu bul" on the Bölge taraması page uses it.
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    if (config.publicUrl.startsWith('https://')) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Panel pages only load our own scripts.
    res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
    // Browsers only send JSON from scripts; refusing other content types blocks form-based CSRF.
    if (req.path.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: 'İstekler JSON olmalı' });
    }
    next();
  });

  app.use(assetsRouter);
  app.use(publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api', adminRouter);
  app.use(express.static(path.join(ROOT, 'public')));

  app.use((err, _req, res, _next) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Sunucu hatası' });
  });
  return app;
}
