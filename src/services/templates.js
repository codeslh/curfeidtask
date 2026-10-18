// Fills the message templates from Ayarlar → Mesaj şablonları.
import { getSection } from './settings.js';

/**
 * Placeholders: {ad} {ad_bosluklu} {kategori} {bulgu} {ilan} {isletmem} {yetkili} {telefonum} {sitem}.
 * Unknown placeholders are left as they are so a typo is visible in the preview.
 */
export function render(template, vars = {}) {
  const b = getSection('business');
  const all = {
    isletmem: b.name, yetkili: b.owner_name, telefonum: b.phone, sitem: b.website,
    ...vars,
    ad_bosluklu: vars.ad ? ` ${vars.ad}` : '',
  };
  return String(template || '')
    .replace(/\{(\w+)\}/g, (m, key) => (all[key] !== undefined && all[key] !== null ? String(all[key]) : m))
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export const template = (key) => getSection('templates')[key] || '';
