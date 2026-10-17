// Customers and catalog (products / themes / languages).
import {
  $, $$, DEL, GET, POST, PUT, act, ago, app, avatar, confirmDialog, empty, esc, field, icon, isAdmin, liveFilter, modal, money,
  onSegment, pageHeader, searchBox, segmented,
} from '../core.js';
import { resetShortcuts } from './conversations.js';

export async function viewCustomers(main) {
  const list = await GET('/customers');
  const paid = list.reduce((a, c) => a + c.total_paid, 0);
  main.innerHTML = `${pageHeader({
    title: 'Müşteriler',
    subtitle: `${list.length} müşteri · toplam ${money(paid)} tahsilat`,
    actions: isAdmin() ? `<a class="btn" href="/api/export/customers.csv">${icon('download', 'sm')} CSV</a>` : '',
  })}
  <div class="toolbar">${searchBox('İsim, telefon veya e-posta ara…')}</div>
  ${list.length ? `<div class="card flush"><table class="table"><thead><tr><th>Müşteri</th><th>İletişim</th><th>Kaynak</th><th class="num">Proje</th><th class="num">Ödenen</th><th>Kayıt</th></tr></thead><tbody>
    ${list.map((c) => `<tr><td><div class="cell-user">${avatar(c.name)}<div><div class="cell-title">${esc(c.name)}</div><div class="muted small">#${c.id}</div></div></div></td>
      <td><div class="small">${c.phone ? `${icon('phone', 'xs')} ${esc(c.phone)}` : ''}</div><div class="small muted">${c.email ? `${icon('mail', 'xs')} ${esc(c.email)}` : ''}</div>${!c.phone && !c.email ? '<span class="muted">—</span>' : ''}</td>
      <td>${c.platform ? `<span class="tag">${esc(c.platform)}</span>` : '<span class="muted">Doğrudan</span>'}</td>
      <td class="num">${c.project_count}</td><td class="num mono">${c.total_paid ? money(c.total_paid) : '—'}</td><td class="muted">${ago(c.created_at)}</td></tr>`).join('')}
    </tbody></table><div data-no-results hidden class="muted center pad">Eşleşen müşteri yok</div></div>`
    : empty('Henüz müşteri yok', 'WhatsApp, web sohbeti veya iş ilanlarından gelen kişiler otomatik olarak müşteri olur.', 'users')}`;
  liveFilter($('#q'), 'tbody tr', main);
}

const CATALOG = {
  products: { title: 'Ürünler', icon: 'package', fields: [['name', 'Ürün adı', { required: true, span: true }], ['category', 'Kategori'], ['price', 'Fiyat', { type: 'number', required: true }], ['currency', 'Para birimi', { value: 'TRY' }], ['demo_url', 'Örnek / demo bağlantısı'], ['image_url', 'Görsel bağlantısı'], ['description', 'Açıklama', { type: 'textarea', span: true }], ['features', 'Özellikler', { type: 'textarea', span: true, hint: 'Yapay zeka müşteriye bunları anlatır.' }]] },
  themes: { title: 'Temalar', icon: 'sparkles', fields: [['name', 'Tema adı', { required: true, span: true }], ['preview_url', 'Önizleme bağlantısı', { span: true }], ['description', 'Kısa açıklama', { type: 'textarea', span: true, rows: 2 }], ['style_guide', 'Stil rehberi', { type: 'textarea', span: true, hint: 'Renkler, yazı tipleri, düzen. Yapay zeka siteyi üretirken uygular.' }]] },
  languages: { title: 'Teknolojiler', icon: 'cpu', fields: [['name', 'Ad', { required: true, span: true }], ['description', 'Açıklama', { type: 'textarea', span: true, rows: 3 }]] },
};

