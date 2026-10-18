// Shared building blocks for every screen: API client, formatting, icons and UI primitives.

/** Mutable app state shared between the shell and the views (set by shell.js). */
export const app = {
  me: null,
  route: () => {},
  renderLogin: () => {},
  poll: null,
  counts: { unread: 0, esc: 0, review: 0 },
};

// --- Formatting ---------------------------------------------------------------

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n, cur = '') => `${Number(n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}${cur ? ` ${cur}` : ''}`;
export const compact = (n) => Number(n || 0).toLocaleString('tr-TR', { notation: 'compact', maximumFractionDigits: 1 });
export const parseDate = (s) => (s ? new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`) : null);
export const date = (s) => (s ? parseDate(s).toLocaleString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const day = (s) => (s ? parseDate(s).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export function ago(s) {
  if (!s) return '—';
  const mins = Math.round((Date.now() - parseDate(s)) / 60000);
  if (mins < 1) return 'şimdi';
  if (mins < 60) return `${mins} dk önce`;
  if (mins < 1440) return `${Math.round(mins / 60)} sa önce`;
  if (mins < 10080) return `${Math.round(mins / 1440)} gün önce`;
  return day(s);
}
export function until(s) {
  if (!s) return '—';
  const mins = Math.round((parseDate(s) - Date.now()) / 60000);
  if (mins <= 0) return 'birazdan';
  if (mins < 60) return `${mins} dk sonra`;
  if (mins < 1440) return `${Math.round(mins / 60)} sa sonra`;
  return parseDate(s).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export const pct = (cur, prev) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : cur ? 100 : 0);

// --- DOM ------------------------------------------------------------------------

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
/** Brand: name, tagline and the "K + spark" glyph (white on the gradient .logo tile). */
export const BRAND = { name: 'Kalfa', tagline: 'Usta sensin, işi Kalfa yapar.' };
export const logo = (cls = '') => `<span class="logo ${cls}"><svg class="brand-glyph" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v34"/><path d="M21 37 36 22"/><path d="M29.5 29.5 44 49"/></g><path fill="currentColor" d="M45 9c.9 4.6 2.9 6.6 7.5 7.5-4.6.9-6.6 2.9-7.5 7.5-.9-4.6-2.9-6.6-7.5-7.5 4.6-.9 6.6-2.9 7.5-7.5z"/></svg></span>`;
export const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="/assets/icons.svg#${name}"/></svg>`;
export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toLocaleUpperCase('tr') || '?';
export function avatar(name, cls = '') {
  const hue = [...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % 6;
  return `<span class="avatar ${cls} h${hue}" aria-hidden="true">${esc(initials(name))}</span>`;
}
export const empty = (title, text = '', ic = 'inbox', action = '') =>
  `<div class="empty"><div class="empty-icon">${icon(ic)}</div><b>${esc(title)}</b><p>${esc(text)}</p>${action}</div>`;
export const skeleton = (rows = 3) => `<div class="skeleton-page">
  <div class="sk sk-title"></div><div class="sk sk-sub"></div>
  <div class="bento">${'<div class="sk sk-card span-3"></div>'.repeat(4)}</div>
  ${'<div class="sk sk-block"></div>'.repeat(rows)}</div>`;

/** Standard page header: title, optional subtitle and right-aligned actions. */
export const pageHeader = ({ title, subtitle = '', actions = '', eyebrow = '' }) => `<header class="page-head">
  <div>${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}<h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div>
  ${actions ? `<div class="page-actions">${actions}</div>` : ''}</header>`;

/** Segmented control. items: [[value, label, count?]] */
export const segmented = (name, items, active) => `<div class="segmented" role="tablist" data-seg="${name}">${items.map(([v, l, n]) =>
  `<button type="button" role="tab" data-value="${v}" class="${v === active ? 'active' : ''}" aria-selected="${v === active}">${l}${n !== undefined ? `<span class="count">${n}</span>` : ''}</button>`).join('')}</div>`;

export function onSegment(root, name, fn) {
  $$(`[data-seg="${name}"] button`, root).forEach((b) => { b.onclick = () => fn(b.dataset.value); });
}

export const searchBox = (placeholder = 'Ara…', id = 'q') =>
  `<label class="search">${icon('search', 'sm')}<input id="${id}" type="search" placeholder="${placeholder}" autocomplete="off"></label>`;

/** Live-filter elements matching `itemSel` by their text content. */
export function liveFilter(input, itemSel, root = document) {
  if (!input) return;
  input.oninput = () => {
    const q = input.value.toLocaleLowerCase('tr').trim();
    let shown = 0;
    $$(itemSel, root).forEach((el) => {
      const hit = !q || el.textContent.toLocaleLowerCase('tr').includes(q);
      el.hidden = !hit;
      if (hit) shown++;
    });
    const none = $('[data-no-results]', root);
    if (none) none.hidden = shown > 0;
  };
}

// --- Status pills -------------------------------------------------------------------

const TONE = {
  open: 'neutral', escalated: 'bad', closed: 'neutral', ai: 'accent', human: 'warn',
  new: 'info', filtered_out: 'neutral', contacted: 'good', needs_admin: 'warn', won: 'good', lost: 'neutral',
  pending: 'warn', paid: 'good', refunded: 'bad', partially_refunded: 'warn', cancelled: 'neutral', failed: 'bad',
  building: 'accent', revision: 'accent', review: 'warn', build_failed: 'bad', approved: 'info', changes_requested: 'warn',
  demo_live: 'info', customer_approved: 'good', awaiting_payment: 'warn', delivered: 'good',
  ok: 'good', error: 'bad', running: 'accent', '2fa_failed': 'bad', login_failed: 'bad', login_blocked: 'bad', '2fa_disabled': 'warn',
  login_success: 'good', '2fa_enabled': 'good', admin: 'accent', operator: 'info', viewer: 'neutral',
};
export const LABELS = {
  open: 'Açık', escalated: 'Admin bekliyor', closed: 'Kapalı', ai: 'Yapay zeka', human: 'Admin',
  new: 'Yeni', filtered_out: 'Kapsam dışı', contacted: 'İletişime geçildi', needs_admin: 'Admin ilgilenmeli', won: 'Kazanıldı', lost: 'Kaybedildi',
  pending: 'Bekliyor', paid: 'Ödendi', refunded: 'İade edildi', partially_refunded: 'Kısmi iade', cancelled: 'İptal', failed: 'Başarısız',
  building: 'Geliştiriliyor', build_failed: 'Geliştirme başarısız', review: 'Kontrol bekliyor', revision: 'Revizyon', approved: 'Onaylandı',
  demo_live: 'Demo müşteride', changes_requested: 'Değişiklik istendi', customer_approved: 'Müşteri onayladı',
  awaiting_payment: 'Ödeme bekleniyor', delivered: 'Teslim edildi',
  whatsapp: 'WhatsApp', web: 'Web', email: 'E-posta', platform: 'Platform',
  login_success: 'Giriş', login_failed: 'Hatalı giriş', login_blocked: 'Engellendi', logout: 'Çıkış',
  password_changed: 'Şifre değişti', session_revoked: 'Oturum sonlandırıldı', settings_changed: 'Ayar değişti', refund: 'İade',
  password_ok: 'Şifre doğru, 2FA bekleniyor', '2fa_failed': 'Hatalı 2FA kodu', '2fa_enabled': '2FA açıldı', '2fa_disabled': '2FA kapatıldı',
  password_reset: 'Şifre sıfırlandı', reset_requested: 'Sıfırlama istendi', session_expired: 'Oturum zaman aşımı', recovery_codes_regenerated: 'Kurtarma kodları yenilendi',
  ok: 'Başarılı', error: 'Hata', running: 'Çalışıyor', schedule: 'Zamanlanmış', manual: 'Elle',
  admin: 'Yönetici', operator: 'Operatör', viewer: 'İzleyici',
};
export const pill = (s, text) => `<span class="pill ${TONE[s] || 'neutral'}">${esc(text ?? LABELS[s] ?? s)}</span>`;
export const CHANNEL_ICON = { whatsapp: 'message-circle', web: 'globe', email: 'mail', platform: 'briefcase' };

// --- API ----------------------------------------------------------------------------

export async function api(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  if (res.status === 401 && !url.startsWith('/auth')) { app.renderLogin(); throw new Error('Oturum açın'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.code === '2fa_required' && location.hash !== '#/security') {
    location.hash = '#/security';
    toast(data.error, 'error');
  }
  if (!res.ok) throw new Error(data.error || `Hata ${res.status}`);
  return data;
}
export const GET = (u) => api('GET', u);
export const POST = (u, b) => api('POST', u, b);
export const PUT = (u, b) => api('PUT', u, b);
export const DEL = (u) => api('DELETE', u);

// --- Feedback -------------------------------------------------------------------------

export function toast(msg, kind = 'ok') {
  let stack = $('#toasts');
  if (!stack) { stack = document.createElement('div'); stack.id = 'toasts'; stack.setAttribute('aria-live', 'polite'); document.body.append(stack); }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'error' ? 'circle-alert' : 'circle-check', 'sm')}<span></span>`;
  el.querySelector('span').textContent = msg;
  stack.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, 3800);
}

