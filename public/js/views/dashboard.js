import { barChart, funnel } from '../charts.js';
import {
  $, GET, POST, ago, app, busy, empty, esc, icon, money, pageHeader, toast,
} from '../core.js';

const NOTE_ICON = {
  customer_message: ['message-circle', 'info'], reply_waiting: ['clock', 'warn'], security: ['shield', 'bad'],
  new_leads: ['target', 'accent'], daily_digest: ['calendar', 'neutral'], job_failed: ['triangle-alert', 'bad'],
  prospect_replied: ['message-circle', 'good'], prospect_scan: ['radar', 'accent'], delivery_failed: ['triangle-alert', 'bad'],
};
export const noteIcon = (type) => NOTE_ICON[type] || ['bell', 'neutral'];

const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
const dayTitle = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

export async function viewDashboard(main) {
  const [d, notes] = await Promise.all([GET('/dashboard'), GET('/notifications').catch(() => [])]);
  const k = d.kpis;
  const hour = new Date().getHours();
  const greet = hour < 6 ? 'İyi geceler' : hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';
  const kpi = (label, value, ic, tone, sub, href) => `<a class="card kpi span-3 kpi-link" href="${href}">
    <div class="kpi-top"><span class="tile-icon ${tone}">${icon(ic)}</span><span class="kpi-label">${label}</span></div>
    <div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></a>`;
  const failing = d.sources.filter((s) => s.enabled && s.last_status === 'error');

  main.innerHTML = `${pageHeader({
    eyebrow: `${icon('calendar', 'xs')} ${new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}`,
    title: `${greet}, ${esc((app.me?.name || '').split(' ')[0])}`,
    subtitle: 'Bugün yazabileceğiniz ilanlar, işletmeler ve size dönen cevaplar.',
    actions: `<a class="btn" href="#/prospects">${icon('radar', 'sm')} Bölge tara</a><button class="btn primary" id="scanNow">${icon('refresh-cw', 'sm')} İlanları tara</button>`,
  })}

  ${k.waiting_reply ? `<div class="banner"><span class="banner-dot"></span><span><b>${k.waiting_reply} kişi</b> cevabınızı bekliyor</span><span class="spacer"></span><a class="btn sm" href="#/conversations">Konuşmalara git</a></div>` : ''}
  ${failing.length ? `<div class="callout warn">${icon('triangle-alert', 'sm')}<span><b>${failing.length} kaynak okunamadı:</b> ${failing.map((s) => esc(s.name)).join(', ')}. <a class="link" href="#/sources">Kaynaklara bakın</a></span></div>` : ''}

  <section class="bento">
    ${kpi('İncelenmemiş ilan', k.new_leads, 'target', 'accent', `Bugün ${k.leads_today} yeni`, '#/leads')}
    ${kpi('Sıcak işletme', k.hot_prospects, 'radar', 'info', 'Yazılmayı bekliyor', '#/prospects')}
    ${kpi('Bu hafta yazdığınız', k.contacted_week, 'send', 'good', 'İlan + işletme', '#/conversations')}
    ${kpi('Kazanılan', k.won, 'trophy', 'warn', `${k.waiting_reply} cevap bekliyor`, '#/leads')}

    <div class="card span-8">
      <div class="card-head"><div><h2>Son 14 gün</h2><p>Bulunan ilan ve işletmeler, yazdığınız mesajlar</p></div></div>
      <div id="bars"></div>
    </div>
    <div class="card span-4">
      <div class="card-head"><div><h2>Müşteri hunisi</h2><p>Tüm zamanlar</p></div><span class="tile-icon neutral">${icon('funnel')}</span></div>
      <div id="funnel"></div>
    </div>

    <div class="card span-5 flush">
      <div class="card-head pad"><div><h2>Öne çıkan ilanlar</h2><p>Anahtar kelimelerinize en çok uyanlar</p></div><a class="btn sm ghost" href="#/leads">Tümü ${icon('arrow-up-right', 'xs')}</a></div>
      ${d.top_leads.length ? `<ul class="mini-list">${d.top_leads.map((l) => `<li><a href="#/leads/${l.id}"><span class="score-dot">${l.score ?? '–'}</span>
        <span class="ml-body"><b>${esc(l.title)}</b><small>${esc(l.platform)} · ${ago(l.created_at)}${l.budget_max ? ` · ${money(l.budget_max, l.currency || '')}` : ''}</small></span>${icon('chevron-right', 'sm')}</a></li>`).join('')}</ul>`
    : empty('Yeni ilan yok', 'Kaynak ekleyin veya "İlanları tara"ya basın.', 'target')}
    </div>
    <div class="card span-4 flush">
      <div class="card-head pad"><div><h2>Sıcak işletmeler</h2><p>Web sitesine en çok ihtiyacı olanlar</p></div><a class="btn sm ghost" href="#/prospects">Tümü ${icon('arrow-up-right', 'xs')}</a></div>
      ${d.top_prospects.length ? `<ul class="mini-list">${d.top_prospects.map((p) => `<li><a href="#/prospects/${p.id}"><span class="score-dot">${p.score}</span>
        <span class="ml-body"><b>${esc(p.name)}</b><small>${esc(p.category_label || '')}</small></span>${icon('chevron-right', 'sm')}</a></li>`).join('')}</ul>`
    : empty('Henüz işletme yok', 'Bölge taraması sayfasından semtinizi tarayın.', 'radar')}
    </div>
    <div class="card span-3">
      <div class="card-head"><div><h2>Son etkinlik</h2></div><a class="btn sm ghost" href="#/notifications">Tümü</a></div>
      <ul class="feed">${notes.slice(0, 6).map((n) => {
        const [ic, tone] = noteIcon(n.type);
        return `<li><span class="feed-icon ${tone}">${icon(ic, 'xs')}</span><div><b>${esc(n.subject)}</b><span>${ago(n.created_at)}</span></div></li>`;
      }).join('') || '<li class="muted">Henüz etkinlik yok</li>'}</ul>
    </div>

    <div class="card span-12 flush">
      <div class="card-head pad"><div><h2>Kaynaklar</h2><p>Son 30 günde kaynak başına uygun ilan: ${d.by_platform.map((p) => `${esc(p.platform)} ${p.n}`).join(' · ') || '—'}</p></div>
        <a class="btn sm ghost" href="#/sources">Yönet ${icon('arrow-up-right', 'xs')}</a></div>
      ${d.sources.length ? `<table class="table"><thead><tr><th>Kaynak</th><th>Son tarama</th><th>Sonuç</th></tr></thead><tbody>
        ${d.sources.map((s) => `<tr class="${s.enabled ? '' : 'muted'}"><td><div class="cell-title">${esc(s.name)}</div></td>
          <td>${s.last_run_at ? ago(s.last_run_at) : '<span class="muted">Hiç</span>'}</td>
          <td>${s.last_status ? `<span class="pill ${s.last_status === 'ok' ? 'good' : 'bad'}">${s.last_status === 'ok' ? 'Başarılı' : 'Hata'}</span> <small class="muted">${esc(s.last_message || '')}</small>` : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table>`
    : empty('Kaynak yok', 'Kaynaklar sayfasından ilan siteleri ekleyin.', 'globe')}
    </div>
  </section>`;

  barChart($('#bars'), d.days.map((x) => ({ ...x, found: x.leads + x.prospects })), {
    series: [{ key: 'found', label: 'Bulunan', color: 'var(--series-1)' }, { key: 'contacted', label: 'Yazdığınız', color: 'var(--series-2)' }],
    label: (r) => dayLabel(r.day), title: (r) => dayTitle(r.day), emptyText: 'Son 14 günde kayıt yok',
  });
  funnel($('#funnel'), [
    { label: 'Bulunan', value: d.funnel.found },
    { label: 'Yazılan', value: d.funnel.contacted },
    { label: 'Cevap veren', value: d.funnel.replied },
    { label: 'Kazanılan', value: d.funnel.won },
  ]);
  $('#scanNow').onclick = (e) => busy(e.currentTarget, async () => {
    toast('Kaynaklar taranıyor…');
    try {
      const r = await POST('/leads/scan');
      toast(r.skipped ? 'Tarama zaten sürüyor' : `${r.fetched} ilan okundu · ${r.matched} yeni uygun ilan${r.errors.length ? ` · ${r.errors.length} kaynakta hata` : ''}`);
      app.route();
    } catch (err) { toast(err.message, 'error'); }
  });
}
