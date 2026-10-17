import { areaChart, barChart, funnel } from '../charts.js';
import {
  $, GET, POST, ago, app, busy, empty, esc, icon, money, pageHeader, pct, toast,
} from '../core.js';

const STAGES = [
  ['Geliştirme', ['won', 'building', 'revision', 'build_failed']],
  ['Kontrol', ['review', 'approved']],
  ['Demo', ['demo_live', 'changes_requested']],
  ['Ödeme', ['customer_approved', 'awaiting_payment']],
  ['Tamamlandı', ['paid', 'delivered']],
];

const NOTE_ICON = {
  escalation: ['circle-alert', 'bad'], customer_message: ['message-circle', 'info'], security: ['shield', 'bad'],
  project_won: ['briefcase', 'good'], build_ready: ['eye', 'warn'], build_progress: ['cpu', 'accent'], build_failed: ['triangle-alert', 'bad'],
  customer_approved: ['circle-check', 'good'], changes_requested: ['pencil', 'warn'], payment_received: ['banknote', 'good'],
  payment_overdue: ['clock', 'warn'], refund: ['hand-coins', 'warn'], lead_needs_admin: ['target', 'info'], daily_digest: ['calendar', 'neutral'],
  monthly_report: ['file-text', 'neutral'], ai_budget: ['cpu', 'warn'], job_failed: ['triangle-alert', 'bad'],
};
export const noteIcon = (type) => NOTE_ICON[type] || ['bell', 'neutral'];

function delta(cur, prev, { invert = false } = {}) {
  if (!prev && !cur) return '<span class="delta flat">—</span>';
  const p = pct(cur, prev);
  const up = p >= 0;
  const good = invert ? !up : up;
  return `<span class="delta ${good ? 'up' : 'down'}">${icon(up ? 'arrow-up-right' : 'arrow-down-right', 'xs')}%${Math.abs(p).toFixed(p && Math.abs(p) < 10 ? 1 : 0)}</span>`;
}

