// Admin panel: a small hash-routed SPA on top of the JSON API.

const app = document.getElementById('app');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, cur = '') => `${Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${cur}`.trim();
const date = (s) => (s ? new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).toLocaleString('tr-TR') : '-');
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="/assets/icons.svg#${name}"/></svg>`;
const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toLocaleUpperCase('tr') || '?';
const avatar = (name, cls = '') => {
  const hue = [...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % 5 + 1;
  return `<span class="avatar ${cls} c${hue}">${esc(initials(name))}</span>`;
};
const empty = (title, text = '', ic = 'inbox') => `<div class="empty">${icon(ic)}<b>${esc(title)}</b>${esc(text)}</div>`;

// --- Theme (light / dark / system), remembered per browser ----------------------
const THEMES = ['system', 'light', 'dark'];
function getTheme() { try { return localStorage.getItem('theme') || 'system'; } catch { return 'system'; } }
function applyTheme(t) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
applyTheme(getTheme());
function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
  try { localStorage.setItem('theme', next); } catch { /* private mode */ }
  applyTheme(next);
  return next;
}
const themeIcon = () => ({ system: 'monitor', light: 'sun', dark: 'moon' }[getTheme()]);
const THEME_LABEL = { system: 'Sistem teması', light: 'Açık tema', dark: 'Koyu tema' };

async function api(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  if (res.status === 401 && !url.startsWith('/auth')) { renderLogin(); throw new Error('Oturum açın'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.code === '2fa_required' && location.hash !== '#/security') {
    location.hash = '#/security';
    toast(data.error, true);
  }
  if (!res.ok) throw new Error(data.error || `Hata ${res.status}`);
  return data;
}
const GET = (u) => api('GET', u);
const POST = (u, b) => api('POST', u, b);
const PUT = (u, b) => api('PUT', u, b);
const DEL = (u) => api('DELETE', u);

function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.className = `toast${isError ? ' err' : ''}`;
  let stack = $('#toasts');
  if (!stack) { stack = document.createElement('div'); stack.id = 'toasts'; document.body.append(stack); }
  stack.append(el);
  setTimeout(() => el.remove(), 3500);
}

/** Run an async action from a button, with error toasts. */
async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (err) {
    toast(err.message, true);
    return undefined;
  }
}

const STATUS_PILL = {
  open: '', escalated: 'bad', closed: 'muted', ai: 'good', human: 'warn',
  new: '', filtered_out: 'muted', contacted: 'good', needs_admin: 'warn', won: 'good', lost: 'muted',
  pending: 'warn', paid: 'good', refunded: 'bad', partially_refunded: 'warn', cancelled: 'muted', failed: 'bad',
  review: 'warn', build_failed: 'bad', changes_requested: 'warn', demo_live: 'good', awaiting_payment: 'warn', delivered: 'good',
  ok: 'good', error: 'bad', running: 'warn', '2fa_failed': 'bad', login_failed: 'bad', login_blocked: 'bad', '2fa_disabled': 'warn',
};
const LABELS = {
  open: 'Açık', escalated: 'Admin bekliyor', closed: 'Kapalı', ai: 'Yapay zeka', human: 'Admin',
  new: 'Yeni', filtered_out: 'Kapsam dışı', contacted: 'İletişime geçildi', needs_admin: 'Admin ilgilenmeli', won: 'Kazanıldı', lost: 'Kaybedildi',
  pending: 'Bekliyor', paid: 'Ödendi', refunded: 'İade edildi', partially_refunded: 'Kısmi iade', cancelled: 'İptal', failed: 'Başarısız',
  building: 'Geliştiriliyor', build_failed: 'Geliştirme başarısız', review: 'Kontrol bekliyor', revision: 'Revizyon', approved: 'Onaylandı',
  demo_live: 'Demo müşteride', changes_requested: 'Müşteri değişiklik istedi', customer_approved: 'Müşteri onayladı',
  awaiting_payment: 'Ödeme bekleniyor', delivered: 'Teslim edildi',
  whatsapp: 'WhatsApp', web: 'Web', email: 'E-posta', platform: 'Platform',
  login_success: 'Giriş', login_failed: 'Hatalı giriş', login_blocked: 'Engellendi', logout: 'Çıkış',
  password_changed: 'Şifre değişti', session_revoked: 'Oturum sonlandırıldı', settings_changed: 'Ayar değişti', refund: 'İade',
  password_ok: 'Şifre doğru (2FA bekleniyor)', '2fa_failed': 'Hatalı 2FA kodu', '2fa_enabled': '2FA açıldı', '2fa_disabled': '2FA kapatıldı',
  password_reset: 'Şifre sıfırlandı', reset_requested: 'Sıfırlama istendi', session_expired: 'Oturum zaman aşımı', recovery_codes_regenerated: 'Kurtarma kodları yenilendi',
  ok: 'Başarılı', error: 'Hata', running: 'Çalışıyor', schedule: 'Zamanlanmış', manual: 'Elle',
  admin: 'Yönetici', operator: 'Operatör', viewer: 'İzleyici',
};
const pill = (s) => `<span class="pill ${STATUS_PILL[s] || ''}">${esc(LABELS[s] || s)}</span>`;

// ---------------------------------------------------------------------------
// Shell, auth
// ---------------------------------------------------------------------------

// [key, label, icon, group, roles allowed to see it]
const NAV = [
  ['dashboard', 'Panel', 'layout-dashboard', 'Genel'],
  ['notifications', 'Bildirimler', 'bell', 'Genel'],
  ['conversations', 'Konuşmalar', 'message-circle', 'Satış'],
  ['leads', 'İş ilanları', 'target', 'Satış'],
  ['customers', 'Müşteriler', 'users', 'Satış'],
  ['projects', 'Projeler', 'folder-kanban', 'Üretim'],
  ['catalog', 'Ürün & fiyatlar', 'package', 'Üretim'],
  ['payments', 'Ödemeler & faturalar', 'wallet', 'Finans'],
  ['expenses', 'Giderler', 'receipt', 'Finans'],
  ['jobs', 'Zamanlanmış görevler', 'clock', 'Yönetim', ['admin']],
  ['users', 'Ekip', 'user-cog', 'Yönetim', ['admin']],
  ['audit', 'Denetim kaydı', 'scroll-text', 'Yönetim', ['admin']],
  ['security', 'Güvenlik', 'shield', 'Yönetim'],
  ['settings', 'Ayarlar', 'settings', 'Yönetim', ['admin']],
];
const visibleNav = () => NAV.filter(([, , , , roles]) => !roles || roles.includes(me?.role));
const isAdmin = () => me?.role === 'admin';

let me = null;
let pollTimer = null;

async function boot() {
  const hash = location.hash.replace(/^#/, '');
  if (hash.startsWith('/reset/')) return renderReset(hash.slice(7));
  const status = await fetch('/api/auth/status').then((r) => r.json());
  if (status.needs_setup) return renderSetup();
  if (!status.user) return renderLogin();
  me = status.user;
  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
  route();
}

function authCard(inner) {
  window.removeEventListener('hashchange', route);
  const feature = (ic, text) => `<li><span class="tile-icon">${icon(ic)}</span>${text}</li>`;
  app.innerHTML = `<div class="auth">
    <section class="auth-hero">
      <div class="brand"><span class="logo">${icon('sparkles')}</span><div><b>Freelance Otomasyon</b><small>Yapay zekalı satış & üretim</small></div></div>
      <h2>Müşterini bulsun, satsın, üretsin. Sen sadece onayla.</h2>
      <p>Yapay zeka satış temsilcin WhatsApp'tan cevap verir, iş ilanlarını tarar, projeyi geliştirir ve ödemeyi takip eder.</p>
      <ul>
        ${feature('message-circle', 'Satıcı gibi konuşan yapay zeka asistanı')}
        ${feature('rocket', 'Otomatik geliştirme, revizyon ve demo yayını')}
        ${feature('wallet', 'Ödeme, iade, fatura ve aylık raporlar')}
        ${feature('shield-check', 'İki adımlı doğrulama ve denetim kaydı')}
      </ul>
    </section>
    <section class="auth-main"><div class="login">${inner}</div></section>
  </div>`;
}

function renderLogin() {
  authCard(`<h1>Tekrar hoş geldiniz</h1><p class="muted">Panelinize giriş yapın.</p>
    <form id="f"><label>E-posta<input name="email" type="email" required autocomplete="username"></label>
    <label>Şifre<input name="password" type="password" required autocomplete="current-password"></label>
    <div class="error" id="err"></div><button class="primary">Giriş yap</button>
    <div class="links"><span class="muted">${icon('lock', 'sm')} Güvenli bağlantı</span><a href="#" id="forgot">Şifremi unuttum</a></div></form>`);
  $('#forgot').onclick = (e) => { e.preventDefault(); renderForgot(); };
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/auth/login', Object.fromEntries(new FormData(e.target)));
      if (r.needs_2fa) return renderTwoFactor(r.challenge);
      boot();
    } catch (err) { $('#err').textContent = err.message; }
  };
}

function renderTwoFactor(challenge) {
  authCard(`<h1>İki adımlı doğrulama</h1><p class="muted">Doğrulama uygulamanızdaki 6 haneli kodu girin. Telefonunuza erişemiyorsanız kurtarma kodlarınızdan birini kullanabilirsiniz.</p>
    <form id="f"><label>Kod<input name="code" required autocomplete="one-time-code" inputmode="numeric" autofocus></label>
    <div class="error" id="err"></div><button class="primary">${icon('shield-check')} Doğrula</button>
    <div class="links"><a href="#" id="back">${icon('arrow-left', 'sm')} Girişe dön</a></div></form>`);
  $('#back').onclick = (e) => { e.preventDefault(); renderLogin(); };
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/auth/2fa', { challenge, code: e.target.code.value });
      boot();
    } catch (err) {
      $('#err').textContent = err.message;
      if (/süresi doldu/.test(err.message)) setTimeout(renderLogin, 1500);
    }
  };
}

function renderForgot() {
  authCard(`<h1>Şifremi unuttum</h1><p class="muted">E-posta adresinizi girin; kayıtlıysa şifre sıfırlama bağlantısı gönderilecek.</p>
    <form id="f"><label>E-posta<input name="email" type="email" required></label>
    <div class="error" id="err"></div><button class="primary">${icon('mail')} Bağlantı gönder</button>
    <div class="links"><a href="#" id="back">${icon('arrow-left', 'sm')} Girişe dön</a></div></form>`);
  $('#back').onclick = (e) => { e.preventDefault(); renderLogin(); };
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/auth/forgot', Object.fromEntries(new FormData(e.target)));
      $('#err').style.color = 'var(--good)';
      $('#err').textContent = r.message;
    } catch (err) { $('#err').textContent = err.message; }
  };
}

function renderReset(token) {
  authCard(`<h1>Yeni şifre belirle</h1>
    <form id="f"><label>Yeni şifre (en az 10 karakter, harf + rakam)<input name="password" type="password" required autocomplete="new-password"></label>
    <label>Yeni şifre (tekrar)<input name="password2" type="password" required autocomplete="new-password"></label>
    <div class="error" id="err"></div><button class="primary">Şifreyi kaydet</button></form>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const { password, password2 } = Object.fromEntries(new FormData(e.target));
    if (password !== password2) { $('#err').textContent = 'Şifreler eşleşmiyor'; return; }
    try {
      await api('POST', '/auth/reset', { token, password });
      location.hash = '';
      toast('Şifreniz değiştirildi, giriş yapabilirsiniz');
      renderLogin();
    } catch (err) { $('#err').textContent = err.message; }
  };
}

