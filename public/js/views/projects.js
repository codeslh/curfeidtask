import {
  $, $$, GET, POST, PUT, act, ago, app, avatar, busy, confirmDialog, date, empty, esc, field, icon, liveFilter, modal, money,
  onSegment, pageHeader, pill, searchBox, segmented, store, toast,
} from '../core.js';

const COLUMNS = [
  ['Geliştirme', 'cpu', ['won', 'building', 'revision', 'build_failed']],
  ['Kontrol', 'eye', ['review', 'approved']],
  ['Demo', 'rocket', ['demo_live', 'changes_requested']],
  ['Ödeme', 'credit-card', ['customer_approved', 'awaiting_payment', 'paid']],
  ['Teslim', 'package', ['delivered']],
];

async function newProjectDialog() {
  const [customers, info] = await Promise.all([GET('/customers'), fetch('/api/chat/info').then((r) => r.json())]);
  if (!customers.length) { toast('Önce bir müşteri olmalı (bir konuşma veya ilan üzerinden oluşur)', 'error'); return; }
  const r = await modal({
    title: 'Yeni proje', description: 'Oluşturduğunuz anda yapay zeka geliştirmeye başlar.', submitText: 'Oluştur ve başlat', wide: true,
    body: `<div class="form-grid">
      ${field('title', 'Proje adı', { required: true, span: true, placeholder: 'Örn. Kafe tanıtım sitesi' })}
      ${field('customer_id', 'Müşteri', { options: customers.map((c) => [c.id, c.name]) })}
      ${field('price', 'Fiyat', { type: 'number', required: true })}
      ${field('theme_id', 'Tema', { options: [['', 'Seçilmedi'], ...info.shortcuts.themes.map((t) => [t.id, t.name])] })}
      ${field('language_id', 'Dil / teknoloji', { options: [['', 'Seçilmedi'], ...info.shortcuts.languages.map((l) => [l.id, l.name])] })}
      ${field('currency', 'Para birimi', { value: 'TRY' })}
      ${field('requirements', 'Gereksinimler', { type: 'textarea', span: true, rows: 6, placeholder: 'Sayfalar, özellikler, renkler, örnek siteler…' })}</div>`,
    onSubmit: (d) => POST('/projects', d),
  });
  if (r) { toast('Proje oluşturuldu'); location.hash = `#/projects/${r.id}`; }
}

export async function viewProjects(main, id) {
  if (id === 'new') { location.hash = '#/projects'; setTimeout(newProjectDialog, 50); return; }
  if (id) return viewProject(main, id);
  const view = store.get('projectsView', 'board');
  const list = await GET('/projects');
  const active = list.filter((p) => p.status !== 'cancelled');

  main.innerHTML = `${pageHeader({
    title: 'Projeler',
    subtitle: `${active.length} aktif proje · yapay zeka geliştirir, siz onaylarsınız.`,
    actions: `${segmented('pview', [['board', `${icon('layout-grid', 'sm')} Pano`], ['list', `${icon('list', 'sm')} Liste`]], view)}
      <button class="btn primary" id="new">${icon('plus', 'sm')} Yeni proje</button>`,
  })}
  <div class="toolbar">${searchBox('Proje veya müşteri ara…')}</div>
  ${!list.length ? empty('Henüz proje yok', 'Yapay zeka bir müşteriyle anlaştığında veya bir ilanı "İşi aldım" olarak işaretlediğinizde projeler burada görünür.', 'folder-kanban', '<button class="btn primary" id="new2">Yeni proje</button>')
    : view === 'board' ? `<div class="board">${COLUMNS.map(([title, ic, st]) => {
      const items = active.filter((p) => st.includes(p.status));
      return `<section class="board-col"><header><span>${icon(ic, 'sm')} ${title}</span><span class="count">${items.length}</span></header>
        <div class="board-items">${items.map((p) => `<a class="board-card ${p.status === 'build_failed' ? 'fail' : ''}" href="#/projects/${p.id}">
          <div class="bc-top">${pill(p.status)}<span class="muted small">v${p.current_version}</span></div>
          <b>${esc(p.title)}</b>
          <div class="bc-foot">${avatar(p.customer_name || '?', 'xs')}<span>${esc(p.customer_name || '—')}</span><span class="spacer"></span><b class="mono">${money(p.price, p.currency)}</b></div>
          ${['building', 'revision'].includes(p.status) ? '<div class="bc-progress"><span></span></div>' : ''}
        </a>`).join('') || '<div class="board-empty">Boş</div>'}</div></section>`;
    }).join('')}</div>`
      : `<div class="card flush"><table class="table"><thead><tr><th>Proje</th><th>Müşteri</th><th>Durum</th><th class="num">Fiyat</th><th class="num">Sürüm</th><th>Güncelleme</th></tr></thead><tbody>
      ${list.map((p) => `<tr class="clickable" data-href="#/projects/${p.id}"><td><div class="cell-title">${esc(p.title)}</div></td><td><div class="cell-user">${avatar(p.customer_name || '?', 'xs')}${esc(p.customer_name || '—')}</div></td>
        <td>${pill(p.status)}</td><td class="num mono">${money(p.price, p.currency)}</td><td class="num">v${p.current_version}</td><td class="muted">${ago(p.updated_at)}</td></tr>`).join('')}</tbody></table></div>`}
  <div data-no-results hidden class="muted center pad">Eşleşen proje yok</div>`;

  onSegment(main, 'pview', (v) => { store.set('projectsView', v); app.route(); });
  liveFilter($('#q'), '.board-card, tbody tr', main);
  $('#new').onclick = newProjectDialog;
  $('#new2')?.addEventListener('click', newProjectDialog);
  $$('tr[data-href]').forEach((tr) => { tr.onclick = () => { location.hash = tr.dataset.href; }; });
}

