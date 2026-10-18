// App shell: auth screens, navigation, top bar, command palette and the hash router.
import {
  $, $$, BRAND, GET, POST, THEMES, THEME_ICON, THEME_LABEL, api, app, avatar, esc, getTheme, icon, logo, setTheme, skeleton, store, toast, LABELS,
} from './core.js';
import { VIEWS } from './views/index.js';

const root = document.getElementById('app');

// [key, label, icon, group, roles]
export const NAV = [
  ['dashboard', 'Genel bakış', 'layout-dashboard', 'Çalışma alanı'],
  ['notifications', 'Bildirimler', 'bell', 'Çalışma alanı'],
  ['conversations', 'Konuşmalar', 'message-circle', 'Satış'],
  ['leads', 'İş ilanları', 'target', 'Satış'],
  ['customers', 'Müşteriler', 'users', 'Satış'],
  ['projects', 'Projeler', 'folder-kanban', 'Üretim'],
  ['catalog', 'Katalog', 'package', 'Üretim'],
  ['payments', 'Ödemeler', 'wallet', 'Finans'],
  ['expenses', 'Giderler', 'receipt', 'Finans'],
  ['jobs', 'Otomasyonlar', 'clock', 'Yönetim', ['admin']],
  ['users', 'Ekip', 'user-cog', 'Yönetim', ['admin']],
  ['audit', 'Denetim kaydı', 'scroll-text', 'Yönetim', ['admin']],
  ['security', 'Güvenlik', 'shield', 'Yönetim'],
  ['settings', 'Ayarlar', 'settings', 'Yönetim', ['admin']],
];
const visibleNav = () => NAV.filter(([, , , , roles]) => !roles || roles.includes(app.me?.role));

// ---------------------------------------------------------------------------
// Boot & auth screens
// ---------------------------------------------------------------------------

export async function boot() {
  const hash = location.hash.replace(/^#/, '');
  if (hash.startsWith('/reset/')) return renderReset(hash.slice(7));
  const status = await fetch('/api/auth/status').then((r) => r.json());
  if (status.needs_setup) return renderSetup();
  if (!status.user) return renderLogin();
  app.me = status.user;
  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
  route();
}

function authLayout(inner) {
  window.removeEventListener('hashchange', route);
  root.innerHTML = `<div class="auth">
    <section class="auth-art" aria-hidden="true">
      <div class="aurora"></div>
      <div class="auth-brand">${logo()}<span class="wordmark">${BRAND.name.toLocaleLowerCase('tr')}</span></div>
      <div class="auth-copy">
        <span class="auth-tag">${BRAND.tagline}</span>
        <h2>Satış temsilcin, geliştiricin ve muhasebecin — tek bir yapay zekada.</h2>
        <div class="auth-cards">
          <div class="glass-card"><span class="tile-icon accent">${icon('message-circle')}</span><div><b>Ayşe Y.</b><p>"Landing page için fiyat alabilir miyim?"</p></div></div>
          <div class="glass-card right"><span class="tile-icon accent">${icon('sparkles')}</span><div><b>Yapay zeka</b><p>Landing Page 4.000 ₺. Demo hazırlayayım mı?</p></div></div>
          <div class="glass-card"><span class="tile-icon good">${icon('banknote')}</span><div><b>Ödeme alındı</b><p>FTR-2026-00042 · 4.000 ₺</p></div></div>
        </div>
      </div>
      <div class="auth-foot">${icon('shield-check', 'sm')} İki adımlı doğrulama · Denetim kaydı · Uçtan uca otomasyon</div>
    </section>
    <section class="auth-main"><div class="auth-panel">${inner}</div></section>
  </div>`;
}

const authForm = (title, sub, body, after = '') => `<div class="auth-mobile-brand">${logo()}<span class="wordmark">${BRAND.name.toLocaleLowerCase('tr')}</span></div><div class="auth-head"><h1>${title}</h1><p>${sub}</p></div>
  <form id="f" class="stack">${body}<div class="form-error" id="err" role="alert"></div></form>${after}`;

async function submitAuth(fn) {
  const f = $('#f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', f);
    btn.disabled = true; btn.classList.add('is-busy');
    try { await fn(Object.fromEntries(new FormData(f))); } catch (err) { $('#err').textContent = err.message; } finally { btn.disabled = false; btn.classList.remove('is-busy'); }
  };
}

