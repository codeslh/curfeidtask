import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';

export const router = express.Router();

// Only the icons the UI uses, bundled into one small SVG sprite (<use href="/assets/icons.svg#name">).
const ICONS = [
  'layout-dashboard', 'message-circle', 'briefcase', 'folder-kanban', 'users', 'package', 'wallet', 'receipt', 'bell',
  'clock', 'user-cog', 'scroll-text', 'shield', 'settings', 'log-out', 'sun', 'moon', 'monitor', 'search', 'sparkles',
  'trending-up', 'trending-down', 'banknote', 'user-plus', 'target', 'bot', 'send', 'arrow-left', 'download', 'play',
  'check', 'x', 'triangle-alert', 'file-text', 'lock', 'key-round', 'menu', 'chevron-right', 'plus', 'refresh-cw', 'eye',
  'rocket', 'credit-card', 'coins', 'calendar', 'inbox', 'history', 'filter', 'shield-check', 'zap', 'message-square-text',
  'cpu', 'percent', 'external-link', 'trash-2', 'pencil', 'circle-check', 'circle-alert', 'mail', 'phone', 'globe', 'hand-coins',
];

let sprite;
function buildSprite() {
  const dir = path.join(ROOT, 'node_modules', 'lucide-static', 'icons');
  const symbols = ICONS.map((name) => {
    const file = path.join(dir, `${name}.svg`);
    if (!fs.existsSync(file)) return '';
    const inner = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
    return `<symbol id="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</symbol>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>`;
}

router.get('/assets/icons.svg', (_req, res) => {
  sprite ??= buildSprite();
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(sprite);
});

router.use('/assets/fonts', express.static(path.join(ROOT, 'node_modules', '@fontsource-variable', 'inter', 'files'), { maxAge: '30d', immutable: true }));
