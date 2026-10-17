// Payments, invoices, refunds and expenses.
import {
  $, $$, DEL, GET, POST, act, ago, app, confirmDialog, date, empty, esc, field, icon, isAdmin, liveFilter, modal, money,
  onSegment, pageHeader, pill, searchBox, segmented,
} from '../core.js';

export async function viewPayments(main) {
  const tab = sessionStorage.getItem('payTab') || 'payments';
  const [payments, invoices] = await Promise.all([GET('/payments'), GET('/invoices')]);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const collected = sum(payments.filter((p) => p.paid_at && new Date(p.paid_at) >= monthStart), (p) => p.amount);
  const pending = payments.filter((p) => p.status === 'pending');
  const refunded = sum(payments, (p) => p.refunded_amount);
  const csv = (t, l) => (isAdmin() ? `<a class="btn" href="/api/export/${t}.csv">${icon('download', 'sm')} ${l}</a>` : '');

  main.innerHTML = `${pageHeader({
    title: 'Ödemeler',
    subtitle: 'Müşteri onaylayınca IBAN bilgisi otomatik gider; ödeme gelince buradan onaylarsınız.',
    actions: `${csv('payments', 'Ödemeler CSV')}${csv('invoices', 'Faturalar CSV')}`,
  })}
  <section class="bento">
    <div class="card kpi span-4"><div class="kpi-top"><span class="tile-icon good">${icon('banknote')}</span><span class="kpi-label">Bu ay tahsil edilen</span></div><div class="kpi-value">${money(collected)} <small>TRY</small></div></div>
    <div class="card kpi span-4"><div class="kpi-top"><span class="tile-icon warn">${icon('clock')}</span><span class="kpi-label">Bekleyen ödeme</span></div><div class="kpi-value">${money(sum(pending, (p) => p.amount))} <small>TRY</small></div><div class="kpi-sub">${pending.length} ödeme talebi</div></div>
    <div class="card kpi span-4"><div class="kpi-top"><span class="tile-icon bad">${icon('hand-coins')}</span><span class="kpi-label">Toplam iade</span></div><div class="kpi-value">${money(refunded)} <small>TRY</small></div></div>
  </section>
  <div class="toolbar">${segmented('pay', [['payments', 'Ödeme geçmişi', payments.length], ['invoices', 'Faturalar', invoices.length]], tab)}<span class="spacer"></span>${searchBox('Referans, müşteri veya proje ara…')}</div>
  <div class="card flush">
  ${tab === 'payments' ? (payments.length ? `<table class="table"><thead><tr><th>Referans</th><th>Müşteri</th><th>Yöntem</th><th class="num">Tutar</th><th>Durum</th><th>Tarih</th><th></th></tr></thead><tbody>
    ${payments.map((p) => `<tr><td><span class="mono">${esc(p.reference)}</span>${p.invoice_number ? `<div class="muted small">${esc(p.invoice_number)}</div>` : ''}</td>
      <td><div class="cell-title">${esc(p.customer_name || '—')}</div><div class="muted small">${esc(p.project_title || '')}</div></td>
      <td>${p.method === 'iban' ? `${icon('banknote', 'xs')} Havale/EFT` : `${icon('credit-card', 'xs')} Kart`}</td>
      <td class="num"><b class="mono">${money(p.amount, p.currency)}</b>${p.refunded_amount ? `<div class="small bad-text">−${money(p.refunded_amount, p.currency)} iade</div>` : ''}</td>
      <td>${pill(p.status)}</td><td class="muted small">${p.paid_at ? `Ödendi ${ago(p.paid_at)}` : `Oluşturuldu ${ago(p.created_at)}`}</td>
      <td><div class="row-actions">
        ${p.status === 'pending' ? `<button class="btn sm primary" data-paid="${p.id}">${icon('check', 'xs')} Ödendi</button><button class="icon-btn" data-cancel="${p.id}" title="İptal" aria-label="İptal">${icon('x', 'sm')}</button>` : ''}
        ${['paid', 'partially_refunded'].includes(p.status) ? `<button class="btn sm danger-ghost" data-refund="${p.id}">${icon('hand-coins', 'xs')} İade</button>` : ''}
        ${p.checkout_url ? `<a class="icon-btn" href="${esc(p.checkout_url)}" target="_blank" rel="noopener" title="Ödeme linki" aria-label="Ödeme linki">${icon('external-link', 'sm')}</a>` : ''}</div></td></tr>`).join('')}
    </tbody></table>` : empty('Henüz ödeme yok', 'Müşteri demoyu onayladığında ödeme talebi otomatik oluşur.', 'wallet'))
    : (invoices.length ? `<table class="table"><thead><tr><th>Fatura no</th><th>Müşteri</th><th class="num">Ara toplam</th><th class="num">KDV</th><th class="num">Toplam</th><th>Tarih</th><th></th></tr></thead><tbody>
    ${invoices.map((i) => `<tr><td><span class="mono">${esc(i.number)}</span> ${i.kind === 'refund' ? '<span class="tag bad">İade</span>' : ''}</td>
      <td><div class="cell-title">${esc(i.customer_name || '—')}</div><div class="muted small">${esc(i.project_title || '')}</div></td>
      <td class="num mono">${money(i.subtotal, i.currency)}</td><td class="num mono muted">${money(i.tax_amount, i.currency)} <small>(%${i.tax_rate})</small></td>
      <td class="num"><b class="mono">${money(i.total, i.currency)}</b></td><td class="muted small">${date(i.issued_at)}</td>
      <td><a class="btn sm" href="/api/invoices/${i.id}/pdf" target="_blank">${icon('file-text', 'xs')} PDF</a></td></tr>`).join('')}
    </tbody></table>` : empty('Henüz fatura yok', 'Ödeme onaylandığında fatura otomatik kesilir.', 'file-text'))}
    <div data-no-results hidden class="muted center pad">Eşleşme yok</div></div>`;

  onSegment(main, 'pay', (v) => { sessionStorage.setItem('payTab', v); app.route(); });
  liveFilter($('#q'), 'tbody tr', main);
  $$('[data-paid]').forEach((b) => { b.onclick = async () => {
    const p = payments.find((x) => String(x.id) === b.dataset.paid);
    if (await confirmDialog('Ödeme hesabınıza geldi mi?', `${p.reference} · ${money(p.amount, p.currency)}. Onaylayınca fatura kesilir ve müşteriye bilgi gider.`, { confirmText: 'Evet, ödendi' })) {
      act(() => POST(`/payments/${p.id}/mark-paid`), 'Ödeme kaydedildi, fatura oluşturuldu').then(app.route);
    }
  }; });
  $$('[data-cancel]').forEach((b) => { b.onclick = async () => {
    if (await confirmDialog('Ödeme talebi iptal edilsin mi?', '', { danger: true, confirmText: 'İptal et' })) act(() => POST(`/payments/${b.dataset.cancel}/cancel`)).then(app.route);
  }; });
  $$('[data-refund]').forEach((b) => { b.onclick = async () => {
    const p = payments.find((x) => String(x.id) === b.dataset.refund);
    const max = Math.round((p.amount - p.refunded_amount) * 100) / 100;
    const ok = await modal({
      title: 'İade yap', description: `${p.reference} · iade edilebilir: ${money(max, p.currency)}`, submitText: 'İadeyi onayla', danger: true,
      body: `<div class="form-grid">${field('amount', 'Tutar', { type: 'number', value: max, required: true })}${field('reason', 'Sebep', { placeholder: 'Örn. Gecikme telafisi' })}</div>
        ${p.method === 'iban' ? `<div class="callout warn">${icon('triangle-alert', 'sm')} Havale ile alınan ödemelerde parayı bankanızdan siz göndermelisiniz; sistem kaydı ve iade belgesini oluşturur.</div>` : ''}`,
      onSubmit: (d) => POST(`/payments/${p.id}/refund`, { amount: Number(d.amount), reason: d.reason }),
    });
    if (ok) app.route();
  }; });
}