const STEPS = [
  ['İş alındı', 'briefcase', ['won']],
  ['Geliştirme', 'cpu', ['building', 'build_failed', 'revision']],
  ['Kontrol', 'eye', ['review', 'approved']],
  ['Demo', 'rocket', ['demo_live', 'changes_requested']],
  ['Onay', 'circle-check', ['customer_approved']],
  ['Ödeme', 'credit-card', ['awaiting_payment', 'paid']],
  ['Teslim', 'package', ['delivered']],
];

/** What the admin should do next, per status. */
const NEXT = {
  won: ['Yapay zeka başlamak üzere', 'Geliştirme birazdan başlayacak.'],
  building: ['Yapay zeka geliştiriyor', 'Plan hazırlanıyor ve dosyalar üretiliyor. Bitince size haber vereceğiz.'],
  revision: ['Düzeltmeler uygulanıyor', 'Yapay zeka notlarınıza göre yeni sürüm üretiyor.'],
  build_failed: ['Geliştirme başarısız oldu', 'Geçmişteki hata mesajına bakın; gerekirse "Yeniden üret"e basın.'],
  review: ['Kontrolünüzü bekliyor', 'Önizlemeyi açın. Beğendiyseniz onaylayın, değilse düzeltme notu yazın.'],
  approved: ['Yayına hazır', 'Demoyu yayınlayıp müşteriye gönderin.'],
  demo_live: ['Müşteri inceliyor', 'Müşteri beğenirse ödeme bilgileri otomatik gönderilecek.'],
  changes_requested: ['Müşteri değişiklik istedi', 'İstekleri düzeltme notu olarak yapay zekaya iletin.'],
  customer_approved: ['Müşteri onayladı', 'Ödeme talebi gönderilecek.'],
  awaiting_payment: ['Ödeme bekleniyor', 'Ödeme gelince "Ödemeler" sayfasından onaylayın; hatırlatmalar otomatik gider.'],
  paid: ['Ödeme alındı', 'Projeyi teslim edebilirsiniz.'],
  delivered: ['Tamamlandı', 'Proje teslim edildi.'],
  cancelled: ['İptal edildi', ''],
};

