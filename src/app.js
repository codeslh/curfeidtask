import cookieParser from 'cookie-parser';
import express from 'express';
import path from 'node:path';
import { ROOT } from './config.js';
import { router as adminRouter } from './routes/admin.js';
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
    // Browsers only send JSON from scripts; refusing other content types blocks form-based CSRF.
    if (req.path.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: 'İstekler JSON olmalı' });
    }
    next();
  });

  app.use(publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api', adminRouter);
  app.get('/chat', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'chat.html')));
  app.use(express.static(path.join(ROOT, 'public')));

  app.use((err, _req, res, _next) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Sunucu hatası' });
  });
  return app;
}
