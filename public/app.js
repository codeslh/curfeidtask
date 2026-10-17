// Admin panel: a small hash-routed SPA on top of the JSON API.

const app = document.getElementById('app');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, cur = '') => `${Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${cur}`.trim();
const date = (s) => (s ? new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).toLocaleString('tr-TR') : '-');
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function api(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  if (res.status === 401 && !url.startsWith('/auth')) { renderLogin(); throw new Error('Oturum açın'); }
  const data = await res.json().catch(() => ({}));
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
  el.style.cssText = `position:fixed;right:16px;bottom:16px;z-index:9;padding:10px 14px;border-radius:8px;background:var(--surface);border:1px solid var(--border);color:${isError ? 'var(--bad)' : 'var(--text)'};box-shadow:0 4px 16px rgba(0,0,0,.15)`;
  document.body.append(el);
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
};
const pill = (s) => `<span class="pill ${STATUS_PILL[s] || ''}">${esc(LABELS[s] || s)}</span>`;

// ---------------------------------------------------------------------------
// Shell, auth
// ---------------------------------------------------------------------------

const NAV = [
  ['dashboard', 'Panel'],
  ['conversations', 'Konuşmalar'],
  ['leads', 'İş ilanları'],
  ['projects', 'Projeler'],
  ['customers', 'Müşteriler'],
  ['catalog', 'Ürün & fiyatlar'],
  ['payments', 'Ödemeler & faturalar'],
  ['expenses', 'Giderler'],
  ['notifications', 'Bildirimler'],
  ['security', 'Güvenlik'],
  ['settings', 'Ayarlar'],
];

let me = null;
let pollTimer = null;

async function boot() {
  const status = await fetch('/api/auth/status').then((r) => r.json());
  if (status.needs_setup) return renderSetup();
  if (!status.user) return renderLogin();
  me = status.user;
  window.addEventListener('hashchange', route);
  route();
}