/** Run an async action, toasting errors (and an optional success message). */
export async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r ?? true;
  } catch (err) {
    toast(err.message, 'error');
    return undefined;
  }
}

/** Mark a button busy while `fn` runs. */
export async function busy(btn, fn) {
  if (!btn) return fn();
  btn.disabled = true;
  btn.classList.add('is-busy');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('is-busy'); }
}

// --- Modal / drawer ----------------------------------------------------------------------

/**
 * Open a modal dialog. `body` is HTML; if it contains a <form>, submitting it calls
 * onSubmit(data, form). Resolves with onSubmit's result, or null when dismissed.
 */
export function modal({ title, description = '', body = '', submitText = 'Kaydet', danger = false, wide = false, drawer = false, onSubmit, hideFooter = false }) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = `overlay ${drawer ? 'is-drawer' : ''}`;
    root.innerHTML = `<div class="dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <form class="dialog-form" novalidate>
        <header class="dialog-head"><div><h2 id="dlg-title">${title}</h2>${description ? `<p>${description}</p>` : ''}</div>
          <button type="button" class="icon-btn" data-close aria-label="Kapat">${icon('x')}</button></header>
        <div class="dialog-body">${body}</div>
        ${hideFooter ? '' : `<footer class="dialog-foot"><span class="dialog-error" role="alert"></span>
          <button type="button" class="btn ghost" data-close>Vazgeç</button>
          <button type="submit" class="btn ${danger ? 'danger-solid' : 'primary'}">${submitText}</button></footer>`}
      </form></div>`;
    const close = (val = null) => {
      root.classList.add('closing');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => root.remove(), 160);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    $$('[data-close]', root).forEach((b) => { b.onclick = () => close(); });
    const form = $('form', root);
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      if (!onSubmit) return close(true);
      const btn = $('button[type="submit"]', root);
      const err = $('.dialog-error', root);
      if (err) err.textContent = '';
      try {
        const r = await busy(btn, () => onSubmit(Object.fromEntries(new FormData(form)), form));
        if (r !== false) close(r ?? true);
      } catch (ex) {
        if (err) err.textContent = ex.message; else toast(ex.message, 'error');
      }
    };
    document.body.append(root);
    requestAnimationFrame(() => ($('input:not([type=hidden]), textarea, select', root) || $('[type=submit]', root))?.focus());
    root.close = close;
  });
}

