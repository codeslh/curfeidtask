import {
  $, $$, DEL, GET, POST, PUT, act, ago, app, busy, confirmDialog, empty, esc, field, icon, modal, pageHeader, toast, toggle,
} from '../core.js';

const MODE = {
  api: ['Otomatik', 'good', 'zap'],
  page: ['Sayfa izleme', 'info', 'scan-search'],
  bookmark: ['Yer imiyle', 'warn', 'bookmark'],
};

/** Bookmarklet: opens Kalfa's "İlan ekle" form filled with the page you are looking at. */
function bookmarklet() {
  const code = `(()=>{const s=String(getSelection()).trim();const d=s||(document.querySelector('meta[name=description]')||{}).content||'';window.open('${location.origin}/#/leads/new?u='+encodeURIComponent(location.href)+'&t='+encodeURIComponent(document.title)+'&d='+encodeURIComponent(d.slice(0,3000)),'_blank')})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

async function addSourceDialog({ platform = '', kind = 'page' } = {}, platforms) {
  const p = platforms[platform];
  const r = await modal({
    title: kind === 'rss' ? 'RSS beslemesi ekle' : `${p ? `${esc(p.label)}: ` : ''}Sayfa izle`,
    description: kind === 'rss' ? 'İş ilanı sitesinin RSS/Atom adresini yapıştırın.' : 'İlanların listelendiği sayfayı tarayıcınızda açın ve adres çubuğundaki adresi buraya yapıştırın. Kalfa her taramada bu sayfadaki yeni ilan bağlantılarını bulur.',
    submitText: 'Ekle',
    body: `<div class="form-grid">
      ${field('url', kind === 'rss' ? 'Besleme adresi' : 'Sayfa adresi', { required: true, placeholder: 'https://…', span: true, hint: p?.help || '' })}
      ${field('name', 'Ad (isteğe bağlı)', { placeholder: p ? `${p.label} — web tasarım ilanları` : 'ör. Web tasarım ilanları', span: true })}
      ${kind === 'page' ? field('link_pattern', 'Bağlantı filtresi (isteğe bağlı)', { placeholder: 'ör. /konu/ veya /ilan/', span: true, hint: 'Sadece adresinde bu metin geçen bağlantılar ilan sayılır. Boş bırakırsanız Kalfa başlığa benzeyen bağlantıları alır. Gelişmiş: /düzenli-ifade/' }) : ''}
      <input type="hidden" name="kind" value="${kind}"><input type="hidden" name="platform" value="${esc(platform)}"></div>`,
    onSubmit: (d) => POST('/sources', d),
  });
  if (r) {
    toast('Kaynak eklendi; "Dene" ile neler okunduğuna bakabilirsiniz');
    app.route();
  }
}

export async function viewSources(main, id) {
  const d = await GET('/sources');
  const visible = Object.entries(d.platforms).filter(([k]) => !['rss', 'web', 'manual'].includes(k));
  const byPlatform = (k) => d.sources.filter((s) => s.platform === k || (k === 'freelancer' && s.kind === 'freelancer_api'));

  main.innerHTML = `${pageHeader({
    title: 'Kaynaklar',
    subtitle: 'İş ilanlarının geldiği siteler. Herkese açık sayfalar otomatik taranır; giriş gerektiren sitelerdeki ilanları tek tıkla yer imiyle kaydedersiniz.',
    actions: `<button class="btn" id="addRss">${icon('rss', 'sm')} RSS ekle</button>
      <button class="btn" id="addPage">${icon('plus', 'sm')} Sayfa izle</button>
      <button class="btn primary" id="scanAll" ${d.scanning ? 'disabled' : ''}>${icon('refresh-cw', 'sm')} Hepsini tara</button>`,
  })}

  <div class="card bm-card">
    <div class="bm-text"><span class="tile-icon warn">${icon('bookmark')}</span><div>
      <h2>"Kalfa'ya ekle" yer imi</h2>
      <p>Bionluk, Armut gibi giriş gerektiren sitelerde ilanı açın ve bu yer imine tıklayın: ilan, adresi ve (seçtiyseniz) metniyle birlikte Kalfa'ya kaydedilir.</p>
      <ol class="small muted"><li>Tarayıcınızın yer imleri çubuğunu açın (Ctrl+Shift+B / ⌘+Shift+B).</li><li>Aşağıdaki düğmeyi sürükleyip yer imleri çubuğuna bırakın.</li><li>Bir ilanda açıklamayı fareyle seçip yer imine tıklayın.</li></ol></div></div>
    <a class="btn ai bm-link" href="${bookmarklet()}" draggable="true" id="bm" title="Yer imleri çubuğuna sürükleyin">${icon('bookmark-plus', 'sm')} Kalfa'ya ekle</a>
  </div>

  <h2 class="section-title">Siteler</h2>
  <div class="platform-grid">${visible.map(([k, p]) => {
    const [modeLabel, tone, ic] = MODE[p.mode];
    const mine = byPlatform(k);
    return `<article class="card platform-card">
      <div class="plc-head"><b>${esc(p.label)}</b><span class="pill ${tone}">${icon(ic, 'xs')} ${modeLabel}</span></div>
      <p class="small muted">${esc(p.help)}</p>
      <div class="plc-foot">
        ${mine.length ? `<span class="small">${icon('circle-check', 'xs')} ${mine.length} kaynak</span>` : '<span class="small muted">Eklenmedi</span>'}
        <span class="spacer"></span>
        ${p.home ? `<a class="btn sm ghost" href="${esc(p.home)}" target="_blank" rel="noopener">${icon('external-link', 'xs')} Siteyi aç</a>` : ''}
        ${p.mode === 'page' ? `<button class="btn sm" data-add="${k}">${icon('plus', 'xs')} Sayfa ekle</button>` : ''}
      </div></article>`;
  }).join('')}</div>

  <h2 class="section-title">Taranan kaynaklar</h2>
  <div class="card flush">${d.sources.length ? `<table class="table"><thead><tr><th>Kaynak</th><th>Son tarama</th><th></th><th class="num">İşlem</th></tr></thead><tbody>
    ${d.sources.map((s) => `<tr class="${s.enabled ? '' : 'muted'}">
      <td><div class="cell-title">${esc(s.name)}</div><small class="muted">${s.kind === 'freelancer_api' ? 'Freelancer.com API · anahtar kelimelerinizle arar' : `${s.kind === 'rss' ? 'RSS' : 'Sayfa'} · ${esc(s.url)}`}${s.link_pattern ? ` · filtre: <code>${esc(s.link_pattern)}</code>` : ''}</small></td>
      <td>${s.last_run_at ? `${ago(s.last_run_at)}<br><small class="${s.last_status === 'error' ? 'bad-text' : 'muted'}">${esc(s.last_message || '')}</small>` : '<span class="muted">Henüz taranmadı</span>'}</td>
      <td>${toggle(`en${s.id}`, Boolean(s.enabled), '', `id="en${s.id}" aria-label="Kaynağı aç/kapat"`)}</td>
      <td class="num"><div class="row-actions">
        <button class="btn sm ghost" data-test="${s.id}">${icon('flask-conical', 'xs')} Dene</button>
        <button class="btn sm ghost" data-scan="${s.id}">${icon('refresh-cw', 'xs')} Tara</button>
        <button class="icon-btn" data-del="${s.id}" title="Sil" aria-label="Sil">${icon('trash-2', 'sm')}</button></div></td></tr>`).join('')}</tbody></table>`
    : empty('Kaynak yok', 'Yukarıdan bir site için sayfa ekleyin veya RSS beslemesi girin.', 'globe')}</div>
  <p class="small muted">Taramalar "Otomasyonlar" sayfasındaki <b>İş ilanı taraması</b> göreviyle düzenli olarak çalışır. Sitelerin kullanım koşullarına uyun; Kalfa sayfaları seyrek ve kibarca okur.</p>`;

  $('#bm').onclick = (e) => { e.preventDefault(); toast('Bu düğmeyi yer imleri çubuğuna sürükleyin; ilan sitelerinde tıklayınca çalışır.'); };
  $('#addPage').onclick = () => addSourceDialog({ kind: 'page' }, d.platforms);
  $('#addRss').onclick = () => addSourceDialog({ kind: 'rss', platform: 'rss' }, d.platforms);
  $$('[data-add]').forEach((b) => { b.onclick = () => addSourceDialog({ kind: 'page', platform: b.dataset.add }, d.platforms); });
  $('#scanAll').onclick = (e) => busy(e.currentTarget, async () => {
    toast('Kaynaklar taranıyor…');
    const r = await act(() => POST('/leads/scan'));
    if (r) { toast(r.skipped ? 'Tarama zaten sürüyor' : `${r.fetched} ilan okundu · ${r.matched} yeni uygun ilan${r.errors.length ? ` · ${r.errors.length} kaynakta hata` : ''}`); app.route(); }
  });
  for (const s of d.sources) {
    $(`#en${s.id}`).onchange = (e) => act(() => PUT(`/sources/${s.id}`, { enabled: e.target.checked }), e.target.checked ? 'Kaynak açıldı' : 'Kaynak kapatıldı').then(() => app.route());
  }
  $$('[data-test]').forEach((b) => { b.onclick = () => busy(b, async () => {
    const r = await act(() => POST(`/sources/${b.dataset.test}/test`));
    if (!r) return;
    await modal({
      title: `${r.count} ilan bulundu`, description: 'Bu kaynaktan şu an okunabilen ilk ilanlar (kaydedilmedi). Alakasız bağlantılar varsa kaynağa bir bağlantı filtresi ekleyin.', submitText: 'Tamam',
      body: r.sample.length ? `<ul class="sample-list">${r.sample.map((x) => `<li><a href="${esc(x.url || '#')}" target="_blank" rel="noopener">${esc(x.title)}</a></li>`).join('')}</ul>` : '<p class="muted">Hiç ilan bulunamadı. Adresin ilan listesi olduğundan emin olun veya filtreyi değiştirin.</p>',
    });
  }); });
  $$('[data-scan]').forEach((b) => { b.onclick = () => busy(b, async () => {
    const r = await act(() => POST(`/sources/${b.dataset.scan}/scan`));
    if (r) { toast(r.errors.length ? r.errors[0] : `${r.fetched} ilan okundu · ${r.matched} yeni uygun`, r.errors.length ? 'error' : 'ok'); app.route(); }
  }); });
  $$('[data-del]').forEach((b) => { b.onclick = async () => {
    if (await confirmDialog('Kaynak silinsin mi?', 'Bu kaynaktan gelmiş ilanlar silinmez.', { danger: true, confirmText: 'Sil' })) {
      if (await act(() => DEL(`/sources/${b.dataset.del}`), 'Kaynak silindi')) app.route();
    }
  }; });
  if (id === 'new') addSourceDialog({ kind: 'page' }, d.platforms);
}