export async function viewCatalog(main) {
  const tab = sessionStorage.getItem('catTab') || 'products';
  const cfg = CATALOG[tab];
  const rows = (await GET(`/${tab}`)).filter((r) => r.active);

  const card = (r) => {
    if (tab === 'products') {
      return `<article class="product-card" data-id="${r.id}">
        <div class="pc-visual">${r.image_url ? `<img src="${esc(r.image_url)}" alt="" loading="lazy">` : icon('package', 'lg')}${r.category ? `<span class="tag">${esc(r.category)}</span>` : ''}</div>
        <div class="pc-body"><h3>${esc(r.name)}</h3><p>${esc(r.description || '')}</p>
          ${r.features ? `<ul class="pc-feats">${r.features.split(/[,\n]/).filter((x) => x.trim()).slice(0, 4).map((f) => `<li>${icon('check', 'xs')} ${esc(f.trim())}</li>`).join('')}</ul>` : ''}</div>
        <div class="pc-foot"><div class="pc-price">${money(r.price)} <small>${esc(r.currency)}</small></div>
          ${r.demo_url ? `<a class="icon-btn" href="${esc(r.demo_url)}" target="_blank" rel="noopener" title="Örnek" aria-label="Örnek">${icon('external-link', 'sm')}</a>` : ''}
          <button class="icon-btn" data-edit="${r.id}" title="Düzenle" aria-label="Düzenle">${icon('pencil', 'sm')}</button>
          <button class="icon-btn danger" data-del="${r.id}" title="Sil" aria-label="Sil">${icon('trash-2', 'sm')}</button></div></article>`;
    }
    return `<article class="mini-card" data-id="${r.id}"><span class="tile-icon ${tab === 'themes' ? 'accent' : 'info'}">${icon(cfg.icon)}</span>
      <div><h3>${esc(r.name)}</h3><p>${esc(r.description || r.style_guide || '')}</p>${r.preview_url ? `<a href="${esc(r.preview_url)}" target="_blank" rel="noopener" class="small">${icon('external-link', 'xs')} Önizleme</a>` : ''}</div>
      <div class="mc-actions"><button class="icon-btn" data-edit="${r.id}" aria-label="Düzenle">${icon('pencil', 'sm')}</button><button class="icon-btn danger" data-del="${r.id}" aria-label="Sil">${icon('trash-2', 'sm')}</button></div></article>`;
  };

  main.innerHTML = `${pageHeader({
    title: 'Katalog',
    subtitle: 'Yapay zeka satış yaparken fiyatları buradan verir; temalar ve teknolojiler sohbette kısayol olarak çıkar.',
    actions: `<button class="btn primary" id="add">${icon('plus', 'sm')} ${tab === 'products' ? 'Ürün ekle' : tab === 'themes' ? 'Tema ekle' : 'Teknoloji ekle'}</button>`,
  })}
  <div class="toolbar">${segmented('cat', Object.entries(CATALOG).map(([k, v]) => [k, `${icon(v.icon, 'sm')} ${v.title}`]), tab)}<span class="spacer"></span>${searchBox('Ara…')}</div>
  ${rows.length ? `<div class="${tab === 'products' ? 'product-grid' : 'card-grid'}">${rows.map(card).join('')}<div data-no-results hidden class="muted">Eşleşme yok</div></div>`
    : empty(`Henüz ${cfg.title.toLocaleLowerCase('tr')} yok`, 'Eklediğiniz kayıtları yapay zeka hemen kullanmaya başlar.', cfg.icon, '<button class="btn primary" id="add2">Ekle</button>')}`;

  onSegment(main, 'cat', (v) => { sessionStorage.setItem('catTab', v); app.route(); });
  liveFilter($('#q'), '.product-card, .mini-card', main);
  const edit = async (r = {}) => {
    const ok = await modal({
      title: r.id ? `${esc(r.name)} · düzenle` : { products: 'Yeni ürün', themes: 'Yeni tema', languages: 'Yeni teknoloji' }[tab],
      submitText: r.id ? 'Kaydet' : 'Ekle', wide: tab === 'products',
      body: `<div class="form-grid">${cfg.fields.map(([k, l, o = {}]) => field(k, l, { ...o, value: r[k] ?? o.value ?? '' })).join('')}</div>`,
      onSubmit: (d) => {
        if (d.price !== undefined) d.price = Number(d.price || 0);
        return r.id ? PUT(`/${tab}/${r.id}`, d) : POST(`/${tab}`, d);
      },
    });
    if (ok) { resetShortcuts(); app.route(); }
  };
  $('#add').onclick = () => edit();
  $('#add2')?.addEventListener('click', () => edit());
  $$('[data-edit]').forEach((b) => { b.onclick = () => edit(rows.find((x) => String(x.id) === b.dataset.edit)); });
  $$('[data-del]').forEach((b) => { b.onclick = async () => {
    const r = rows.find((x) => String(x.id) === b.dataset.del);
    if (await confirmDialog(`"${r.name}" silinsin mi?`, 'Yapay zeka artık bu kaydı önermeyecek. Geçmiş projeler etkilenmez.', { danger: true, confirmText: 'Sil' })) {
      act(() => DEL(`/${tab}/${r.id}`), 'Silindi').then(() => { resetShortcuts(); app.route(); });
    }
  }; });
}