async function viewProject(main, id) {
  const d = await GET(`/projects/${id}`);
  const p = d.project;
  const can = (...s) => s.includes(p.status);
  const at = STEPS.findIndex(([, , st]) => st.includes(p.status));
  const [nextTitle, nextText] = NEXT[p.status] || ['', ''];
  const latest = d.versions[0];

  main.innerHTML = `<a href="#/projects" class="back-link">${icon('arrow-left', 'sm')} Projeler</a>
  ${pageHeader({
    title: esc(p.title),
    subtitle: `${esc(p.customer_name || '—')} · ${money(p.price, p.currency)} · güncellendi ${ago(p.updated_at)}`,
    actions: `${latest ? `<a class="btn" target="_blank" rel="noopener" href="${esc(latest.preview_url)}">${icon('eye', 'sm')} Önizle v${latest.version}</a>` : ''}
      ${p.demo_url ? `<a class="btn" target="_blank" rel="noopener" href="${esc(p.demo_url)}">${icon('globe', 'sm')} Canlı demo</a>` : ''}`,
  })}
  ${p.demo_url && /^https?:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.)/.test(p.demo_url) ? `<div class="callout warn">${icon('triangle-alert', 'sm')}<span>Demo adresi bu bilgisayara ait (<code>${esc(p.demo_url)}</code>); müşteri açamaz. <code>.env</code> dosyasına <b>NETLIFY_TOKEN</b> ekleyip demoyu yeniden yayınlayın ya da adresi ngrok / Cloudflare Tunnel ile internete açın.</span></div>` : ''}
  ${p.status === 'cancelled' ? '' : `<ol class="steps">${STEPS.map(([l, ic], i) => {
    const state = p.status === 'delivered' || i < at ? 'done' : i === at ? (p.status === 'build_failed' ? 'fail' : 'now') : '';
    return `<li class="${state}"><span class="dot">${icon(state === 'done' ? 'check' : ic, 'xs')}</span><span>${l}</span></li>`;
  }).join('')}</ol>`}

  <div class="split">
    <div class="split-main">
      <div class="card next-card ${p.status}">
        <div class="next-icon">${d.building ? '<span class="spinner"></span>' : icon(p.status === 'build_failed' ? 'triangle-alert' : 'zap')}</div>
        <div class="next-body"><span class="eyebrow">Sıradaki adım</span><h2>${nextTitle}</h2><p>${nextText}</p>
          <div class="row">
            ${can('review') ? `<button class="btn primary" id="approve">${icon('check', 'sm')} Sürümü onayla</button>` : ''}
            ${can('approved', 'demo_live', 'changes_requested') && p.current_version ? `<button class="btn primary" id="deploy">${icon('rocket', 'sm')} Demoyu yayınla & gönder</button>` : ''}
            ${can('demo_live') ? `<button class="btn" id="custok">${icon('circle-check', 'sm')} Müşteri onayladı</button>` : ''}
            ${can('customer_approved', 'demo_live', 'approved') ? `<button class="btn" id="payreq">${icon('credit-card', 'sm')} Ödeme talebi gönder</button>` : ''}
            ${can('paid') ? `<button class="btn primary" id="deliver">${icon('package', 'sm')} Teslim et</button>` : ''}
            ${can('build_failed', 'review', 'approved', 'won') && !d.building ? `<button class="btn" id="rebuild">${icon('refresh-cw', 'sm')} Yeniden üret</button>` : ''}
          </div></div>
      </div>

      <div class="card ai-card">
        <div class="card-head"><div><h2>${icon('wand-sparkles', 'sm')} Yapay zekaya düzeltme gönder</h2><p>Ne değişsin? Yapay zeka mevcut sürümü temel alıp yeni bir sürüm üretir.</p></div></div>
        <form id="fb" class="ai-prompt"><textarea name="feedback" rows="3" placeholder="Örn. Başlığı büyüt, iletişim formuna telefon alanı ekle, renkleri daha koyu yap…" ${d.building ? 'disabled' : ''}></textarea>
          <button class="btn ai" ${d.building ? 'disabled' : ''}>${icon('sparkles', 'sm')} Gönder</button></form>
      </div>

      <div class="card flush">
        <div class="card-head pad"><div><h2>Sürümler</h2><p>${d.versions.length} sürüm üretildi</p></div></div>
        ${d.versions.length ? `<ul class="versions">${d.versions.map((v, i) => `<li>
          <span class="v-badge ${i === 0 ? 'current' : ''}">v${v.version}</span>
          <div class="v-body"><b>${esc(v.summary)}</b>${v.feedback ? `<p>${icon('pencil', 'xs')} ${esc(v.feedback)}</p>` : ''}<span class="muted small">${date(v.created_at)} · ${v.file_count} dosya</span></div>
          <a class="btn sm" target="_blank" rel="noopener" href="${esc(v.preview_url)}">${icon('eye', 'xs')} Önizle</a></li>`).join('')}</ul>` : empty('Henüz sürüm yok', 'Yapay zeka ilk sürümü üretince burada görünecek.', 'cpu')}
        ${d.files.length ? `<details class="files"><summary>${icon('file-text', 'sm')} Dosyalar (${d.files.length})</summary><div class="file-list">${d.files.map((f) => `<a href="/api/projects/${p.id}/files/${f.path.split('/').map(encodeURIComponent).join('/')}" target="_blank">${icon('file-text', 'xs')} ${esc(f.path)}<span>${(f.size / 1024).toFixed(1)} KB</span></a>`).join('')}</div></details>` : ''}
      </div>

      <div class="card">
        <div class="card-head"><div><h2>Gereksinimler</h2><p>Yapay zekanın üretimde kullandığı brif</p></div></div>
        <form id="req" class="stack"><textarea name="requirements" rows="6">${esc(p.requirements)}</textarea><div><button class="btn sm">Kaydet</button></div></form>
      </div>
    </div>

    <aside class="split-side">
      <div class="card">
        <h2 class="h-xs">Detaylar</h2>
        <dl class="info-list">
          <div><dt>Durum</dt><dd>${pill(p.status)}</dd></div>
          <div><dt>Müşteri</dt><dd>${p.conversation_id ? `<a href="#/conversations/${p.conversation_id}">${esc(p.customer_name || '—')}</a>` : esc(p.customer_name || '—')}</dd></div>
          <div><dt>Fiyat</dt><dd class="mono">${money(p.price, p.currency)}</dd></div>
          <div><dt>Tema</dt><dd>${esc(p.theme_name || '—')}</dd></div>
          <div><dt>Teknoloji</dt><dd>${esc(p.language_name || '—')}</dd></div>
          <div><dt>Sürüm</dt><dd>v${p.current_version}</dd></div>
          <div><dt>Oluşturma</dt><dd>${date(p.created_at)}</dd></div>
        </dl>
      </div>
      <div class="card">
        <h2 class="h-xs">Ödemeler</h2>
        ${d.payments.map((pay) => `<div class="mini-row"><span class="mono">${esc(pay.reference)}</span><span class="spacer"></span>${money(pay.amount, pay.currency)} ${pill(pay.status)}</div>`).join('') || '<p class="muted small">Henüz ödeme talebi yok.</p>'}
      </div>
      <div class="card">
        <h2 class="h-xs">Geçmiş</h2>
        <ol class="timeline">${d.events.map((e) => `<li><span class="tl-dot ${e.type}"></span><div><p>${esc(e.message)}</p><time>${ago(e.created_at)}</time></div></li>`).join('')}</ol>
      </div>
      ${p.status !== 'cancelled' ? `<button class="btn danger-ghost block" id="cancel">${icon('x', 'sm')} Projeyi iptal et</button>` : ''}
    </aside>
  </div>`;

  const bind = (sel, fn, msg) => { const el = $(sel); if (el) el.onclick = () => busy(el, () => act(fn, msg)).then((r) => r && app.route()); };
  bind('#approve', () => POST(`/projects/${id}/approve`), 'Sürüm onaylandı');
  bind('#deploy', () => POST(`/projects/${id}/deploy`), 'Demo yayınlandı ve müşteriye gönderildi');
  bind('#custok', () => POST(`/projects/${id}/customer-approved`), 'Müşteri onayı kaydedildi');
  bind('#payreq', () => POST(`/projects/${id}/payment-request`), 'Ödeme bilgileri müşteriye gönderildi');
  bind('#deliver', () => POST(`/projects/${id}/deliver`), 'Proje teslim edildi');
  bind('#rebuild', () => POST(`/projects/${id}/rebuild`), 'Yeniden üretim başladı');
  $('#cancel')?.addEventListener('click', async () => {
    if (await confirmDialog('Proje iptal edilsin mi?', 'Bu işlem geri alınamaz; yapay zeka bu proje üzerinde çalışmayı bırakır.', { danger: true, confirmText: 'İptal et' })) {
      act(() => POST(`/projects/${id}/cancel`), 'Proje iptal edildi').then(app.route);
    }
  });
  $('#fb').onsubmit = (e) => {
    e.preventDefault();
    const fb = e.target.feedback.value.trim();
    if (!fb) return;
    busy($('button', e.target), () => act(() => POST(`/projects/${id}/feedback`, { feedback: fb }), 'Düzeltme yapay zekaya gönderildi')).then((r) => r && app.route());
  };
  $('#req').onsubmit = (e) => { e.preventDefault(); act(() => PUT(`/projects/${id}`, Object.fromEntries(new FormData(e.target))), 'Gereksinimler kaydedildi'); };
  if (d.building) app.poll = setInterval(async () => { const x = await GET(`/projects/${id}`).catch(() => null); if (x && !x.building) app.route(); }, 3000);
}