export async function viewDashboard(main) {
  const month = sessionStorage.getItem('month') || new Date().toISOString().slice(0, 7);
  const [d, projects, notes] = await Promise.all([
    GET(`/dashboard?month=${month}`), GET('/projects').catch(() => []), GET('/notifications').catch(() => []),
  ]);
  const s = d.stats; const c = s.currency;
  const idx = d.trend.findIndex((t) => t.month === month);
  const prev = idx > 0 ? d.trend[idx - 1] : { revenue: 0, profit: 0, expenses: 0, new_customers: 0, projects_won: 0 };
  const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  const hour = new Date().getHours();
  const greet = hour < 6 ? 'İyi geceler' : hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';
  const active = projects.filter((p) => p.status !== 'cancelled');
  const stageCounts = STAGES.map(([l, st]) => [l, active.filter((p) => st.includes(p.status)).length]);
  const totalActive = Math.max(1, stageCounts.reduce((a, [, n]) => a + n, 0));

  const kpi = (label, value, dlt, ic, tone, sub = '') => `<div class="card kpi span-3">
    <div class="kpi-top"><span class="tile-icon ${tone}">${icon(ic)}</span><span class="kpi-label">${label}</span>${dlt}</div>
    <div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;

  main.innerHTML = `${pageHeader({
    eyebrow: `${icon('calendar', 'xs')} ${esc(monthName)}`,
    title: `${greet}, ${esc((app.me?.name || '').split(' ')[0])}`,
    subtitle: 'İşletmenizin bu ayki durumu ve yapay zekanın sizin için yaptıkları.',
    actions: `<input type="month" id="month" value="${month}" class="input-sm" aria-label="Ay seç">
      <a class="btn" href="/api/reports/monthly.pdf?month=${month}">${icon('download', 'sm')} PDF</a>
      <button class="btn ai" id="analyzeTop">${icon('sparkles', 'sm')} Yapay zekaya sor</button>`,
  })}

  ${d.open_escalations || d.projects_waiting_review ? `<div class="banner">
    <span class="banner-dot"></span><span>${[
      d.open_escalations ? `<b>${d.open_escalations} konuşma</b> sizi bekliyor` : '',
      d.projects_waiting_review ? `<b>${d.projects_waiting_review} proje</b> kontrolünüzü bekliyor` : '',
    ].filter(Boolean).join(' · ')}</span><span class="spacer"></span>
    ${d.open_escalations ? `<a class="btn sm" href="#/conversations">Konuşmalara git</a>` : ''}
    ${d.projects_waiting_review ? `<a class="btn sm" href="#/projects">Projelere git</a>` : ''}</div>` : ''}

  <section class="bento">
    <div class="card hero span-6">
      <div class="hero-head"><div><span class="kpi-label">Net ciro</span>
        <div class="hero-value">${money(s.revenue)} <small>${c}</small></div>
        <div class="hero-sub">${delta(s.revenue, prev.revenue)} <span>geçen aya göre · brüt ${money(s.gross_revenue, c)}, iade ${money(s.refunded, c)}</span></div></div>
        <span class="tile-icon accent">${icon('banknote')}</span></div>
      <div id="spark" class="hero-chart"></div>
    </div>
    <div class="span-6 kpi-stack">
      ${kpi('Kâr', `${money(s.profit)} <small>${c}</small>`, delta(s.profit, prev.profit), s.profit >= 0 ? 'trending-up' : 'trending-down', s.profit >= 0 ? 'good' : 'bad', `Gider ${money(s.expenses, c)}`)}
      ${kpi('Alınan iş', s.projects_won, delta(s.projects_won, prev.projects_won), 'briefcase', 'info', `Dönüşüm %${s.conversion_rate}`)}
      ${kpi('Yeni müşteri', s.new_customers, delta(s.new_customers, prev.new_customers), 'user-plus', 'good', `${s.conversations} konuşma`)}
      ${kpi('Giderler', `${money(s.expenses)} <small>${c}</small>`, delta(s.expenses, prev.expenses, { invert: true }), 'receipt', 'warn', `Yapay zeka ${money(s.expenses_by_category.ai, c)}`)}
    </div>

    <div class="card span-8">
      <div class="card-head"><div><h2>Ciro ve gider</h2><p>Son 12 ay</p></div></div>
      <div id="bars"></div>
    </div>
    <div class="card span-4">
      <div class="card-head"><div><h2>Satış hunisi</h2><p>${esc(monthName)}</p></div><span class="tile-icon neutral">${icon('funnel')}</span></div>
      <div id="funnel"></div>
    </div>

    <div class="card ai-card span-5">
      <div class="card-head"><div><h2>${icon('sparkles', 'sm')} Yapay zeka içgörüsü</h2><p>Durum değerlendirmesi ve çözüm önerileri</p></div>
        <button class="btn sm" id="analyze">${icon('wand-sparkles', 'sm')} Analiz et</button></div>
      <div id="analysis" class="ai-output"><p class="muted">Satış, gider ve ürün verilerinize bakarak neyin iyi gittiğini, nerede para kaybettiğinizi ve ürünlerde neyi değiştirmeniz gerektiğini söyler.</p>
        <div class="ai-suggest">
          <span class="chip-static">${icon('trending-up', 'xs')} Satış düşüş nedenleri</span>
          <span class="chip-static">${icon('package', 'xs')} Ürün iyileştirmeleri</span>
          <span class="chip-static">${icon('coins', 'xs')} Fiyat önerileri</span></div></div>
    </div>
    <div class="card span-4">
      <div class="card-head"><div><h2>Proje hattı</h2><p>${active.length} aktif proje</p></div><a class="btn sm ghost" href="#/projects">Pano ${icon('arrow-up-right', 'xs')}</a></div>
      <div class="stackbar">${stageCounts.map(([l, n], i) => (n ? `<span style="flex:${n}; opacity:${1 - i * 0.15}" title="${l}: ${n}"></span>` : '')).join('') || '<span class="empty-bar"></span>'}</div>
      <ul class="stage-list">${stageCounts.map(([l, n], i) => `<li><i style="opacity:${1 - i * 0.15}"></i>${l}<b>${n}</b><span class="muted">%${Math.round((n / totalActive) * 100)}</span></li>`).join('')}</ul>
    </div>
    <div class="card span-3">
      <div class="card-head"><div><h2>Son etkinlik</h2></div><a class="btn sm ghost" href="#/notifications">Tümü</a></div>
      <ul class="feed">${notes.slice(0, 6).map((n) => {
        const [ic, tone] = noteIcon(n.type);
        return `<li><span class="feed-icon ${tone}">${icon(ic, 'xs')}</span><div><b>${esc(n.subject)}</b><span>${ago(n.created_at)}</span></div></li>`;
      }).join('') || `<li class="muted">Henüz etkinlik yok</li>`}</ul>
    </div>

    <div class="card span-12 flush">
      <div class="card-head pad"><div><h2>Ürün performansı</h2><p>Son 90 günde yapay zekanın önerdiği ve satılan ürünler</p></div><a class="btn sm ghost" href="#/catalog">Kataloğa git ${icon('arrow-up-right', 'xs')}</a></div>
      ${d.products.length ? `<table class="table"><thead><tr><th>Ürün</th><th class="num">Fiyat</th><th class="num">Önerilme</th><th class="num">Satış</th><th>Dönüşüm</th></tr></thead><tbody>
      ${d.products.map((p) => {
        const rate = p.recommended ? Math.round((p.sold / p.recommended) * 100) : 0;
        return `<tr><td><div class="cell-title">${esc(p.name)}</div></td><td class="num">${money(p.price, p.currency)}</td><td class="num">${p.recommended}</td><td class="num">${p.sold}</td>
          <td><div class="meter"><span style="width:${Math.min(100, rate)}%"></span></div><small class="muted">%${rate}</small></td></tr>`;
      }).join('')}</tbody></table>` : empty('Henüz ürün yok', 'Katalogdan ürün ekleyin; yapay zeka satarken bu listeyi kullanır.', 'package')}
    </div>
  </section>`;

  areaChart($('#spark'), d.trend.map((t) => ({ label: new Date(`${t.month}-01T12:00:00`).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }), value: t.revenue })), { height: 120, currency: c });
  barChart($('#bars'), d.trend, c);
  funnel($('#funnel'), [
    { label: 'Konuşma', value: s.conversations },
    { label: 'Alınan iş', value: s.projects_won },
    { label: 'Tahsil edilen', value: s.payments_count },
  ]);
  $('#funnel').insertAdjacentHTML('beforeend', `<div class="funnel-note">${icon('target', 'xs')} Bu ay ${s.leads} ilan tarandı, ${s.leads_contacted} ilan sahibine yazıldı</div>`);

  $('#month').onchange = (e) => { sessionStorage.setItem('month', e.target.value); app.route(); };
  const runAnalysis = (btn) => busy(btn, async () => {
    const out = $('#analysis');
    out.innerHTML = '<div class="ai-thinking"><span></span><span></span><span></span> Verileriniz inceleniyor…</div>';
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const r = await POST('/dashboard/analysis', { month });
      out.innerHTML = renderMarkdown(r.analysis);
    } catch (err) {
      out.innerHTML = `<div class="callout bad">${icon('circle-alert')} ${esc(err.message)}</div>`;
      toast(err.message, 'error');
    }
  });
  $('#analyze').onclick = (e) => runAnalysis(e.currentTarget);
  $('#analyzeTop').onclick = (e) => runAnalysis(e.currentTarget);
  if (sessionStorage.getItem('autoAnalyze')) { sessionStorage.removeItem('autoAnalyze'); runAnalysis($('#analyze')); }
}

/** Minimal, safe Markdown → HTML for AI output (headings, bullets, bold). */
export function renderMarkdown(text) {
  const lines = esc(text).split('\n');
  let html = ''; let inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (/^\s*[-*•]\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${line.replace(/^\s*[-*•]\s+/, '')}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    if (/^#{1,6}\s/.test(line)) html += `<h3>${line.replace(/^#{1,6}\s/, '')}</h3>`;
    else if (line.trim()) html += `<p>${line}</p>`;
  }
  return `<div class="md">${html}${inList ? '</ul>' : ''}</div>`;
}