function renderSetup() {
  authCard(`<h1>İlk kurulum</h1><p class="muted">Yönetici hesabını oluşturun.</p>
    <form id="f"><label>Ad<input name="name" required></label><label>E-posta<input name="email" type="email" required></label>
    <label>Şifre (en az 10 karakter, harf + rakam)<input name="password" type="password" required autocomplete="new-password"></label>
    <div class="error" id="err"></div><button class="primary">Oluştur</button></form>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/auth/setup', Object.fromEntries(new FormData(e.target)));
      boot();
    } catch (err) { $('#err').textContent = err.message; }
  };
}

async function shell(active) {
  let counts = { unread: 0, esc: 0 };
  try {
    const d = await GET('/dashboard');
    counts = { unread: d.unread_notifications, esc: d.open_escalations, review: d.projects_waiting_review };
  } catch { /* handled by api() */ }
  const badge = (k) => (k === 'notifications' && counts.unread ? counts.unread
    : k === 'conversations' && counts.esc ? counts.esc
    : k === 'projects' && counts.review ? counts.review : 0);
  const groups = [];
  for (const item of visibleNav()) {
    const g = groups.find((x) => x.name === item[3]) || groups[groups.push({ name: item[3], items: [] }) - 1];
    g.items.push(item);
  }
  const current = NAV.find(([k]) => k === active);
  app.innerHTML = `<div class="layout">
    <aside class="side" id="side">
      <div class="brand"><span class="logo">${icon('sparkles')}</span><div><b>Freelance</b><small>Otomasyon paneli</small></div></div>
      ${groups.map((g) => `<div class="nav-group"><div class="nav-title">${g.name}</div>
        ${g.items.map(([k, l, ic]) => `<a href="#/${k}" class="nav ${k === active ? 'active' : ''}">${icon(ic)}<span class="label">${l}</span>${badge(k) ? `<span class="badge">${badge(k)}</span>` : ''}</a>`).join('')}
      </div>`).join('')}
      <div class="side-foot">${avatar(me?.name || '')}<div class="who"><b>${esc(me?.name || '')}</b><small>${esc(LABELS[me?.role] || '')}</small></div>
        <button class="icon-btn" id="logout" title="Çıkış yap" aria-label="Çıkış yap">${icon('log-out')}</button></div>
    </aside>
    <div class="content">
      <header class="topbar">
        <button class="icon-btn menu-btn" id="menuBtn" aria-label="Menü">${icon('menu')}</button>
        <div class="crumbs">${esc(current?.[3] || '')} ${icon('chevron-right', 'sm')} <b>${esc(current?.[1] || '')}</b></div>
        <span class="spacer"></span>
        <button class="icon-btn" id="themeBtn" title="${THEME_LABEL[getTheme()]}" aria-label="Tema değiştir">${icon(themeIcon())}</button>
        <a class="icon-btn" href="#/notifications" title="Bildirimler" aria-label="Bildirimler">${icon('bell')}${counts.unread ? '<span class="dot"></span>' : ''}</a>
        <a href="#/security" title="Hesabım">${avatar(me?.name || '', 'sm')}</a>
      </header>
      <main id="main"></main>
    </div>
  </div>`;
  document.body.classList.remove('nav-open');
  $('#menuBtn').onclick = () => document.body.classList.toggle('nav-open');
  document.body.onclick = (e) => {
    if (document.body.classList.contains('nav-open') && !e.target.closest('#side') && !e.target.closest('#menuBtn')) document.body.classList.remove('nav-open');
  };
  $('#themeBtn').onclick = (e) => {
    const t = cycleTheme();
    e.currentTarget.innerHTML = icon(themeIcon());
    e.currentTarget.title = THEME_LABEL[t];
    toast(THEME_LABEL[t]);
  };
  $('#logout').onclick = async () => {
    await POST('/auth/logout');
    location.hash = '';
    renderLogin();
  };
  return $('#main');
}

async function route() {
  clearInterval(pollTimer);
  const [, page = 'dashboard', id] = location.hash.replace(/^#/, '').split('/');
  if (page === 'reset') return renderReset(id);
  const allowed = visibleNav().some(([k]) => k === page);
  const key = VIEWS[page] && allowed ? page : 'dashboard';
  const main = await shell(key);
  try {
    await VIEWS[key](main, id);
  } catch (err) {
    main.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function barChart(el, rows, currency) {
  const W = 720; const H = 240; const pad = { l: 56, r: 8, t: 10, b: 26 };
  const raw = Math.max(0, ...rows.flatMap((r) => [r.revenue, r.expenses]));
  if (!raw) { el.innerHTML = empty('Henüz veri yok', 'Ödemeler ve giderler oluştukça grafik burada görünecek.', 'trending-up'); return; }
  // Round the axis up to a "nice" number so tick labels stay distinct.
  const mag = 10 ** Math.floor(Math.log10(raw));
  const max = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw);
  const step = (W - pad.l - pad.r) / rows.length;
  const bw = Math.max(3, Math.min(18, step / 2 - 4));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  // Bars: flat at the baseline, 4px rounded data end.
  const bar = (x, v, color) => {
    const top = y(v); const h = Math.max(0, H - pad.b - top);
    if (h <= 0) return '';
    const r = Math.min(4, h, bw / 2);
    return `<path fill="${color}" d="M${x},${H - pad.b} V${top + r} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} V${H - pad.b} Z"/>`;
  };
  el.innerHTML = `<div class="legend"><span><i style="background:var(--series-1)"></i>Ciro</span><span><i style="background:var(--series-2)"></i>Gider</span></div>
  <div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Son 12 ay ciro ve gider">
    ${ticks.map((t) => `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-label" x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${Math.round(t).toLocaleString('tr-TR')}</text>`).join('')}
    ${rows.map((r, i) => {
      const cx = pad.l + step * i + step / 2;
      return `<g data-i="${i}">
        <rect x="${pad.l + step * i}" y="${pad.t}" width="${step}" height="${H - pad.t - pad.b}" fill="transparent"/>
        ${bar(cx - bw - 1, r.revenue, 'var(--series-1)')}${bar(cx + 1, r.expenses, 'var(--series-2)')}
        <text class="axis-label" x="${cx}" y="${H - 8}" text-anchor="middle">${r.month.slice(5)}/${r.month.slice(2, 4)}</text></g>`;
    }).join('')}
  </svg><div class="tooltip" hidden></div></div>
  <details><summary class="muted">Tablo görünümü</summary><div class="table-wrap"><table><tr><th>Ay</th><th class="num">Ciro</th><th class="num">Gider</th><th class="num">Kâr</th></tr>
  ${rows.map((r) => `<tr><td>${r.month}</td><td class="num">${money(r.revenue, currency)}</td><td class="num">${money(r.expenses, currency)}</td><td class="num">${money(r.profit, currency)}</td></tr>`).join('')}</table></div></details>`;
  const tip = $('.tooltip', el);
  const chart = $('.chart', el);
  $$('g[data-i]', el).forEach((g) => {
    g.addEventListener('mousemove', (e) => {
      const r = rows[g.dataset.i];
      tip.hidden = false;
      tip.innerHTML = `<b>${r.month}</b><br>Ciro: ${money(r.revenue, currency)}<br>Gider: ${money(r.expenses, currency)}<br>Kâr: ${money(r.profit, currency)}`;
      const box = chart.getBoundingClientRect();
      tip.style.left = `${Math.min(e.clientX - box.left + 12, box.width - 170)}px`;
      tip.style.top = `${e.clientY - box.top - 10}px`;
    });
    g.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
}

async function viewDashboard(main) {
  const month = sessionStorage.getItem('month') || new Date().toISOString().slice(0, 7);
  const d = await GET(`/dashboard?month=${month}`);
  const s = d.stats; const c = s.currency;
  const tile = (label, value, sub = '', ic = 'sparkles', tone = '', hero = false) => `<div class="tile ${hero ? 'hero' : ''}">
    <div class="head"><span class="tile-icon ${tone}">${icon(ic)}</span><span class="label">${label}</span></div>
    <div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  main.innerHTML = `<div class="row"><div><h1>Merhaba, ${esc((me?.name || '').split(' ')[0])}</h1><div class="muted">${esc(monthName)} özeti</div></div><span class="spacer"></span>
    <input type="month" id="month" value="${month}" style="width:auto" aria-label="Ay seç">
    <a class="btn" href="/api/reports/monthly.pdf?month=${month}">${icon('download')} PDF özet</a>
    <a class="btn primary" href="/api/reports/monthly.pdf?month=${month}&analysis=1">${icon('sparkles')} PDF + yapay zeka yorumu</a></div>
  <div class="grid">
    ${tile('Net ciro', money(s.revenue, c), `Brüt ${money(s.gross_revenue, c)} · İade ${money(s.refunded, c)}`, 'banknote', '', true)}
    ${tile('Kâr', money(s.profit, c), `Gider ${money(s.expenses, c)}`, s.profit >= 0 ? 'trending-up' : 'trending-down', s.profit >= 0 ? 'good' : 'bad')}
    ${tile('Toplam gider', money(s.expenses, c), `Yapay zeka ${money(s.expenses_by_category.ai, c)} · ${Number(d.ai_tokens_this_month).toLocaleString('tr-TR')} token`, 'receipt', 'warn')}
    ${tile('Alınan iş', s.projects_won, `Dönüşüm %${s.conversion_rate}`, 'briefcase', 'info')}
    ${tile('Yeni müşteri', s.new_customers, `${s.conversations} konuşma`, 'user-plus', 'good')}
    ${tile('Ortalama sipariş', money(s.average_order, c), `${s.payments_count} ödeme`, 'coins')}
    ${tile('Taranan ilan', s.leads, `${s.leads_contacted} ilan sahibine ulaşıldı`, 'target', 'info')}
    ${tile('Admine aktarılan', s.escalations, `${d.open_escalations} şu an bekliyor`, 'circle-alert', d.open_escalations ? 'bad' : '')}
  </div>
  ${d.open_escalations || d.projects_waiting_review || d.unread_notifications ? `<div class="attention">
    ${d.open_escalations ? `<a href="#/conversations" class="attn bad">${icon('circle-alert')}<span><b>${d.open_escalations} konuşma</b> sizi bekliyor</span>${icon('chevron-right', 'sm')}</a>` : ''}
    ${d.projects_waiting_review ? `<a href="#/projects" class="attn warn">${icon('eye')}<span><b>${d.projects_waiting_review} proje</b> kontrol bekliyor</span>${icon('chevron-right', 'sm')}</a>` : ''}
    ${d.unread_notifications ? `<a href="#/notifications" class="attn info">${icon('bell')}<span><b>${d.unread_notifications} bildirim</b> okunmadı</span>${icon('chevron-right', 'sm')}</a>` : ''}
  </div>` : ''}
  <div class="card"><div class="row"><h2>Son 12 ay: ciro ve gider</h2></div><div id="chart"></div></div>
  <div class="card"><div class="row"><h2>${icon('sparkles')} Yapay zeka durum değerlendirmesi</h2><span class="spacer"></span><button class="primary" id="analyze">${icon('sparkles')} Analiz et</button></div>
    <div id="analysis" class="ai-box markdown muted">Satış, gider ve ürün performansınızı yorumlatıp somut çözüm önerileri almak için "Analiz et"e basın.</div></div>
  <div class="card table-wrap"><h2>Ürün performansı <span class="muted" style="font-weight:400">· son 90 gün</span></h2><table><tr><th>Ürün</th><th class="num">Fiyat</th><th class="num">Önerilme</th><th class="num">Satış</th></tr>
    ${d.products.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td class="num">${money(p.price, p.currency)}</td><td class="num">${p.recommended}</td><td class="num">${p.sold}</td></tr>`).join('') || `<tr><td colspan="4">${empty('Henüz ürün yok', 'Ürün & fiyatlar sayfasından ekleyin.', 'package')}</td></tr>`}
  </table></div>`;
  barChart($('#chart'), d.trend, c);
  $('#month').onchange = (e) => { sessionStorage.setItem('month', e.target.value); route(); };
  $('#analyze').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    $('#analysis').innerHTML = '<span class="spinner"></span> Analiz ediliyor...';
    const r = await act(() => POST('/dashboard/analysis', { month }));
    $('#analysis').textContent = r ? r.analysis : 'Analiz alınamadı.';
    $('#analysis').classList.remove('muted');
    btn.disabled = false;
  };
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

let shortcutCache = null;
async function shortcuts() {
  shortcutCache ??= (await fetch('/api/chat/info').then((r) => r.json())).shortcuts;
  return shortcutCache;
}

async function viewConversations(main, id) {
  const filter = sessionStorage.getItem('convFilter') || '';
  const list = await GET(`/conversations${filter ? `?status=${filter}` : ''}`);
  const timeAgo = (t) => {
    const d = new Date(`${t.replace(' ', 'T')}Z`);
    const mins = Math.round((Date.now() - d) / 60000);
    if (mins < 1) return 'şimdi';
    if (mins < 60) return `${mins} dk`;
    if (mins < 1440) return `${Math.round(mins / 60)} sa`;
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  };
  main.innerHTML = `<div class="row"><div><h1>Konuşmalar</h1><div class="muted">WhatsApp, web ve e-posta sohbetleri</div></div><span class="spacer"></span>
    <select id="filter" style="width:auto"><option value="">Tüm konuşmalar</option><option value="escalated">Admin bekleyenler</option><option value="open">Açık</option><option value="closed">Kapalı</option></select></div>
    <div class="chat-layout"><div class="card conv-list">${list.map((c) => `
      <div class="conv-item ${String(c.id) === id ? 'active' : ''}" data-id="${c.id}">
        ${avatar(c.customer_name || '#')}
        <div class="body"><div class="top"><b>${esc(c.customer_name || '#' + c.id)}</b><span class="muted" style="font-size:11.5px">${timeAgo(c.last_message_at)}</span></div>
          <div class="last">${esc(c.last_message || '')}</div>
          <div class="tags">${pill(c.channel)} ${pill(c.mode)} ${c.status === 'escalated' ? pill('escalated') : ''}</div></div>
      </div>`).join('') || empty('Henüz konuşma yok', 'Müşteriler yazdığında burada görünecek.', 'message-circle')}</div>
    <div id="detail" class="card">${id ? '' : empty('Bir konuşma seçin', 'Soldaki listeden bir sohbet açın.', 'message-square-text')}</div></div>`;
  $('#filter').value = filter;
  $('#filter').onchange = (e) => { sessionStorage.setItem('convFilter', e.target.value); route(); };
  $$('.conv-item').forEach((el) => { el.onclick = () => { location.hash = `#/conversations/${el.dataset.id}`; }; });
  if (!id) return;

  const detail = $('#detail');
  const sc = await shortcuts();
  let lastCount = -1;
  const draw = async () => {
    const d = await GET(`/conversations/${id}`);
    if (d.messages.length === lastCount) return;
    const keepDraft = $('#reply')?.value || '';
    lastCount = d.messages.length;
    const c = d.conversation;
    const who = { customer: d.customer?.name || 'Müşteri', ai: 'Yapay zeka', admin: 'Siz', system: '' };
    detail.innerHTML = `<div class="chat-head">${avatar(d.customer?.name || '#')}
        <div><h2>${esc(d.customer?.name || 'Müşteri')}</h2><div class="muted" style="font-size:12.5px">${esc([d.customer?.phone, d.customer?.email].filter(Boolean).join(' · ') || 'İletişim bilgisi yok')}</div></div>
        ${pill(c.channel)} ${pill(c.mode)} ${pill(c.status)}<span class="spacer"></span>
        ${c.mode === 'ai' ? `<button id="takeover" class="primary">${icon('user-cog')} Konuşmayı devral</button>` : `<button id="release">${icon('bot')} Yapay zekaya devret</button>`}
        <button id="close" class="icon-btn" title="Konuşmayı kapat" aria-label="Konuşmayı kapat">${icon('x')}</button></div>
      ${c.escalation_reason || d.project || c.channel === 'platform' ? `<div class="chat-meta">
        ${c.escalation_reason ? `${icon('circle-alert', 'sm')} Aktarım sebebi: ${esc(c.escalation_reason)} ` : ''}
        ${d.project ? ` ${icon('folder-kanban', 'sm')} Proje: <a href="#/projects/${d.project.id}">${esc(d.project.title)}</a> ${pill(d.project.status)}` : ''}
        ${c.channel === 'platform' ? ' Bu konuşma bir freelancer platformunda; mesajları platform üzerinden iletmeniz gerekir.' : ''}</div>` : ''}
      <div class="messages" id="msgs">${d.messages.map((m) => `<div class="msg ${m.sender}"><div class="who">${esc(who[m.sender])} · ${date(m.created_at)}</div>${esc(m.body)}</div>`).join('')}</div>
      <div class="composer">
        <div class="shortcuts"><span class="group">Temalar</span>${sc.themes.map((t) => `<button class="chip" data-text="Tema önerisi: ${esc(t.name)}${t.preview_url ? ` (${esc(t.preview_url)})` : ''}">${esc(t.name)}</button>`).join('')}</div>
        <div class="shortcuts"><span class="group">Diller</span>${sc.languages.map((l) => `<button class="chip" data-text="Teknoloji: ${esc(l.name)}">${esc(l.name)}</button>`).join('')}</div>
        <div class="shortcuts"><span class="group">Örnekler</span>${sc.products.map((p) => `<button class="chip" data-text="${esc(p.name)}${p.demo_url ? ` örneği: ${esc(p.demo_url)}` : ''}">${esc(p.name)}</button>`).join('')}</div>
        <form id="send"><textarea id="reply" placeholder="${c.mode === 'ai' ? 'Mesaj yazarsanız konuşmayı devralırsınız…' : 'Müşteriye yazın…'}"></textarea><button class="primary">${icon('send')} Gönder</button></form>
      </div>`;
    $('#reply').value = keepDraft;
    const msgs = $('#msgs'); msgs.scrollTop = msgs.scrollHeight;
    $$('.chip', detail).forEach((b) => { b.onclick = () => { const r = $('#reply'); r.value = `${r.value}${r.value ? '\n' : ''}${b.dataset.text}`; r.focus(); }; });
    $('#takeover')?.addEventListener('click', () => act(() => POST(`/conversations/${id}/takeover`)).then(() => { lastCount = -1; draw(); }));
    $('#release')?.addEventListener('click', () => act(() => POST(`/conversations/${id}/release`)).then(() => { lastCount = -1; draw(); }));
    $('#close').onclick = () => act(() => POST(`/conversations/${id}/close`), 'Kapatıldı').then(route);
    $('#send').onsubmit = async (e) => {
      e.preventDefault();
      const text = $('#reply').value.trim();
      if (!text) return;
      if (await act(() => POST(`/conversations/${id}/messages`, { text }))) { $('#reply').value = ''; lastCount = -1; draw(); }
    };
  };
  await draw();
  pollTimer = setInterval(() => draw().catch(() => {}), 4000);
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