function renderLogin() {
  window.removeEventListener('hashchange', route);
  app.innerHTML = `<div class="card login"><h1>Giriş yap</h1>
    <form id="f"><label>E-posta<input name="email" type="email" required autocomplete="username"></label>
    <label>Şifre<input name="password" type="password" required autocomplete="current-password"></label>
    <div class="error" id="err"></div><button class="primary">Giriş</button></form></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await api('POST', '/auth/login', fd);
      boot();
    } catch (err) { $('#err').textContent = err.message; }
  };
}

function renderSetup() {
  app.innerHTML = `<div class="card login"><h1>İlk kurulum</h1><p class="muted">Yönetici hesabını oluşturun.</p>
    <form id="f"><label>Ad<input name="name" required></label><label>E-posta<input name="email" type="email" required></label>
    <label>Şifre (en az 10 karakter, harf + rakam)<input name="password" type="password" required autocomplete="new-password"></label>
    <div class="error" id="err"></div><button class="primary">Oluştur</button></form></div>`;
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
  app.innerHTML = `<div class="layout"><nav class="side"><div class="brand">Freelance Otomasyon</div>
    ${NAV.map(([k, l]) => `<a href="#/${k}" class="${k === active ? 'active' : ''}">${l}${badge(k) ? `<span class="badge">${badge(k)}</span>` : ''}</a>`).join('')}
    <a href="#" id="logout">Çıkış (${esc(me?.name || '')})</a></nav><main id="main"></main></div>`;
  $('#logout').onclick = async (e) => {
    e.preventDefault();
    await POST('/auth/logout');
    location.hash = '';
    renderLogin();
  };
  return $('#main');
}

async function route() {
  clearInterval(pollTimer);
  const [, page = 'dashboard', id] = location.hash.replace(/^#/, '').split('/');
  const view = VIEWS[page] || VIEWS.dashboard;
  const main = await shell(VIEWS[page] ? page : 'dashboard');
  try {
    await view(main, id);
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
  if (!raw) { el.innerHTML = '<p class="muted">Henüz ciro veya gider kaydı yok. Ödemeler ve giderler oluştukça grafik burada görünecek.</p>'; return; }
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
  const tile = (label, value, sub = '') => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  main.innerHTML = `<div class="row"><h1>Panel</h1><span class="spacer"></span>
    <input type="month" id="month" value="${month}" style="width:auto">
    <a class="btn" href="/api/reports/monthly.pdf?month=${month}">PDF özet</a>
    <a class="btn" href="/api/reports/monthly.pdf?month=${month}&analysis=1">PDF + yapay zeka yorumu</a></div>
  <div class="grid">
    ${tile('Net ciro', money(s.revenue, c), `Brüt ${money(s.gross_revenue, c)} · İade ${money(s.refunded, c)}`)}
    ${tile('Toplam gider', money(s.expenses, c), `Yapay zeka ${money(s.expenses_by_category.ai, c)}`)}
    ${tile('Kâr', money(s.profit, c))}
    ${tile('Yeni müşteri', s.new_customers, `${s.conversations} konuşma`)}
    ${tile('Alınan iş', s.projects_won, `Dönüşüm %${s.conversion_rate}`)}
    ${tile('Ortalama sipariş', money(s.average_order, c), `${s.payments_count} ödeme`)}
    ${tile('Taranan ilan', s.leads, `${s.leads_contacted} iletişim`)}
    ${tile('Admine aktarılan', s.escalations, `${d.open_escalations} şu an bekliyor`)}
    ${tile('Token (bu ay)', Number(d.ai_tokens_this_month).toLocaleString('tr-TR'))}
  </div>
  <div class="card"><h2>Son 12 ay</h2><div id="chart"></div></div>
  <div class="card"><div class="row"><h2>Yapay zeka durum değerlendirmesi</h2><span class="spacer"></span><button class="primary" id="analyze">Analiz et</button></div>
    <div id="analysis" class="markdown muted">Satış, gider ve ürün performansınızı yorumlatıp çözüm önerileri almak için "Analiz et"e basın.</div></div>
  <div class="card"><h2>Ürün performansı (son 90 gün)</h2><div class="table-wrap"><table><tr><th>Ürün</th><th class="num">Fiyat</th><th class="num">Önerilme</th><th class="num">Satış</th></tr>
    ${d.products.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${money(p.price, p.currency)}</td><td class="num">${p.recommended}</td><td class="num">${p.sold}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Ürün yok</td></tr>'}
  </table></div></div>`;
  barChart($('#chart'), d.trend, c);
  $('#month').onchange = (e) => { sessionStorage.setItem('month', e.target.value); route(); };
  $('#analyze').onclick = async (e) => {
    e.target.disabled = true;
    $('#analysis').textContent = 'Analiz ediliyor...';
    const r = await act(() => POST('/dashboard/analysis', { month }));
    $('#analysis').textContent = r ? r.analysis : 'Analiz alınamadı.';
    $('#analysis').classList.remove('muted');
    e.target.disabled = false;
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
  main.innerHTML = `<div class="row"><h1>Konuşmalar</h1><span class="spacer"></span>
    <select id="filter" style="width:auto"><option value="">Tümü</option><option value="escalated">Admin bekleyenler</option><option value="open">Açık</option><option value="closed">Kapalı</option></select></div>
    <div class="chat-layout"><div class="card conv-list">${list.map((c) => `
      <div class="conv-item ${String(c.id) === id ? 'active' : ''}" data-id="${c.id}">
        <div class="row"><b>${esc(c.customer_name || '#' + c.id)}</b><span class="spacer"></span>${pill(c.channel)} ${pill(c.mode)}</div>
        <div class="row">${c.status === 'escalated' ? pill('escalated') : ''}<span class="last">${esc(c.last_message || '')}</span></div>
      </div>`).join('') || '<p class="muted" style="padding:12px">Henüz konuşma yok.</p>'}</div>
    <div id="detail" class="card">${id ? '' : '<p class="muted">Bir konuşma seçin.</p>'}</div></div>`;
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
    detail.innerHTML = `<div class="row"><h2>${esc(d.customer?.name || 'Müşteri')}</h2>${pill(c.channel)} ${pill(c.mode)} ${pill(c.status)}<span class="spacer"></span>
        ${c.mode === 'ai' ? '<button id="takeover" class="primary">Konuşmayı devral</button>' : '<button id="release">Yapay zekaya devret</button>'}
        <button id="close">Kapat</button></div>
      <div class="muted">${esc([d.customer?.phone, d.customer?.email].filter(Boolean).join(' · '))}
        ${c.escalation_reason ? ` · Aktarım sebebi: ${esc(c.escalation_reason)}` : ''}
        ${d.project ? ` · Proje: <a href="#/projects/${d.project.id}">${esc(d.project.title)}</a> ${pill(d.project.status)}` : ''}</div>
      ${c.channel === 'platform' ? '<p class="muted">Bu konuşma bir freelancer platformunda; mesajları platform üzerinden iletmeniz gerekir.</p>' : ''}
      <div class="messages" id="msgs">${d.messages.map((m) => `<div class="msg ${m.sender}"><div class="who">${{ customer: 'Müşteri', ai: 'Yapay zeka', admin: 'Admin', system: '' }[m.sender]} ${date(m.created_at)}</div>${esc(m.body)}</div>`).join('')}</div>
      <div class="shortcuts"><span class="group">Temalar:</span>${sc.themes.map((t) => `<button class="chip" data-text="Tema önerisi: ${esc(t.name)}${t.preview_url ? ` (${esc(t.preview_url)})` : ''}">${esc(t.name)}</button>`).join('')}</div>
      <div class="shortcuts"><span class="group">Diller:</span>${sc.languages.map((l) => `<button class="chip" data-text="Teknoloji: ${esc(l.name)}">${esc(l.name)}</button>`).join('')}</div>
      <div class="shortcuts"><span class="group">Örnekler:</span>${sc.products.map((p) => `<button class="chip" data-text="${esc(p.name)}${p.demo_url ? ` örneği: ${esc(p.demo_url)}` : ''}">${esc(p.name)}</button>`).join('')}</div>
      <form id="send" class="row"><textarea id="reply" placeholder="${c.mode === 'ai' ? 'Mesaj yazarsanız konuşmayı devralırsınız' : 'Müşteriye yazın'}" style="min-height:60px;flex:1"></textarea><button class="primary">Gönder</button></form>`;
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
    <a class="btn" href="#/settings">Tarama kapsamı</a><button class="primary" id="scan">Şimdi tara</button></div>
    <div class="card table-wrap"><table><tr><th>İlan</th><th>Platform</th><th class="num">Bütçe</th><th>Durum</th><th></th></tr>
    ${leads.map((l) => `<tr><td><b>${esc(l.title)}</b><div class="muted">${esc(l.description.slice(0, 220))}</div>
        ${l.filter_reason ? `<div class="muted">Sebep: ${esc(l.filter_reason)}</div>` : ''}${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">İlana git</a>` : ''}</td>
      <td>${esc(l.platform)}</td><td class="num">${l.budget_min ?? '?'} – ${l.budget_max ?? '?'} ${esc(l.currency || '')}</td><td>${pill(l.status)}</td>
      <td><div class="row">${l.conversation_id ? `<a class="btn" href="#/conversations/${l.conversation_id}">Konuşma</a>` : ''}
        ${l.status !== 'won' ? `<button data-project="${l.id}">İşi aldım</button><button data-lost="${l.id}">Kaybedildi</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="5" class="muted">İlan yok. "Şimdi tara" ile platformları tarayın.</td></tr>'}
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
  main.innerHTML = `<div class="row"><h1>Projeler</h1><span class="spacer"></span><button id="new" class="primary">Yeni proje</button></div>
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
  main.innerHTML = `<div class="row"><h1>${esc(p.title)}</h1>${pill(p.status)}${d.building ? ' <span class="pill warn">Yapay zeka çalışıyor…</span>' : ''}<span class="spacer"></span><a class="btn" href="#/projects">← Projeler</a></div>
  <div class="grid">
    <div class="tile"><div class="label">Müşteri</div><div class="value" style="font-size:16px">${esc(p.customer_name || '-')}</div>${p.conversation_id ? `<a href="#/conversations/${p.conversation_id}">Konuşmaya git</a>` : ''}</div>
    <div class="tile"><div class="label">Fiyat</div><div class="value">${money(p.price, p.currency)}</div></div>
    <div class="tile"><div class="label">Tema / Teknoloji</div><div class="value" style="font-size:16px">${esc(p.theme_name || '-')} / ${esc(p.language_name || '-')}</div></div>
    <div class="tile"><div class="label">Demo</div><div class="value" style="font-size:14px">${p.demo_url ? `<a href="${esc(p.demo_url)}" target="_blank" rel="noopener">${esc(p.demo_url)}</a>` : '-'}</div></div>
  </div>
  <div class="card"><h2>İşlemler</h2><div class="row">
    <button id="approve" ${can('review') ? '' : 'disabled'}>Sürümü onayla</button>
    <button id="deploy" class="primary" ${can('approved', 'demo_live', 'changes_requested') && p.current_version ? '' : 'disabled'}>Demoyu yayınla ve müşteriye gönder</button>
    <button id="custok" ${can('demo_live') ? '' : 'disabled'}>Müşteri onayladı (manuel)</button>
    <button id="payreq" ${can('customer_approved', 'demo_live', 'approved') ? '' : 'disabled'}>Ödeme talebi gönder</button>
    <button id="deliver" ${can('paid') ? '' : 'disabled'}>Teslim et</button>
    <button id="rebuild" ${d.building ? 'disabled' : ''}>Yeniden üret</button>
    <button id="cancel" class="danger">İptal et</button></div>
    <h3>Düzeltme iste (yapay zeka yeni sürüm üretir)</h3>
    <form id="fb"><textarea name="feedback" placeholder="Örn: Ana sayfadaki başlığı büyüt, iletişim formuna telefon alanı ekle..."></textarea>
    <button class="primary" ${d.building ? 'disabled' : ''}>Düzeltmeyi yapay zekaya gönder</button></form></div>
  <div class="card"><h2>Gereksinimler</h2><form id="req"><textarea name="requirements" style="min-height:120px">${esc(p.requirements)}</textarea><button>Kaydet</button></form></div>
  <div class="card"><h2>Sürümler</h2><div class="table-wrap"><table><tr><th>Sürüm</th><th>Özet</th><th>Düzeltme notu</th><th>Tarih</th><th></th></tr>
    ${d.versions.map((v) => `<tr><td>v${v.version}</td><td>${esc(v.summary)}</td><td>${esc(v.feedback || '-')}</td><td>${date(v.created_at)}</td><td><a class="btn" target="_blank" rel="noopener" href="${esc(v.preview_url)}">Önizle</a></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Henüz sürüm yok</td></tr>'}</table></div>
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
  main.innerHTML = `<h1>Müşteriler</h1><div class="card table-wrap"><table><tr><th>Ad</th><th>Telefon</th><th>E-posta</th><th>Kaynak</th><th class="num">Proje</th><th class="num">Ödenen</th><th>Kayıt</th></tr>
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
  main.innerHTML = `<h1>Ürün & fiyatlar</h1><div class="row" style="margin-bottom:12px">${Object.entries(CATALOG).map(([k, v]) => `<button data-tab="${k}" class="${k === tab ? 'primary' : ''}">${v.title}</button>`).join('')}</div>
    <p class="muted">Yapay zeka satış yaparken bu listeleri kullanır; temalar ve diller sohbet ekranında kısayol olarak görünür.</p>
    <div class="card"><h2 id="formTitle">Yeni ekle</h2><form id="cf"><input type="hidden" name="id"><div class="form-grid">
      ${cfg.fields.filter((f) => f[2] !== 'textarea').map(([k, l, t]) => `<label>${l}<input name="${k}" ${t ? `type="${t}" step="0.01"` : ''} ${k === 'name' ? 'required' : ''}></label>`).join('')}</div>
      ${cfg.fields.filter((f) => f[2] === 'textarea').map(([k, l]) => `<label>${l}<textarea name="${k}"></textarea></label>`).join('')}
      <div class="row"><button class="primary">Kaydet</button><button type="reset" id="resetBtn">Temizle</button></div></form></div>
    <div class="card table-wrap"><table><tr>${cfg.fields.slice(0, 4).map((f) => `<th>${f[1]}</th>`).join('')}<th></th></tr>
    ${rows.map((r) => `<tr>${cfg.fields.slice(0, 4).map(([k]) => `<td>${esc(r[k])}</td>`).join('')}<td><div class="row"><button data-edit="${r.id}">Düzenle</button><button class="danger" data-del="${r.id}">Sil</button></div></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Kayıt yok</td></tr>'}</table></div>`;
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
  main.innerHTML = `<h1>Ödemeler & faturalar</h1>
  <div class="card table-wrap"><h2>Ödeme geçmişi</h2><table><tr><th>Referans</th><th>Müşteri / proje</th><th>Yöntem</th><th class="num">Tutar</th><th class="num">İade</th><th>Durum</th><th>Oluşturma</th><th>Ödeme</th><th></th></tr>
  ${payments.map((p) => `<tr><td>${esc(p.reference)}</td><td>${esc(p.customer_name || '-')}<div class="muted">${esc(p.project_title || '')}</div></td><td>${p.method === 'iban' ? 'Havale/EFT' : 'Kart (Stripe)'}</td>
    <td class="num">${money(p.amount, p.currency)}</td><td class="num">${p.refunded_amount ? money(p.refunded_amount, p.currency) : '-'}</td><td>${pill(p.status)}</td><td>${date(p.created_at)}</td><td>${date(p.paid_at)}</td>
    <td><div class="row">${p.status === 'pending' ? `<button data-paid="${p.id}">Ödendi işaretle</button><button data-cancel="${p.id}">İptal</button>` : ''}
      ${['paid', 'partially_refunded'].includes(p.status) ? `<button class="danger" data-refund="${p.id}" data-max="${p.amount - p.refunded_amount}">İade</button>` : ''}
      ${p.checkout_url ? `<a class="btn" href="${esc(p.checkout_url)}" target="_blank" rel="noopener">Ödeme linki</a>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="9" class="muted">Ödeme yok</td></tr>'}</table></div>
  <div class="card table-wrap"><h2>Faturalar</h2><table><tr><th>No</th><th>Tür</th><th>Müşteri</th><th>Proje</th><th class="num">Ara toplam</th><th class="num">KDV</th><th class="num">Toplam</th><th>Tarih</th><th></th></tr>
  ${invoices.map((i) => `<tr><td>${esc(i.number)}</td><td>${i.kind === 'refund' ? 'İade' : 'Satış'}</td><td>${esc(i.customer_name || '-')}</td><td>${esc(i.project_title || '-')}</td>
    <td class="num">${money(i.subtotal, i.currency)}</td><td class="num">${money(i.tax_amount, i.currency)}</td><td class="num">${money(i.total, i.currency)}</td><td>${date(i.issued_at)}</td>
    <td><a class="btn" href="/api/invoices/${i.id}/pdf" target="_blank">PDF</a></td></tr>`).join('') || '<tr><td colspan="9" class="muted">Fatura yok</td></tr>'}</table></div>`;
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
  main.innerHTML = `<h1>Giderler</h1>
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

async function viewNotifications(main) {
  const list = await GET('/notifications');
  main.innerHTML = `<div class="row"><h1>Bildirimler</h1><span class="spacer"></span><button id="all">Tümünü okundu yap</button></div>
    <div class="card">${list.map((n) => `<div class="conv-item" data-id="${n.id}" data-link="${esc(n.link || '')}" style="${n.read ? 'opacity:.6' : ''}">
      <div class="row"><b>${esc(n.subject)}</b><span class="spacer"></span>${n.emailed ? '<span class="pill">e-posta gönderildi</span>' : ''}<span class="muted">${date(n.created_at)}</span></div>
      <div class="markdown muted">${esc(n.body)}</div></div>`).join('') || '<p class="muted">Bildirim yok</p>'}</div>`;
  $('#all').onclick = () => act(() => POST('/notifications/read-all')).then(route);
  $$('.conv-item').forEach((el) => { el.onclick = async () => {
    await POST(`/notifications/${el.dataset.id}/read`).catch(() => {});
    if (el.dataset.link) location.hash = `#${el.dataset.link}`; else route();
  }; });
}

async function viewSecurity(main) {
  const [events, sessions] = await Promise.all([GET('/security/events'), GET('/security/sessions')]);
  main.innerHTML = `<h1>Güvenlik</h1>
  <div class="card"><h2>Şifre değiştir</h2><form id="pw" class="form-grid">
    <label>Mevcut şifre<input type="password" name="current" required autocomplete="current-password"></label>
    <label>Yeni şifre<input type="password" name="next" required autocomplete="new-password"></label>
    <label>Yeni şifre (tekrar)<input type="password" name="next2" required autocomplete="new-password"></label>
    <div><button class="primary">Şifreyi değiştir</button></div></form><p class="muted">Şifre değişince diğer tüm oturumlar kapatılır.</p></div>
  <div class="card table-wrap"><div class="row"><h2>Aktif oturumlar</h2><span class="spacer"></span><button id="others">Diğer tüm oturumları kapat</button></div>
    <table><tr><th>IP</th><th>Tarayıcı</th><th>Açılış</th><th>Son görülme</th><th>Durum</th><th></th></tr>
    ${sessions.sessions.map((s) => `<tr><td>${esc(s.ip)}</td><td class="muted">${esc(s.user_agent)}</td><td>${date(s.created_at)}</td><td>${date(s.last_seen_at)}</td>
      <td>${s.id === sessions.current ? '<span class="pill good">Bu oturum</span>' : s.revoked_at ? '<span class="pill">Kapalı</span>' : new Date(s.expires_at) < new Date() ? '<span class="pill">Süresi doldu</span>' : '<span class="pill warn">Açık</span>'}</td>
      <td>${!s.revoked_at && s.id !== sessions.current && new Date(s.expires_at) > new Date() ? `<button class="danger" data-revoke="${s.id}">Sonlandır</button>` : ''}</td></tr>`).join('')}</table></div>
  <div class="card table-wrap"><h2>Giriş / çıkış ve işlem kayıtları</h2><table><tr><th>Zaman</th><th>Olay</th><th>E-posta</th><th>IP</th><th>Tarayıcı</th><th>Not</th></tr>
    ${events.map((e) => `<tr><td>${date(e.created_at)}</td><td>${pill(e.event)} ${e.suspicious ? '<span class="pill bad">Şüpheli</span>' : ''}</td><td>${esc(e.email || '')}</td><td>${esc(e.ip || '')}</td><td class="muted">${esc((e.user_agent || '').slice(0, 60))}</td><td>${esc(e.detail || '')}</td></tr>`).join('')}</table></div>`;
  $('#pw').onsubmit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (d.next !== d.next2) return toast('Yeni şifreler eşleşmiyor', true);
    act(() => POST('/security/password', d), 'Şifre değiştirildi').then((r) => r && route());
  };
  $('#others').onclick = () => act(() => POST('/security/sessions/revoke-others'), 'Diğer oturumlar kapatıldı').then(route);
  $$('[data-revoke]').forEach((b) => { b.onclick = () => act(() => DEL(`/security/sessions/${b.dataset.revoke}`), 'Oturum sonlandırıldı').then(route); });
}

const SETTINGS_FORM = {
  business: ['İşletme & ödeme bilgileri', [
    ['name', 'İşletme adı'], ['owner_name', 'Yetkili adı'], ['admin_email', 'Admin bildirim e-postası', 'email'],
    ['base_currency', 'Ana para birimi'], ['tax_rate', 'KDV oranı (%)', 'number'], ['fx_rates', 'Döviz kurları (JSON, 1 birim = ? ana para)', 'json'],
    ['iban', 'IBAN'], ['iban_holder', 'IBAN sahibi'], ['bank_name', 'Banka'],
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
    ['max_failed_logins', '15 dakikada izin verilen hatalı giriş', 'number'], ['alert_on_new_ip', 'Yeni IP adresinden girişte e-posta uyarısı', 'bool'],
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
};

boot();