export function renderLogin() {
  authLayout(authForm('Tekrar hoş geldiniz', 'Devam etmek için hesabınıza giriş yapın.', `
    <label class="field">E-posta<input name="email" type="email" required autocomplete="username" placeholder="ornek@firma.com"></label>
    <label class="field"><span class="row-between">Şifre <a href="#" id="forgot" class="link">Şifremi unuttum</a></span><input name="password" type="password" required autocomplete="current-password" placeholder="••••••••••"></label>
    <button class="btn primary lg" type="submit">Giriş yap ${icon('arrow-up-right', 'sm')}</button>`,
  `<p class="auth-note">${icon('lock', 'sm')} Bağlantınız şifrelidir. Hatalı denemeler kayıt altına alınır.</p>`));
  $('#forgot').onclick = (e) => { e.preventDefault(); renderForgot(); };
  submitAuth(async (d) => {
    const r = await api('POST', '/auth/login', d);
    if (r.needs_2fa) return renderTwoFactor(r.challenge);
    boot();
  });
}
app.renderLogin = renderLogin;

function renderTwoFactor(challenge) {
  authLayout(authForm('İki adımlı doğrulama', 'Doğrulama uygulamanızdaki 6 haneli kodu girin. Kurtarma kodu da kullanabilirsiniz.', `
    <div class="otp-wrap"><span class="otp-icon">${icon('shield-check', 'lg')}</span></div>
    <label class="field">Doğrulama kodu<input name="code" class="otp" required autocomplete="one-time-code" inputmode="numeric" placeholder="000 000" autofocus></label>
    <button class="btn primary lg" type="submit">Doğrula</button>`,
  `<p class="auth-note"><a href="#" id="back" class="link">${icon('arrow-left', 'sm')} Girişe dön</a></p>`));
  $('#back').onclick = (e) => { e.preventDefault(); renderLogin(); };
  submitAuth(async (d) => {
    try {
      await api('POST', '/auth/2fa', { challenge, code: d.code });
      boot();
    } catch (err) {
      if (/süresi doldu/.test(err.message)) setTimeout(renderLogin, 1500);
      throw err;
    }
  });
}

function renderForgot() {
  authLayout(authForm('Şifrenizi mi unuttunuz?', 'E-posta adresinizi girin; kayıtlıysa sıfırlama bağlantısı göndereceğiz.', `
    <label class="field">E-posta<input name="email" type="email" required placeholder="ornek@firma.com"></label>
    <button class="btn primary lg" type="submit">Bağlantı gönder</button>`,
  `<p class="auth-note"><a href="#" id="back" class="link">${icon('arrow-left', 'sm')} Girişe dön</a></p>`));
  $('#back').onclick = (e) => { e.preventDefault(); renderLogin(); };
  submitAuth(async (d) => {
    const r = await api('POST', '/auth/forgot', d);
    $('#err').classList.add('ok');
    $('#err').textContent = r.message;
  });
}

function renderReset(token) {
  authLayout(authForm('Yeni şifre belirleyin', 'En az 10 karakter; harf ve rakam içermeli.', `
    <label class="field">Yeni şifre<input name="password" type="password" required autocomplete="new-password"></label>
    <label class="field">Yeni şifre (tekrar)<input name="password2" type="password" required autocomplete="new-password"></label>
    <button class="btn primary lg" type="submit">Şifreyi kaydet</button>`));
  submitAuth(async ({ password, password2 }) => {
    if (password !== password2) throw new Error('Şifreler eşleşmiyor');
    await api('POST', '/auth/reset', { token, password });
    location.hash = '';
    toast('Şifreniz değiştirildi, giriş yapabilirsiniz');
    renderLogin();
  });
}