const CATS = { hosting: ['Sunucu / hosting', 'globe'], ads: ['Reklam', 'target'], software: ['Yazılım / abonelik', 'package'], ai: ['Yapay zeka', 'cpu'], other: ['Diğer', 'receipt'] };

export async function viewExpenses(main) {
  const [expenses, usage] = await Promise.all([GET('/expenses'), GET('/ai-usage')]);
  const byCat = Object.fromEntries(Object.keys(CATS).map((k) => [k, expenses.filter((e) => e.category === k).reduce((a, e) => a + e.amount, 0)]));
  const aiUsd = usage.reduce((a, u) => a + u.cost_usd, 0);
  const tokens = usage.reduce((a, u) => a + u.input_tokens + u.output_tokens, 0);
  main.innerHTML = `${pageHeader({
    title: 'Giderler',
    subtitle: 'Yapay zeka maliyeti otomatik eklenir; diğer giderleri elle girin.',
    actions: `${isAdmin() ? `<a class="btn" href="/api/export/expenses.csv">${icon('download', 'sm')} CSV</a>` : ''}<button class="btn primary" id="add">${icon('plus', 'sm')} Gider ekle</button>`,
  })}
  <section class="bento">
    <div class="card kpi span-3 ai-card"><div class="kpi-top"><span class="tile-icon accent">${icon('cpu')}</span><span class="kpi-label">Yapay zeka (30 gün)</span></div><div class="kpi-value">$${aiUsd.toFixed(2)}</div><div class="kpi-sub">${tokens.toLocaleString('tr-TR')} token</div></div>
    ${['hosting', 'ads', 'software'].map((k) => `<div class="card kpi span-3"><div class="kpi-top"><span class="tile-icon neutral">${icon(CATS[k][1])}</span><span class="kpi-label">${CATS[k][0]}</span></div><div class="kpi-value">${money(byCat[k])} <small>TRY</small></div></div>`).join('')}
  </section>
  <div class="split even">
    <div class="card flush"><div class="card-head pad"><div><h2>Gider kayıtları</h2></div></div>
      ${expenses.length ? `<table class="table"><thead><tr><th>Gider</th><th>Kategori</th><th class="num">Tutar</th><th>Tarih</th><th></th></tr></thead><tbody>
      ${expenses.map((e) => `<tr><td class="cell-title">${esc(e.description || '—')}</td><td><span class="tag">${icon(CATS[e.category]?.[1] || 'receipt', 'xs')} ${CATS[e.category]?.[0] || esc(e.category)}</span></td>
        <td class="num mono">${money(e.amount, e.currency)}</td><td class="muted small">${ago(e.created_at)}</td><td><button class="icon-btn danger" data-del="${e.id}" aria-label="Sil">${icon('trash-2', 'sm')}</button></td></tr>`).join('')}</tbody></table>`
    : empty('Gider yok', 'Sunucu, reklam, abonelik gibi giderlerinizi ekleyin; kâr hesabı buna göre yapılır.', 'receipt')}</div>
    <div class="card flush"><div class="card-head pad"><div><h2>Yapay zeka kullanımı</h2><p>Son 30 gün, amaç bazında</p></div></div>
      ${usage.length ? `<table class="table"><thead><tr><th>Gün</th><th>Amaç</th><th class="num">Token</th><th class="num">USD</th></tr></thead><tbody>
      ${usage.map((u) => `<tr><td class="muted small">${u.day}</td><td><span class="tag accent">${esc(u.purpose)}</span></td><td class="num mono">${(u.input_tokens + u.output_tokens).toLocaleString('tr-TR')}</td><td class="num mono">${u.cost_usd}</td></tr>`).join('')}</tbody></table>`
    : empty('Kullanım yok', 'Yapay zeka çalıştıkça maliyet burada görünür.', 'cpu')}</div>
  </div>`;
  $('#add').onclick = async () => {
    const ok = await modal({
      title: 'Gider ekle', submitText: 'Ekle',
      body: `<div class="form-grid">${field('description', 'Açıklama', { required: true, span: true, placeholder: 'Örn. Sunucu kirası' })}
        ${field('category', 'Kategori', { options: Object.entries(CATS).map(([k, [l]]) => [k, l]) })}
        ${field('amount', 'Tutar', { type: 'number', required: true })}${field('currency', 'Para birimi', { value: 'TRY' })}</div>`,
      onSubmit: (d) => POST('/expenses', d),
    });
    if (ok) app.route();
  };
  $$('[data-del]').forEach((b) => { b.onclick = async () => {
    if (await confirmDialog('Gider silinsin mi?', '', { danger: true, confirmText: 'Sil' })) act(() => DEL(`/expenses/${b.dataset.del}`), 'Silindi').then(app.route);
  }; });
}