export const confirmDialog = (title, description, { danger = false, confirmText = 'Onayla' } = {}) =>
  modal({ title, description, submitText: confirmText, danger, body: '' });

/** Small helper for "ask one value" dialogs (replaces window.prompt). */
export function ask(title, { label, type = 'text', value = '', description = '', placeholder = '', required = true, submitText = 'Tamam' }) {
  return modal({
    title, description, submitText,
    body: `<label class="field">${label}<input name="v" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} ${type === 'number' ? 'step="0.01"' : ''}></label>`,
    onSubmit: (d) => d.v,
  });
}

export const field = (name, label, { type = 'text', value = '', required = false, placeholder = '', hint = '', options, rows, span } = {}) => {
  const attrs = `name="${name}" ${required ? 'required' : ''} placeholder="${esc(placeholder)}"`;
  let input;
  if (options) input = `<select ${attrs}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if (type === 'textarea') input = `<textarea ${attrs} rows="${rows || 4}">${esc(value)}</textarea>`;
  else input = `<input ${attrs} type="${type}" value="${esc(value)}" ${type === 'number' ? 'step="0.01"' : ''}>`;
  return `<label class="field ${span ? 'span-2' : ''}">${label}${input}${hint ? `<small>${hint}</small>` : ''}</label>`;
};

export const toggle = (name, checked, label = '', attrs = '') =>
  `<label class="switch">${label ? `<span>${label}</span>` : ''}<input type="checkbox" name="${name}" ${checked ? 'checked' : ''} ${attrs}><i></i></label>`;

// --- Theme -----------------------------------------------------------------------------------

export const THEMES = ['system', 'light', 'dark'];
export const THEME_LABEL = { system: 'Sistem teması', light: 'Açık tema', dark: 'Koyu tema' };
export const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' };
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
export { store };
export const getTheme = () => store.get('theme', 'system');
export function applyTheme(t = getTheme()) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
export function setTheme(t) { store.set('theme', t); applyTheme(t); }
export const isAdmin = () => app.me?.role === 'admin';