function renderSetup() {
  authLayout(authForm('Kuruluma başlayın', 'Sistemin ilk yönetici hesabını oluşturun.', `
    <label class="field">Ad soyad<input name="name" required autocomplete="name"></label>
    <label class="field">E-posta<input name="email" type="email" required autocomplete="email"></label>
    <label class="field">Şifre<input name="password" type="password" required autocomplete="new-password"><small>En az 10 karakter, harf ve rakam.</small></label>
    <button class="btn primary lg" type="submit">Hesabı oluştur</button>`));
  submitAuth(async (d) => { await api('POST', '/auth/setup', d); boot(); });
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function renderShell(active) {
  const badge = (k) => (k === 'notifications' ? app.counts.unread : k === 'conversations' ? app.counts.esc : k === 'projects' ? app.counts.review : 0);
  const groups = [];
  for (const item of visibleNav()) {
    const g = groups.find((x) => x.name === item[3]) || groups[groups.push({ name: item[3], items: [] }) - 1];
    g.items.push(item);
  }
  const current = NAV.find(([k]) => k === active);
  const collapsed = store.get('nav', '') === 'collapsed';
  document.documentElement.classList.toggle('nav-collapsed', collapsed);
  root.innerHTML = `<div class="shell">
    <aside class="sidebar" id="sidebar" aria-label="Ana menü">
      <div class="sb-top">
        <a href="#/dashboard" class="sb-brand" aria-label="${BRAND.name}">${logo()}<span class="sb-text"><b class="wordmark">${BRAND.name.toLocaleLowerCase('tr')}</b><small>Yapay zeka kalfanız</small></span></a>
        <button class="icon-btn sb-collapse" id="collapse" title="Menüyü daralt" aria-label="Menüyü daralt">${icon('panel-left')}</button>
      </div>
      <button class="sb-search" id="openPalette">${icon('search', 'sm')}<span class="sb-text">Ara veya komut çalıştır</span><kbd class="sb-text">⌘K</kbd></button>
      <nav class="sb-nav">${groups.map((g) => `<div class="sb-group"><div class="sb-label">${g.name}</div>
        ${g.items.map(([k, l, ic]) => `<a href="#/${k}" class="sb-link ${k === active ? 'active' : ''}" title="${l}">${icon(ic)}<span class="sb-text">${l}</span>${badge(k) ? `<span class="sb-badge">${badge(k)}</span>` : ''}</a>`).join('')}
      </div>`).join('')}</nav>
      <div class="sb-user">
        <button class="sb-me" id="meBtn">${avatar(app.me?.name || '', 'sm')}<span class="sb-text"><b>${esc(app.me?.name || '')}</b><small>${esc(LABELS[app.me?.role] || '')}</small></span></button>
        <div class="menu" id="meMenu" hidden>
          <a href="#/security">${icon('shield')} Hesap ve güvenlik</a>
          <button data-theme-set="light">${icon('sun')} Açık tema</button>
          <button data-theme-set="dark">${icon('moon')} Koyu tema</button>
          <button data-theme-set="system">${icon('monitor')} Sistem teması</button>
          <hr><button id="logout" class="danger">${icon('log-out')} Çıkış yap</button>
        </div>
      </div>
    </aside>
    <div class="stage">
      <header class="topbar">
        <button class="icon-btn mobile-only" id="menuBtn" aria-label="Menü">${icon('menu')}</button>
        <nav class="crumbs" aria-label="Konum"><span>${esc(current?.[3] || '')}</span>${icon('chevron-right', 'sm')}<b>${esc(current?.[1] || '')}</b></nav>
        <span class="spacer"></span>
        <button class="search-pill" id="openPalette2">${icon('search', 'sm')}<span>Ara…</span><kbd>⌘K</kbd></button>
        <button class="icon-btn" id="themeBtn" title="${THEME_LABEL[getTheme()]}" aria-label="Tema değiştir">${icon(THEME_ICON[getTheme()])}</button>
        <a class="icon-btn" href="#/notifications" title="Bildirimler" aria-label="Bildirimler">${icon('bell')}${app.counts.unread ? '<span class="ping"></span>' : ''}</a>
      </header>
      <main id="main" class="page" tabindex="-1"></main>
    </div>
  </div>`;

  $('#collapse').onclick = () => {
    const on = !document.documentElement.classList.contains('nav-collapsed');
    document.documentElement.classList.toggle('nav-collapsed', on);
    store.set('nav', on ? 'collapsed' : '');
  };
  $('#menuBtn').onclick = (e) => { e.stopPropagation(); document.body.classList.toggle('nav-open'); };
  $('#openPalette').onclick = openPalette;
  $('#openPalette2').onclick = openPalette;
  $('#themeBtn').onclick = (e) => {
    const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
    setTheme(next);
    e.currentTarget.innerHTML = icon(THEME_ICON[next]);
    toast(THEME_LABEL[next]);
  };
  const menu = $('#meMenu');
  $('#meBtn').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  $$('[data-theme-set]', menu).forEach((b) => { b.onclick = () => { setTheme(b.dataset.themeSet); menu.hidden = true; renderTopTheme(); }; });
  $('#logout').onclick = async () => { await POST('/auth/logout'); location.hash = ''; renderLogin(); };
  return $('#main');
}

function renderTopTheme() {
  const b = $('#themeBtn');
  if (b) b.innerHTML = icon(THEME_ICON[getTheme()]);
}

document.addEventListener('click', (e) => {
  const menu = $('#meMenu');
  if (menu && !menu.hidden && !e.target.closest('.sb-user')) menu.hidden = true;
  if (document.body.classList.contains('nav-open') && !e.target.closest('#sidebar')) document.body.classList.remove('nav-open');
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

let routeSeq = 0;
export async function route() {
  clearInterval(app.poll);
  const seq = ++routeSeq;
  const [, page = 'dashboard', id] = location.hash.replace(/^#/, '').split('/');
  if (page === 'reset') return renderReset(id);
  const allowed = visibleNav().some(([k]) => k === page);
  const key = VIEWS[page] && allowed ? page : 'dashboard';
  try {
    const d = await GET('/dashboard');
    app.counts = { unread: d.unread_notifications, esc: d.open_escalations, review: d.projects_waiting_review };
  } catch { /* api() handles 401 */ }
  if (seq !== routeSeq) return;
  const main = renderShell(key);
  main.innerHTML = skeleton();
  document.body.classList.remove('nav-open');
  try {
    await VIEWS[key](main, id);
    main.classList.add('enter');
    if (!main.contains(document.activeElement)) main.focus({ preventScroll: true });
  } catch (err) {
    if (seq === routeSeq) main.innerHTML = `<div class="callout bad">${icon('circle-alert')} ${esc(err.message)}</div>`;
  }
  document.title = `${NAV.find(([k]) => k === key)?.[1] || 'Panel'} · ${BRAND.name}`;
}
app.route = route;

// ---------------------------------------------------------------------------
// Command palette (⌘K / Ctrl+K)
// ---------------------------------------------------------------------------

const ACTIONS = [
  { label: 'Platformları şimdi tara', icon: 'refresh-cw', hint: 'İş ilanları', run: async () => { location.hash = '#/leads'; const r = await POST('/leads/scan'); toast(`${r.fetched} ilan tarandı, ${r.contacted} ilan sahibine yazıldı`); route(); } },
  { label: 'Yeni proje oluştur', icon: 'plus', hint: 'Projeler', run: () => { location.hash = '#/projects/new'; } },
  { label: 'Yapay zeka analizi al', icon: 'sparkles', hint: 'Genel bakış', run: () => { sessionStorage.setItem('autoAnalyze', '1'); location.hash = '#/dashboard'; route(); } },
  { label: 'Aylık PDF raporu indir', icon: 'download', hint: 'Rapor', run: () => { location.href = `/api/reports/monthly.pdf?month=${new Date().toISOString().slice(0, 7)}`; } },
  { label: 'Açık temaya geç', icon: 'sun', hint: 'Görünüm', run: () => { setTheme('light'); renderTopTheme(); } },
  { label: 'Koyu temaya geç', icon: 'moon', hint: 'Görünüm', run: () => { setTheme('dark'); renderTopTheme(); } },
  { label: 'Çıkış yap', icon: 'log-out', hint: 'Hesap', run: async () => { await POST('/auth/logout'); location.hash = ''; renderLogin(); } },
];

let paletteData = null;
async function loadPaletteData() {
  const safe = (p) => p.catch(() => []);
  const [customers, projects, conversations] = await Promise.all([safe(GET('/customers')), safe(GET('/projects')), safe(GET('/conversations'))]);
  paletteData = { customers, projects, conversations, at: Date.now() };
}

export async function openPalette() {
  if ($('.palette-overlay')) return;
  const ov = document.createElement('div');
  ov.className = 'palette-overlay';
  ov.innerHTML = `<div class="palette" role="dialog" aria-label="Komut paleti">
    <div class="palette-input">${icon('search')}<input placeholder="Sayfa, müşteri, proje ara veya komut yaz…" aria-label="Ara" autocomplete="off"><kbd>ESC</kbd></div>
    <div class="palette-list" role="listbox"></div>
    <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> gezin</span><span><kbd>↵</kbd> aç</span><span><kbd>esc</kbd> kapat</span></div></div>`;
  document.body.append(ov);
  const input = $('input', ov);
  const list = $('.palette-list', ov);
  let items = [];
  let sel = 0;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  if (!paletteData || Date.now() - paletteData.at > 60_000) loadPaletteData().then(() => draw());

  function draw() {
    const q = input.value.toLocaleLowerCase('tr').trim();
    const match = (s) => !q || String(s).toLocaleLowerCase('tr').includes(q);
    const pages = visibleNav().filter(([, l]) => match(l)).map(([k, l, ic, g]) => ({ group: 'Sayfalar', label: l, icon: ic, hint: g, run: () => { location.hash = `#/${k}`; } }));
    const actions = ACTIONS.filter((a) => match(a.label)).map((a) => ({ ...a, group: 'Komutlar' }));
    const data = paletteData || { customers: [], projects: [], conversations: [] };
    const records = q ? [
      ...data.customers.filter((c) => match(`${c.name} ${c.email || ''} ${c.phone || ''}`)).slice(0, 5).map((c) => ({ group: 'Müşteriler', label: c.name, icon: 'user', hint: c.email || c.phone || '', run: () => { location.hash = '#/customers'; } })),
      ...data.projects.filter((p) => match(`${p.title} ${p.customer_name || ''}`)).slice(0, 5).map((p) => ({ group: 'Projeler', label: p.title, icon: 'folder-kanban', hint: LABELS[p.status] || p.status, run: () => { location.hash = `#/projects/${p.id}`; } })),
      ...data.conversations.filter((c) => match(`${c.customer_name || ''} ${c.last_message || ''}`)).slice(0, 5).map((c) => ({ group: 'Konuşmalar', label: c.customer_name || `#${c.id}`, icon: 'message-circle', hint: (c.last_message || '').slice(0, 50), run: () => { location.hash = `#/conversations/${c.id}`; } })),
    ] : [];
    items = [...records, ...pages, ...actions];
    sel = Math.min(sel, Math.max(0, items.length - 1));
    let lastGroup = '';
    list.innerHTML = items.map((it, i) => {
      const head = it.group !== lastGroup ? `<div class="palette-group">${it.group}</div>` : '';
      lastGroup = it.group;
      return `${head}<button class="palette-item ${i === sel ? 'sel' : ''}" data-i="${i}" role="option" aria-selected="${i === sel}">
        <span class="pi-icon">${icon(it.icon, 'sm')}</span><span class="pi-label">${esc(it.label)}</span><span class="pi-hint">${esc(it.hint || '')}</span>${i === sel ? icon('corner-down-left', 'sm') : ''}</button>`;
    }).join('') || `<div class="palette-empty">"${esc(input.value)}" için sonuç yok</div>`;
    $$('.palette-item', list).forEach((b) => {
      b.onmouseenter = () => { sel = Number(b.dataset.i); $$('.palette-item', list).forEach((x, j) => x.classList.toggle('sel', j === sel)); };
      b.onclick = () => runItem(Number(b.dataset.i));
    });
    $('.palette-item.sel', list)?.scrollIntoView({ block: 'nearest' });
  }
  async function runItem(i) {
    const it = items[i];
    if (!it) return;
    close();
    try { await it.run(); } catch (err) { toast(err.message, 'error'); }
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); } else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); } else if (e.key === 'Enter') { e.preventDefault(); runItem(sel); }
  }
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  input.oninput = () => { sel = 0; draw(); };
  draw();
  input.focus();
}

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && app.me) { e.preventDefault(); openPalette(); }
  if (e.key === '/' && app.me && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) {
    const q = $('.page .search input');
    if (q) { e.preventDefault(); q.focus(); }
  }
});