async function viewLeads(main) {
  const filter = sessionStorage.getItem('leadFilter') || '';
  const leads = await GET(`/leads${filter ? `?status=${filter}` : ''}`);
  main.innerHTML = `<div class="row"><h1>İş ilanları</h1><span class="spacer"></span>
    <select id="filter" style="width:auto"><option value="">Tümü</option><option value="needs_admin">Admin ilgilenmeli</option><option value="contacted">İletişime geçildi</option><option value="filtered_out">Kapsam dışı</option><option value="won">Kazanıldı</option></select>
    <a class="btn" href="#/settings">${icon('filter')} Tarama kapsamı</a><button class="primary" id="scan">${icon('refresh-cw')} Şimdi tara</button></div>
    <div class="card table-wrap"><table><tr><th>İlan</th><th>Platform</th><th class="num">Bütçe</th><th>Durum</th><th></th></tr>
    ${leads.map((l) => `<tr><td><b>${esc(l.title)}</b><div class="muted">${esc(l.description.slice(0, 220))}</div>
        ${l.filter_reason ? `<div class="muted">Sebep: ${esc(l.filter_reason)}</div>` : ''}${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">İlana git</a>` : ''}</td>
      <td><span class="pill info">${esc(l.platform)}</span></td><td class="num" style="white-space:nowrap">${l.budget_min != null ? money(l.budget_min) : '?'} – ${l.budget_max != null ? money(l.budget_max) : '?'} ${esc(l.currency || '')}</td><td>${pill(l.status)}</td>
      <td><div class="row actions">${l.conversation_id ? `<a class="btn" href="#/conversations/${l.conversation_id}">${icon('message-circle', 'sm')} Konuşma</a>` : ''}
        ${l.status !== 'won' ? `<button data-project="${l.id}">${icon('check', 'sm')} İşi aldım</button><button class="icon-btn" title="Kaybedildi olarak işaretle" aria-label="Kaybedildi" data-lost="${l.id}">${icon('x', 'sm')}</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="5" class="muted">İlan yok. "Şimdi tara" ile platformları tarayın.</td></tr>'}
    </table></div>`;
  $('#filter').value = filter;
  $('#filter').onchange = (e) => { sessionStorage.setItem('leadFilter', e.target.value); route(); };
  $('#scan').onclick = async (e) => {
    e.target.disabled = true;
    const r = await act(() => POST('/leads/scan'));
    if (r) toast(`${r.fetched} ilan: ${r.contacted} iletişim, ${r.needs_admin} admine, ${r.filtered} kapsam dışı, ${r.duplicate} tekrar${r.errors?.length ? ` · Hatalar: ${r.errors.join('; ')}` : ''}`);
    route();
  };
  $$('[data-project]').forEach((b) => { b.onclick = async () => {
    const price = prompt('Anlaşılan fiyat:');
    if (price === null) return;
    const r = await act(() => POST(`/leads/${b.dataset.project}/project`, { price }), 'Proje oluşturuldu, yapay zeka geliştirmeye başlıyor');
    if (r) location.hash = `#/projects/${r.id}`;
  }; });
  $$('[data-lost]').forEach((b) => { b.onclick = () => act(() => PUT(`/leads/${b.dataset.lost}`, { status: 'lost' })).then(route); });
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

async function viewProjects(main, id) {
  if (id) return viewProject(main, id);
  const [list, customers, catalog] = await Promise.all([GET('/projects'), GET('/customers'), fetch('/api/chat/info').then((r) => r.json())]);
  main.innerHTML = `<div class="row"><h1>Projeler</h1><span class="spacer"></span><button id="new" class="primary">${icon('plus')} Yeni proje</button></div>
    <div class="card" id="newForm" hidden><h2>Yeni proje</h2><form id="pf"><div class="form-grid">
      <label>Başlık<input name="title" required></label>
      <label>Müşteri<select name="customer_id" required>${customers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <label>Tema<select name="theme_id"><option value="">-</option>${catalog.shortcuts.themes.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
      <label>Dil / teknoloji<select name="language_id"><option value="">-</option>${catalog.shortcuts.languages.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>
      <label>Fiyat<input name="price" type="number" step="0.01"></label><label>Para birimi<input name="currency" value="TRY"></label></div>
      <label>Gereksinimler<textarea name="requirements"></textarea></label><button class="primary">Oluştur ve geliştirmeye başla</button></form></div>
    <div class="card table-wrap"><table><tr><th>Proje</th><th>Müşteri</th><th>Durum</th><th class="num">Fiyat</th><th class="num">Sürüm</th><th>Güncelleme</th></tr>
    ${list.map((p) => `<tr class="clickable" data-id="${p.id}"><td>${esc(p.title)}</td><td>${esc(p.customer_name || '-')}</td><td>${pill(p.status)}</td>
      <td class="num">${money(p.price, p.currency)}</td><td class="num">v${p.current_version}</td><td>${date(p.updated_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Proje yok</td></tr>'}</table></div>`;
  $('#new').onclick = () => { $('#newForm').hidden = !$('#newForm').hidden; };
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const r = await act(() => POST('/projects', fd), 'Proje oluşturuldu');
    if (r) location.hash = `#/projects/${r.id}`;
  };
  $$('tr[data-id]').forEach((tr) => { tr.onclick = () => { location.hash = `#/projects/${tr.dataset.id}`; }; });
}

async function viewProject(main, id) {
  const d = await GET(`/projects/${id}`);
  const p = d.project;
  const can = (...s) => s.includes(p.status);
  // Pipeline: which step each status belongs to.
  const STEPS = [
    ['İş alındı', 'briefcase', ['won']],
    ['Geliştirme', 'cpu', ['building', 'build_failed', 'revision']],
    ['Admin kontrolü', 'eye', ['review', 'approved']],
    ['Demo', 'rocket', ['demo_live', 'changes_requested']],
    ['Müşteri onayı', 'circle-check', ['customer_approved']],
    ['Ödeme', 'credit-card', ['awaiting_payment', 'paid']],
    ['Teslim', 'package', ['delivered']],
  ];
  const at = STEPS.findIndex(([, , st]) => st.includes(p.status));
  const stepper = p.status === 'cancelled' ? '' : `<div class="card stepper">${STEPS.map(([l, ic], i) => `
    <div class="step ${i < at || p.status === 'delivered' ? 'done' : i === at ? (p.status === 'build_failed' ? 'fail' : 'now') : ''}">
      <span class="dot">${icon(i < at || p.status === 'delivered' ? 'check' : ic, 'sm')}</span><span class="name">${l}</span></div>`).join('')}</div>`;
  main.innerHTML = `<div class="row"><div><h1>${esc(p.title)}</h1><div class="row" style="margin-top:6px">${pill(p.status)}${d.building ? ' <span class="pill info"><span class="spinner" style="width:10px;height:10px"></span> Yapay zeka çalışıyor</span>' : ''}<span class="muted">v${p.current_version}</span></div></div><span class="spacer"></span><a class="btn" href="#/projects">${icon('arrow-left')} Projeler</a></div>
  ${stepper}
  <div class="grid">
    <div class="tile"><div class="label">Müşteri</div><div class="value" style="font-size:16px">${esc(p.customer_name || '-')}</div>${p.conversation_id ? `<a href="#/conversations/${p.conversation_id}">Konuşmaya git</a>` : ''}</div>
    <div class="tile"><div class="label">Fiyat</div><div class="value">${money(p.price, p.currency)}</div></div>
    <div class="tile"><div class="label">Tema / Teknoloji</div><div class="value" style="font-size:16px">${esc(p.theme_name || '-')} / ${esc(p.language_name || '-')}</div></div>
    <div class="tile"><div class="label">Demo</div><div class="value" style="font-size:14px">${p.demo_url ? `<a href="${esc(p.demo_url)}" target="_blank" rel="noopener">${esc(p.demo_url)}</a>` : '-'}</div></div>
  </div>
  <div class="card"><h2>İşlemler</h2><div class="row">
    <button id="approve" ${can('review') ? '' : 'disabled'}>${icon('check')} Sürümü onayla</button>
    <button id="deploy" class="primary" ${can('approved', 'demo_live', 'changes_requested') && p.current_version ? '' : 'disabled'}>${icon('rocket')} Demoyu yayınla ve müşteriye gönder</button>
    <button id="custok" ${can('demo_live') ? '' : 'disabled'}>Müşteri onayladı (manuel)</button>
    <button id="payreq" ${can('customer_approved', 'demo_live', 'approved') ? '' : 'disabled'}>${icon('credit-card')} Ödeme talebi gönder</button>
    <button id="deliver" ${can('paid') ? '' : 'disabled'}>${icon('package')} Teslim et</button>
    <button id="rebuild" ${d.building ? 'disabled' : ''}>${icon('refresh-cw')} Yeniden üret</button>
    <button id="cancel" class="danger">${icon('x')} İptal et</button></div>
    <h3>Düzeltme iste (yapay zeka yeni sürüm üretir)</h3>
    <form id="fb"><textarea name="feedback" placeholder="Örn: Ana sayfadaki başlığı büyüt, iletişim formuna telefon alanı ekle..."></textarea>
    <button class="primary" ${d.building ? 'disabled' : ''}>${icon('sparkles')} Düzeltmeyi yapay zekaya gönder</button></form></div>
  <div class="card"><h2>Gereksinimler</h2><form id="req"><textarea name="requirements" style="min-height:120px">${esc(p.requirements)}</textarea><button>Kaydet</button></form></div>
  <div class="card"><h2>Sürümler</h2><div class="table-wrap"><table><tr><th>Sürüm</th><th>Özet</th><th>Düzeltme notu</th><th>Tarih</th><th></th></tr>
    ${d.versions.map((v) => `<tr><td>v${v.version}</td><td>${esc(v.summary)}</td><td>${esc(v.feedback || '-')}</td><td>${date(v.created_at)}</td><td><a class="btn" target="_blank" rel="noopener" href="${esc(v.preview_url)}">${icon('eye')} Önizle</a></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Henüz sürüm yok</td></tr>'}</table></div>
    ${d.files.length ? `<h3>Dosyalar (v${p.current_version})</h3>${d.files.map((f) => `<a href="/api/projects/${p.id}/files/${f.path.split('/').map(encodeURIComponent).join('/')}" target="_blank">${esc(f.path)}</a> <span class="muted">${f.size} b</span>`).join('<br>')}` : ''}</div>
  <div class="card"><h2>Ödemeler</h2>${d.payments.map((pay) => `<div>${pay.reference} · ${money(pay.amount, pay.currency)} ${pill(pay.status)}</div>`).join('') || '<span class="muted">Yok</span>'}</div>
  <div class="card"><h2>Geçmiş</h2><ul class="timeline">${d.events.map((e) => `<li><span class="muted">${date(e.created_at)}</span> ${esc(e.message)}</li>`).join('')}</ul></div>`;
  const reload = () => route();
  const bind = (sel, fn, msg) => { const el = $(sel); if (el) el.onclick = () => act(fn, msg).then(reload); };
  bind('#approve', () => POST(`/projects/${id}/approve`), 'Onaylandı');
  bind('#deploy', () => POST(`/projects/${id}/deploy`), 'Demo yayınlandı ve müşteriye gönderildi');
  bind('#custok', () => POST(`/projects/${id}/customer-approved`), 'Müşteri onayı kaydedildi');
  bind('#payreq', () => POST(`/projects/${id}/payment-request`), 'Ödeme bilgileri gönderildi');
  bind('#deliver', () => POST(`/projects/${id}/deliver`), 'Teslim edildi');
  bind('#rebuild', () => POST(`/projects/${id}/rebuild`), 'Yeniden üretim başladı');
  $('#cancel').onclick = () => confirm('Proje iptal edilsin mi?') && act(() => POST(`/projects/${id}/cancel`)).then(reload);
  $('#fb').onsubmit = (e) => { e.preventDefault(); act(() => POST(`/projects/${id}/feedback`, Object.fromEntries(new FormData(e.target))), 'Düzeltme gönderildi').then(reload); };
  $('#req').onsubmit = (e) => { e.preventDefault(); act(() => PUT(`/projects/${id}`, Object.fromEntries(new FormData(e.target))), 'Kaydedildi'); };
  if (d.building) pollTimer = setInterval(async () => { const x = await GET(`/projects/${id}`).catch(() => null); if (x && !x.building) route(); }, 3000);
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

async function viewCustomers(main) {
  const list = await GET('/customers');
  main.innerHTML = `<div class="row"><h1>Müşteriler</h1><span class="spacer"></span>${isAdmin() ? `<a class="btn" href="/api/export/customers.csv">${icon('download')} CSV indir</a>` : ''}</div><div class="card table-wrap"><table><tr><th>Ad</th><th>Telefon</th><th>E-posta</th><th>Kaynak</th><th class="num">Proje</th><th class="num">Ödenen</th><th>Kayıt</th></tr>
    ${list.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone || '-')}</td><td>${esc(c.email || '-')}</td><td>${esc(c.platform || '-')}</td><td class="num">${c.project_count}</td><td class="num">${money(c.total_paid)}</td><td>${date(c.created_at)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Müşteri yok</td></tr>'}</table></div>`;
}

// ---------------------------------------------------------------------------
// Catalog: products (price table), themes, languages
// ---------------------------------------------------------------------------

const CATALOG = {
  products: { title: 'Ürünler / fiyat tablosu', fields: [['name', 'Ad'], ['category', 'Kategori'], ['price', 'Fiyat', 'number'], ['currency', 'Para birimi'], ['demo_url', 'Örnek/demo bağlantısı'], ['image_url', 'Görsel URL'], ['description', 'Açıklama', 'textarea'], ['features', 'Özellikler', 'textarea']] },
  themes: { title: 'Site temaları', fields: [['name', 'Ad'], ['preview_url', 'Önizleme URL'], ['description', 'Açıklama', 'textarea'], ['style_guide', 'Stil rehberi (renkler, fontlar, düzen)', 'textarea']] },
  languages: { title: 'Programlama dilleri / teknolojiler', fields: [['name', 'Ad'], ['description', 'Açıklama', 'textarea']] },
};

async function viewCatalog(main) {
  const tab = sessionStorage.getItem('catTab') || 'products';
  const cfg = CATALOG[tab];
  const rows = (await GET(`/${tab}`)).filter((r) => r.active);
  const TAB_ICON = { products: 'package', themes: 'sparkles', languages: 'cpu' };
  main.innerHTML = `<h1>Ürün & fiyatlar</h1><div class="tabs">${Object.entries(CATALOG).map(([k, v]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${icon(TAB_ICON[k], 'sm')} ${v.title}</button>`).join('')}</div>
    <p class="muted">Yapay zeka satış yaparken bu listeleri kullanır; temalar ve diller sohbet ekranında kısayol olarak görünür.</p>
    <div class="card"><h2 id="formTitle">Yeni ekle</h2><form id="cf"><input type="hidden" name="id"><div class="form-grid">
      ${cfg.fields.filter((f) => f[2] !== 'textarea').map(([k, l, t]) => `<label>${l}<input name="${k}" ${t ? `type="${t}" step="0.01"` : ''} ${k === 'name' ? 'required' : ''}></label>`).join('')}</div>
      ${cfg.fields.filter((f) => f[2] === 'textarea').map(([k, l]) => `<label>${l}<textarea name="${k}"></textarea></label>`).join('')}
      <div class="row"><button class="primary">Kaydet</button><button type="reset" id="resetBtn">Temizle</button></div></form></div>
    <div class="card table-wrap"><table><tr>${cfg.fields.slice(0, 4).map((f) => `<th>${f[1]}</th>`).join('')}<th></th></tr>
    ${rows.map((r) => `<tr>${cfg.fields.slice(0, 4).map(([k], i) => `<td${k === 'price' ? ' class="num"' : ''}>${k === 'price' ? `<b>${money(r[k])}</b>` : i === 0 ? `<b>${esc(r[k])}</b>` : esc(r[k])}</td>`).join('')}<td><div class="row actions"><button data-edit="${r.id}">${icon('pencil', 'sm')} Düzenle</button><button class="danger icon-btn" title="Sil" aria-label="Sil" data-del="${r.id}">${icon('trash-2', 'sm')}</button></div></td></tr>`).join('') || `<tr><td colspan="5">${empty('Kayıt yok', 'Yukarıdaki formdan ekleyin.', TAB_ICON[tab])}</td></tr>`}</table></div>`;
  $$('[data-tab]').forEach((b) => { b.onclick = () => { sessionStorage.setItem('catTab', b.dataset.tab); route(); }; });
  const form = $('#cf');
  $('#resetBtn').onclick = () => { form.elements.id.value = ''; $('#formTitle').textContent = 'Yeni ekle'; };
  $$('[data-edit]').forEach((b) => { b.onclick = () => {
    const r = rows.find((x) => String(x.id) === b.dataset.edit);
    for (const [k] of cfg.fields) form.elements[k].value = r[k] ?? '';
    form.elements.id.value = r.id;
    $('#formTitle').textContent = 'Düzenle';
    form.scrollIntoView({ behavior: 'smooth' });
  }; });
  $$('[data-del]').forEach((b) => { b.onclick = () => confirm('Silinsin mi?') && act(() => DEL(`/${tab}/${b.dataset.del}`), 'Silindi').then(() => { shortcutCache = null; route(); }); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const rid = data.id; delete data.id;
    if (data.price !== undefined) data.price = Number(data.price || 0);
    if (await act(() => (rid ? PUT(`/${tab}/${rid}`, data) : POST(`/${tab}`, data)), 'Kaydedildi')) { shortcutCache = null; route(); }
  };
}

// ---------------------------------------------------------------------------
// Payments, invoices, expenses
// ---------------------------------------------------------------------------

async function viewPayments(main) {
  const [payments, invoices] = await Promise.all([GET('/payments'), GET('/invoices')]);
  const csv = (t, l) => (isAdmin() ? `<a class="btn" href="/api/export/${t}.csv">${icon('download')} ${l}</a>` : '');
  main.innerHTML = `<div class="row"><h1>Ödemeler & faturalar</h1><span class="spacer"></span>${csv('payments', 'Ödemeler CSV')}${csv('invoices', 'Faturalar CSV')}</div>
  <div class="card table-wrap"><h2>Ödeme geçmişi</h2><table><tr><th>Referans</th><th>Müşteri / proje</th><th>Yöntem</th><th class="num">Tutar</th><th class="num">İade</th><th>Durum</th><th>Oluşturma</th><th>Ödeme</th><th></th></tr>
  ${payments.map((p) => `<tr><td>${esc(p.reference)}</td><td>${esc(p.customer_name || '-')}<div class="muted">${esc(p.project_title || '')}</div></td><td>${p.method === 'iban' ? 'Havale/EFT' : 'Kart (Stripe)'}</td>
    <td class="num">${money(p.amount, p.currency)}</td><td class="num">${p.refunded_amount ? money(p.refunded_amount, p.currency) : '-'}</td><td>${pill(p.status)}</td><td>${date(p.created_at)}</td><td>${date(p.paid_at)}</td>
    <td><div class="row">${p.status === 'pending' ? `<button data-paid="${p.id}">Ödendi işaretle</button><button data-cancel="${p.id}">İptal</button>` : ''}
      ${['paid', 'partially_refunded'].includes(p.status) ? `<button class="danger" data-refund="${p.id}" data-max="${p.amount - p.refunded_amount}">İade</button>` : ''}
      ${p.checkout_url ? `<a class="btn" href="${esc(p.checkout_url)}" target="_blank" rel="noopener">Ödeme linki</a>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="9" class="muted">Ödeme yok</td></tr>'}</table></div>
  <div class="card table-wrap"><h2>Faturalar</h2><table><tr><th>No</th><th>Tür</th><th>Müşteri</th><th>Proje</th><th class="num">Ara toplam</th><th class="num">KDV</th><th class="num">Toplam</th><th>Tarih</th><th></th></tr>
  ${invoices.map((i) => `<tr><td>${esc(i.number)}</td><td>${i.kind === 'refund' ? 'İade' : 'Satış'}</td><td>${esc(i.customer_name || '-')}</td><td>${esc(i.project_title || '-')}</td>
    <td class="num">${money(i.subtotal, i.currency)}</td><td class="num">${money(i.tax_amount, i.currency)}</td><td class="num">${money(i.total, i.currency)}</td><td>${date(i.issued_at)}</td>
    <td><a class="btn" href="/api/invoices/${i.id}/pdf" target="_blank">${icon('file-text')} PDF</a></td></tr>`).join('') || '<tr><td colspan="9" class="muted">Fatura yok</td></tr>'}</table></div>`;
  $$('[data-paid]').forEach((b) => { b.onclick = () => confirm('Ödemenin hesaba geldiğini doğruladınız mı?') && act(() => POST(`/payments/${b.dataset.paid}/mark-paid`), 'Ödeme kaydedildi, fatura oluşturuldu').then(route); });
  $$('[data-cancel]').forEach((b) => { b.onclick = () => act(() => POST(`/payments/${b.dataset.cancel}/cancel`)).then(route); });
  $$('[data-refund]').forEach((b) => { b.onclick = () => {
    const amount = prompt(`İade tutarı (en fazla ${b.dataset.max}):`, b.dataset.max);
    if (amount === null) return;
    const reason = prompt('İade sebebi:') || '';
    act(() => POST(`/payments/${b.dataset.refund}/refund`, { amount: Number(amount), reason }), 'İade yapıldı').then(route);
  }; });
}

async function viewExpenses(main) {
  const [expenses, usage] = await Promise.all([GET('/expenses'), GET('/ai-usage')]);
  main.innerHTML = `<div class="row"><h1>Giderler</h1><span class="spacer"></span>${isAdmin() ? `<a class="btn" href="/api/export/expenses.csv">${icon('download')} CSV indir</a>` : ''}</div>
  <div class="card"><h2>Gider ekle</h2><form id="ef" class="form-grid">
    <label>Kategori<select name="category"><option value="hosting">Sunucu/hosting</option><option value="ads">Reklam</option><option value="software">Yazılım/abonelik</option><option value="ai">Yapay zeka (ek)</option><option value="other">Diğer</option></select></label>
    <label>Tutar<input name="amount" type="number" step="0.01" required></label><label>Para birimi<input name="currency" value="TRY"></label>
    <label>Açıklama<input name="description"></label><div><button class="primary">Ekle</button></div></form></div>
  <div class="card table-wrap"><h2>Gider listesi</h2><table><tr><th>Tarih</th><th>Kategori</th><th>Açıklama</th><th class="num">Tutar</th><th></th></tr>
    ${expenses.map((e) => `<tr><td>${date(e.created_at)}</td><td>${esc(e.category)}</td><td>${esc(e.description)}</td><td class="num">${money(e.amount, e.currency)}</td><td><button class="danger" data-del="${e.id}">Sil</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Gider yok</td></tr>'}</table></div>
  <div class="card table-wrap"><h2>Yapay zeka kullanımı (son 30 gün, otomatik gider)</h2><table><tr><th>Gün</th><th>Amaç</th><th class="num">Girdi token</th><th class="num">Çıktı token</th><th class="num">Maliyet (USD)</th></tr>
    ${usage.map((u) => `<tr><td>${u.day}</td><td>${esc(u.purpose)}</td><td class="num">${u.input_tokens.toLocaleString('tr-TR')}</td><td class="num">${u.output_tokens.toLocaleString('tr-TR')}</td><td class="num">${u.cost_usd}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Kullanım yok</td></tr>'}</table></div>`;
  $('#ef').onsubmit = (e) => { e.preventDefault(); act(() => POST('/expenses', Object.fromEntries(new FormData(e.target))), 'Eklendi').then(route); };
  $$('[data-del]').forEach((b) => { b.onclick = () => act(() => DEL(`/expenses/${b.dataset.del}`)).then(route); });
}

// ---------------------------------------------------------------------------
// Notifications, security, settings
// ---------------------------------------------------------------------------

const NOTIF_ICON = {
  escalation: ['circle-alert', 'bad'], customer_message: ['message-circle', 'info'], security: ['shield', 'bad'],
  project_won: ['briefcase', 'good'], build_ready: ['eye', 'warn'], build_progress: ['cpu', ''], build_failed: ['triangle-alert', 'bad'],
  customer_approved: ['circle-check', 'good'], changes_requested: ['pencil', 'warn'], payment_received: ['banknote', 'good'],
  payment_overdue: ['clock', 'warn'], refund: ['hand-coins', 'warn'], lead_needs_admin: ['target', 'info'], daily_digest: ['calendar', ''],
  monthly_report: ['file-text', ''], ai_budget: ['cpu', 'warn'], job_failed: ['triangle-alert', 'bad'],
};

async function viewNotifications(main) {
  const list = await GET('/notifications');
  main.innerHTML = `<div class="row"><div><h1>Bildirimler</h1><div class="muted">${list.filter((n) => !n.read).length} okunmamış</div></div><span class="spacer"></span><button id="all">${icon('check')} Tümünü okundu yap</button></div>
    <div class="card" style="padding:6px">${list.map((n) => {
      const [ic, tone] = NOTIF_ICON[n.type] || ['bell', ''];
      return `<div class="notif ${n.read ? 'read' : ''}" data-id="${n.id}" data-link="${esc(n.link || '')}">
        <span class="tile-icon ${tone}">${icon(ic)}</span>
        <div class="body"><div class="top"><b>${esc(n.subject)}</b><span class="muted">${date(n.created_at)}</span></div>
        <div class="text">${esc(n.body)}</div>${n.emailed ? `<span class="pill info">${icon('mail', 'sm')} e-posta gönderildi</span>` : ''}</div>
      </div>`;
    }).join('') || empty('Bildirim yok', 'Önemli bir şey olduğunda burada ve e-postanızda görünecek.', 'bell')}</div>`;
  $('#all').onclick = () => act(() => POST('/notifications/read-all')).then(route);
  $$('.notif').forEach((el) => { el.onclick = async () => {
    await POST(`/notifications/${el.dataset.id}/read`).catch(() => {});
    if (el.dataset.link) location.hash = `#${el.dataset.link}`; else route();
  }; });
}

async function viewSecurity(main) {
  const [account, sessions, events] = await Promise.all([
    GET('/me'), GET('/security/sessions'), isAdmin() ? GET(`/security/events${sessionStorage.getItem('suspOnly') ? '?suspicious=1' : ''}`) : Promise.resolve(null),
  ]);
  main.innerHTML = `<h1>Güvenlik</h1>
  <div class="card" id="twofa"><h2>İki adımlı doğrulama (2FA)</h2>
    ${account.totp_enabled
    ? `<p><span class="pill good">Açık</span> Girişte şifrenizden sonra doğrulama uygulamanızdaki kod istenir.</p>
       <div class="row"><button id="newCodes">Yeni kurtarma kodları oluştur</button><button class="danger" id="disable2fa">2FA'yı kapat</button></div>`
    : `<p><span class="pill warn">Kapalı</span> Hesabınızı şifre çalınmasına karşı korumak için Google Authenticator, Microsoft Authenticator veya Authy gibi bir uygulamayla iki adımlı doğrulamayı açın.</p>
       <button class="primary" id="setup2fa">${icon('shield-check')} 2FA kurulumunu başlat</button>`}
    <div id="twofaBody"></div></div>
  <div class="card"><h2>Şifre değiştir</h2><form id="pw" class="form-grid">
    <label>Mevcut şifre<input type="password" name="current" required autocomplete="current-password"></label>
    <label>Yeni şifre<input type="password" name="next" required autocomplete="new-password"></label>
    <label>Yeni şifre (tekrar)<input type="password" name="next2" required autocomplete="new-password"></label>
    <div><button class="primary">Şifreyi değiştir</button></div></form><p class="muted">Şifre değişince diğer tüm oturumlarınız kapatılır.</p></div>
  <div class="card table-wrap"><div class="row"><h2>Oturumlarım</h2><span class="spacer"></span><button id="others">Diğer tüm oturumları kapat</button></div>
    <table><tr><th>IP</th><th>Tarayıcı</th><th>Açılış</th><th>Son görülme</th><th>Durum</th><th></th></tr>
    ${sessions.sessions.map((x) => `<tr><td>${esc(x.ip)}</td><td class="muted">${esc(x.user_agent)}</td><td>${date(x.created_at)}</td><td>${date(x.last_seen_at)}</td>
      <td>${x.id === sessions.current ? '<span class="pill good">Bu oturum</span>' : x.revoked_at ? '<span class="pill">Kapalı</span>' : new Date(x.expires_at) < new Date() ? '<span class="pill">Süresi doldu</span>' : '<span class="pill warn">Açık</span>'}</td>
      <td>${!x.revoked_at && x.id !== sessions.current && new Date(x.expires_at) > new Date() ? `<button class="danger" data-revoke="${x.id}">Sonlandır</button>` : ''}</td></tr>`).join('')}</table></div>
  ${events ? `<div class="card table-wrap"><div class="row"><h2>Giriş / çıkış kayıtları</h2><span class="spacer"></span>
      <label class="check" style="margin:0"><input type="checkbox" id="susp" ${sessionStorage.getItem('suspOnly') ? 'checked' : ''}>Sadece şüpheli olaylar</label>
      <a class="btn" href="/api/backup">${icon('download')} Veritabanı yedeği indir</a></div>
    <table><tr><th>Zaman</th><th>Olay</th><th>E-posta</th><th>IP</th><th>Tarayıcı</th><th>Not</th></tr>
    ${events.map((e) => `<tr><td>${date(e.created_at)}</td><td>${pill(e.event)} ${e.suspicious ? '<span class="pill bad">Şüpheli</span>' : ''}</td><td>${esc(e.email || '')}</td><td>${esc(e.ip || '')}</td><td class="muted">${esc((e.user_agent || '').slice(0, 60))}</td><td>${esc(e.detail || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Kayıt yok</td></tr>'}</table></div>` : ''}`;

  const body = $('#twofaBody');
  const showCodes = (codes) => {
    body.innerHTML = `<h3>Kurtarma kodlarınız</h3><p class="muted">Bu kodlar yalnızca şimdi gösterilir. Güvenli bir yere kaydedin; telefonunuza erişemezseniz her biri bir kez giriş için kullanılabilir.</p>
      <pre class="card" style="font-size:15px;letter-spacing:1px">${codes.map(esc).join('\n')}</pre><button id="done">Kaydettim</button>`;
    $('#done').onclick = route;
  };
  $('#setup2fa')?.addEventListener('click', async () => {
    const r = await act(() => POST('/security/2fa/setup'));
    if (!r) return;
    body.innerHTML = `<div class="row" style="align-items:flex-start;gap:24px;margin-top:12px"><img src="${r.qr}" alt="2FA QR kodu" width="200" height="200" style="background:#fff;padding:6px;border-radius:8px">
      <div style="flex:1;min-width:220px"><ol><li>Doğrulama uygulamasında QR kodu okutun.</li><li>QR okutamıyorsanız bu anahtarı elle girin:<br><code style="word-break:break-all">${esc(r.secret)}</code></li><li>Uygulamada görünen 6 haneli kodu girin.</li></ol>
      <form id="en" class="row"><input name="code" placeholder="123456" inputmode="numeric" autocomplete="one-time-code" style="max-width:160px" required><button class="primary">Etkinleştir</button></form></div></div>`;
    $('#en').onsubmit = async (e) => {
      e.preventDefault();
      const ok = await act(() => POST('/security/2fa/enable', { code: e.target.code.value }), 'İki adımlı doğrulama açıldı');
      if (ok) { me.totp_enabled = true; showCodes(ok.recovery_codes); }
    };
  });
  $('#newCodes')?.addEventListener('click', async () => {
    const code = prompt('Doğrulama uygulamanızdaki kodu girin:');
    if (!code) return;
    const r = await act(() => POST('/security/2fa/recovery-codes', { code }), 'Yeni kodlar oluşturuldu; eskiler geçersiz');
    if (r) showCodes(r.recovery_codes);
  });
  $('#disable2fa')?.addEventListener('click', () => {
    body.innerHTML = `<form id="dis" class="form-grid" style="margin-top:12px"><label>Şifreniz<input type="password" name="password" required autocomplete="current-password"></label>
      <label>Doğrulama kodu<input name="code" required inputmode="numeric" autocomplete="one-time-code"></label><div><button class="danger">2FA'yı kapat</button></div></form>`;
    $('#dis').onsubmit = (e) => {
      e.preventDefault();
      act(() => POST('/security/2fa/disable', Object.fromEntries(new FormData(e.target))), 'İki adımlı doğrulama kapatıldı').then((r) => r && route());
    };
  });
  $('#pw').onsubmit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (d.next !== d.next2) return toast('Yeni şifreler eşleşmiyor', true);
    act(() => POST('/security/password', d), 'Şifre değiştirildi').then((r) => r && route());
  };
  $('#others').onclick = () => act(() => POST('/security/sessions/revoke-others'), 'Diğer oturumlar kapatıldı').then(route);
  $('#susp')?.addEventListener('change', (e) => { e.target.checked ? sessionStorage.setItem('suspOnly', '1') : sessionStorage.removeItem('suspOnly'); route(); });
  $$('[data-revoke]').forEach((b) => { b.onclick = () => act(() => DEL(`/security/sessions/${b.dataset.revoke}`), 'Oturum sonlandırıldı').then(route); });
}

// ---------------------------------------------------------------------------
// Team, audit log, scheduled tasks (admins)
// ---------------------------------------------------------------------------

async function viewUsers(main) {
  const { users, roles } = await GET('/users');
  const roleOptions = (sel) => Object.entries(roles).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
  main.innerHTML = `<h1>Ekip</h1>
  <div class="card"><h2>Ekip üyesi ekle</h2><form id="nu" class="form-grid">
    <label>Ad<input name="name" required></label><label>E-posta<input name="email" type="email" required></label>
    <label>Geçici şifre<input name="password" type="password" required autocomplete="new-password"></label>
    <label>Rol<select name="role">${roleOptions('operator')}</select></label><div><button class="primary">Ekle</button></div></form>
    <p class="muted"><b>Yönetici:</b> her şey. <b>Operatör:</b> konuşmalar, ilanlar, projeler, müşteriler, ürünler; ödeme/iade, ayar ve ekip işlemleri yapamaz. <b>İzleyici:</b> yalnızca görüntüler.</p></div>
  <div class="card table-wrap"><table><tr><th>Kullanıcı</th><th>Rol</th><th>2FA</th><th>Bildirim</th><th>Son giriş</th><th>Durum</th><th></th></tr>
  ${users.map((u) => `<tr><td><b>${esc(u.name)}</b><div class="muted">${esc(u.email)}</div></td>
    <td><select data-role="${u.id}" style="width:auto">${roleOptions(u.role)}</select></td>
    <td>${u.totp_enabled ? '<span class="pill good">Açık</span>' : '<span class="pill warn">Kapalı</span>'}</td>
    <td><input type="checkbox" data-notify="${u.id}" ${u.notify ? 'checked' : ''} title="E-posta bildirimleri"></td>
    <td>${date(u.last_login_at)}</td><td>${u.active ? '<span class="pill good">Aktif</span>' : '<span class="pill">Pasif</span>'}</td>
    <td><div class="row">${u.id !== me.id ? `<button data-active="${u.id}" data-to="${u.active ? 0 : 1}">${u.active ? 'Pasif yap' : 'Aktif yap'}</button>` : ''}
      <button data-pw="${u.id}">Şifre ata</button>${u.totp_enabled && u.id !== me.id ? `<button class="danger" data-2fa="${u.id}">2FA sıfırla</button>` : ''}</div></td></tr>`).join('')}</table></div>`;
  $('#nu').onsubmit = (e) => { e.preventDefault(); act(() => POST('/users', Object.fromEntries(new FormData(e.target))), 'Kullanıcı eklendi').then((r) => r && route()); };
  $$('[data-role]').forEach((el) => { el.onchange = () => act(() => PUT(`/users/${el.dataset.role}`, { role: el.value }), 'Rol güncellendi').then(route); });
  $$('[data-notify]').forEach((el) => { el.onchange = () => act(() => PUT(`/users/${el.dataset.notify}`, { notify: el.checked }), 'Kaydedildi'); });
  $$('[data-active]').forEach((b) => { b.onclick = () => act(() => PUT(`/users/${b.dataset.active}`, { active: b.dataset.to === '1' }), 'Güncellendi').then(route); });
  $$('[data-pw]').forEach((b) => { b.onclick = () => {
    const pw = prompt('Yeni geçici şifre (en az 10 karakter, harf + rakam):');
    if (pw) act(() => POST(`/users/${b.dataset.pw}/password`, { password: pw }), 'Şifre atandı; kullanıcının oturumları kapatıldı');
  }; });
  $$('[data-2fa]').forEach((b) => { b.onclick = () => confirm('Bu kullanıcının 2FA kurulumu silinsin mi? (Telefonunu kaybettiyse)') && act(() => POST(`/users/${b.dataset['2fa']}/reset-2fa`), '2FA sıfırlandı').then(route); });
}

async function viewAudit(main) {
  const q = sessionStorage.getItem('auditQ') || '';
  const rows = await GET(`/audit${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  main.innerHTML = `<div class="row"><h1>Denetim kaydı</h1><span class="spacer"></span>
    <form id="qf" class="row"><input name="q" value="${esc(q)}" placeholder="İşlem, kullanıcı veya ayrıntı ara" style="width:260px"><button>Ara</button></form></div>
    <p class="muted">Panelden yapılan her değişiklik (kim, ne zaman, hangi IP'den, sonuç) burada tutulur. Şifre, kod ve IBAN gibi alanlar maskelenir.</p>
    <div class="card table-wrap"><table><tr><th>Zaman</th><th>Kullanıcı</th><th>İşlem</th><th>Sonuç</th><th>Ayrıntı</th><th>IP</th></tr>
    ${rows.map((r) => `<tr><td>${date(r.created_at)}</td><td>${esc(r.email || '-')}</td><td><code>${esc(r.action)}</code></td>
      <td><span class="pill ${r.status < 400 ? 'good' : r.status === 403 ? 'bad' : 'warn'}">${r.status}</span></td>
      <td class="muted" style="max-width:340px;word-break:break-word">${esc(r.detail || '')}</td><td>${esc(r.ip || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Kayıt yok</td></tr>'}</table></div>`;
  $('#qf').onsubmit = (e) => { e.preventDefault(); sessionStorage.setItem('auditQ', e.target.q.value); route(); };
}

async function viewJobs(main) {
  const { jobs, runs } = await GET('/jobs');
  const fmtNext = (j) => (j.enabled ? date(j.next_run_at) : '<span class="muted">Kapalı</span>');
  main.innerHTML = `<h1>Zamanlanmış görevler</h1>
    <p class="muted">Arka planda otomatik çalışan işler. Saatler Ayarlar → İşletme bölümündeki saat dilimine göredir. Ayrıntılı eşikler Ayarlar → Otomasyon bölümündedir.</p>
    <div class="card table-wrap"><table><tr><th>Görev</th><th>Zamanlama</th><th>Son çalışma</th><th>Sonraki</th><th>Açık</th><th></th></tr>
    ${jobs.map((j) => `<tr><td><b>${esc(j.label)}</b><div class="muted">${esc(j.description)}</div></td>
      <td>${esc(j.schedule_text)}<div><a href="#" data-edit="${j.name}">Değiştir</a></div></td>
      <td>${j.last_run_at ? `${date(j.last_run_at)} ${pill(j.last_status)}<div class="muted">${esc(j.last_message || '')}</div>` : '<span class="muted">Henüz çalışmadı</span>'}</td>
      <td>${fmtNext(j)}</td>
      <td><input type="checkbox" data-toggle="${j.name}" ${j.enabled ? 'checked' : ''}></td>
      <td><button data-run="${j.name}" ${j.running ? 'disabled' : ''}>${icon('play')} ${j.running ? 'Çalışıyor…' : 'Çalıştır'}</button></td></tr>
      <tr id="edit-${j.name}" hidden><td colspan="6"><form class="row" data-form="${j.name}">
        <select name="type" style="width:auto">${[['interval', 'Aralıklı'], ['daily', 'Her gün'], ['monthly', 'Her ay']].map(([k, v]) => `<option value="${k}" ${j.schedule.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <label class="check" style="margin:0">Dakika<input name="minutes" type="number" min="1" value="${j.schedule.minutes || 60}" style="width:90px"></label>
        <label class="check" style="margin:0">Gün<input name="day" type="number" min="1" max="28" value="${j.schedule.day || 1}" style="width:70px"></label>
        <label class="check" style="margin:0">Saat<input name="time" type="time" value="${j.schedule.time || '08:00'}" style="width:auto"></label>
        <button class="primary">Kaydet</button></form></td></tr>`).join('')}</table></div>
    <div class="card table-wrap"><h2>Çalışma geçmişi</h2><table><tr><th>Başlangıç</th><th>Görev</th><th>Tetikleyen</th><th>Sonuç</th><th>Mesaj</th><th class="num">Süre</th></tr>
    ${runs.map((r) => `<tr><td>${date(r.started_at)}</td><td>${esc(jobs.find((j) => j.name === r.job)?.label || r.job)}</td><td>${pill(r.trigger)}</td><td>${pill(r.status)}</td>
      <td class="muted">${esc(r.message || '')}</td><td class="num">${r.finished_at ? `${((new Date(r.finished_at) - new Date(r.started_at)) / 1000).toFixed(1)} sn` : '-'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Henüz çalışma yok</td></tr>'}</table></div>`;
  $$('[data-toggle]').forEach((el) => { el.onchange = () => act(() => PUT(`/jobs/${el.dataset.toggle}`, { enabled: el.checked }), el.checked ? 'Görev açıldı' : 'Görev kapatıldı').then(route); });
  $$('[data-run]').forEach((b) => { b.onclick = async () => {
    b.disabled = true; b.textContent = 'Çalışıyor…';
    const r = await act(() => POST(`/jobs/${b.dataset.run}/run`));
    if (r) toast(`${r.status === 'ok' ? 'Tamamlandı' : 'Hata'}: ${r.message}`, r.status !== 'ok');
    route();
  }; });
  $$('[data-edit]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); const row = $(`#edit-${a.dataset.edit}`); row.hidden = !row.hidden; }; });
  $$('[data-form]').forEach((f) => { f.onsubmit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const schedule = d.type === 'interval' ? { type: 'interval', minutes: Number(d.minutes) }
      : d.type === 'daily' ? { type: 'daily', time: d.time } : { type: 'monthly', day: Number(d.day), time: d.time };
    act(() => PUT(`/jobs/${f.dataset.form}`, { schedule }), 'Zamanlama güncellendi').then((r) => r && route());
  }; });
}

const SETTINGS_FORM = {
  business: ['İşletme & ödeme bilgileri', [
    ['name', 'İşletme adı'], ['owner_name', 'Yetkili adı'], ['admin_email', 'Admin bildirim e-postası', 'email'],
    ['base_currency', 'Ana para birimi'], ['tax_rate', 'KDV oranı (%)', 'number'], ['fx_rates', 'Döviz kurları (JSON, 1 birim = ? ana para)', 'json'],
    ['iban', 'IBAN'], ['iban_holder', 'IBAN sahibi'], ['bank_name', 'Banka'], ['timezone', 'Saat dilimi (ör. Europe/Istanbul)'],
  ]],
  ai: ['Yapay zeka', [
    ['enabled', 'Yapay zeka aktif', 'bool'], ['auto_build', 'İş alınınca otomatik geliştirmeye başla', 'bool'],
    ['sales_persona', 'Satış temsilcisi kişiliği', 'textarea'], ['max_discount_percent', 'Maksimum indirim (%)', 'number'],
    ['monthly_token_budget', 'Aylık token bütçesi (0 = sınırsız)', 'number'], ['escalate_after_unsatisfied', 'Kaç memnuniyetsiz yanıttan sonra admine aktar', 'number'],
  ]],
  scanner: ['Freelancer platform tarama kapsamı', [
    ['enabled_platforms', 'Taranacak platformlar', 'platforms'], ['keywords', 'Anahtar kelimeler (virgülle)', 'list'],
    ['exclude_keywords', 'Hariç tutulacak kelimeler (virgülle)', 'list'], ['min_budget', 'Minimum bütçe (ana para)', 'number'],
    ['max_budget', 'Maksimum bütçe (0 = sınırsız)', 'number'], ['currencies', 'Kabul edilen para birimleri (boş = hepsi)', 'list'],
    ['max_age_hours', 'En fazla kaç saatlik ilanlar', 'number'], ['max_leads_per_scan', 'Tarama başına en fazla ilan', 'number'],
    ['rss_feeds', 'RSS beslemeleri (JSON: [{"name":"..","url":".."}])', 'json'],
  ]],
  payments: ['Ödeme', [
    ['provider', 'Ödeme yöntemi', 'provider'], ['send_iban_automatically', 'Müşteri onaylayınca ödeme bilgisini otomatik gönder', 'bool'], ['payment_due_days', 'Ödeme süresi (gün)', 'number'],
  ]],
  security: ['Güvenlik', [
    ['require_2fa_for_admins', 'Yöneticiler için iki adımlı doğrulama zorunlu', 'bool'], ['alert_on_new_ip', 'Yeni IP adresinden girişte e-posta uyarısı', 'bool'],
    ['max_failed_logins', 'Hesap başına 15 dakikada izin verilen hatalı giriş', 'number'], ['max_failed_per_ip', 'IP başına 15 dakikada izin verilen hatalı giriş', 'number'],
    ['idle_timeout_minutes', 'Hareketsizlikte oturumu kapat (dakika, 0 = kapalı)', 'number'],
    ['allowed_ips', 'Panele erişebilecek IP adresleri (virgülle, 192.168.1.* gibi; boş = herkes)', 'list'],
    ['large_refund_amount', 'Bu tutarın üzerindeki iadelerde güvenlik uyarısı (ana para)', 'number'],
    ['max_refunds_per_day', 'Günde bundan fazla iadede uyarı', 'number'], ['audit_retention_days', 'Denetim/giriş kayıtlarını sakla (gün)', 'number'],
  ]],
  automation: ['Otomasyon (zamanlanmış görev eşikleri)', [
    ['payment_reminder_days', 'Ödeme hatırlatma sıklığı (gün)', 'number'], ['payment_max_reminders', 'En fazla ödeme hatırlatması', 'number'],
    ['followup_after_hours', 'Cevapsız müşteriye takip mesajı (saat sonra)', 'number'], ['followup_max', 'En fazla takip mesajı', 'number'],
    ['escalation_renotify_minutes', 'Yanıtlanmayan aktarılmış konuşmayı tekrar bildir (dakika)', 'number'],
    ['token_budget_warn_percent', 'Yapay zeka bütçesi uyarı eşiği (%)', 'number'], ['backup_keep', 'Saklanacak günlük yedek sayısı', 'number'],
    ['notification_retention_days', 'Okunmuş bildirimleri sakla (gün)', 'number'],
  ]],
};

async function viewSettings(main) {
  const [settings, platforms] = await Promise.all([GET('/settings'), GET('/platforms')]);
  main.innerHTML = `<h1>Ayarlar</h1>${Object.entries(SETTINGS_FORM).map(([section, [title, fields]]) => `
    <div class="card"><h2>${title}</h2><form data-section="${section}"><div class="form-grid">
    ${fields.map(([k, l, t]) => {
      const v = settings[section][k];
      if (t === 'bool') return `<label class="check"><input type="checkbox" name="${k}" ${v ? 'checked' : ''}>${l}</label>`;
      if (t === 'textarea') return `<label style="grid-column:1/-1">${l}<textarea name="${k}">${esc(v)}</textarea></label>`;
      if (t === 'json') return `<label style="grid-column:1/-1">${l}<textarea name="${k}" data-json>${esc(JSON.stringify(v, null, 1))}</textarea></label>`;
      if (t === 'list') return `<label>${l}<input name="${k}" data-list value="${esc((v || []).join(', '))}"></label>`;
      if (t === 'provider') return `<label>${l}<select name="${k}"><option value="iban" ${v === 'iban' ? 'selected' : ''}>IBAN (havale/EFT)</option><option value="stripe" ${v === 'stripe' ? 'selected' : ''}>Stripe (kart) + IBAN</option></select></label>`;
      if (t === 'platforms') return `<div style="grid-column:1/-1"><div class="muted">${l}</div>${platforms.map((p) => `<label class="check"><input type="checkbox" data-platform value="${p.name}" ${v.includes(p.name) ? 'checked' : ''}>${esc(p.label)}</label>`).join('')}</div>`;
      return `<label>${l}<input name="${k}" ${t ? `type="${t}"` : ''} value="${esc(v)}"></label>`;
    }).join('')}</div><button class="primary">Kaydet</button></form></div>`).join('')}`;
  $$('form[data-section]').forEach((form) => { form.onsubmit = async (e) => {
    e.preventDefault();
    const section = form.dataset.section;
    const data = {};
    try {
      for (const [k, , t] of SETTINGS_FORM[section][1]) {
        if (t === 'platforms') { data[k] = $$('[data-platform]:checked', form).map((x) => x.value); continue; }
        const el = form.elements[k];
        if (t === 'bool') data[k] = el.checked;
        else if (t === 'number') data[k] = Number(el.value || 0);
        else if (t === 'json') data[k] = JSON.parse(el.value || 'null');
        else if (t === 'list') data[k] = el.value.split(',').map((x) => x.trim()).filter(Boolean);
        else data[k] = el.value;
      }
    } catch { return toast('JSON alanı geçersiz', true); }
    act(() => PUT(`/settings/${section}`, data), 'Kaydedildi');
  }; });
}

const VIEWS = {
  dashboard: viewDashboard,
  conversations: viewConversations,
  leads: viewLeads,
  projects: viewProjects,
  customers: viewCustomers,
  catalog: viewCatalog,
  payments: viewPayments,
  expenses: viewExpenses,
  notifications: viewNotifications,
  security: viewSecurity,
  settings: viewSettings,
  users: viewUsers,
  audit: viewAudit,
  jobs: viewJobs,
};

boot();
