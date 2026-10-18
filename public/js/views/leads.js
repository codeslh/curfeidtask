import {
  $, $$, GET, POST, PUT, act, ago, app, busy, confirmDialog, empty, esc, field, icon, liveFilter, modal, money, onSegment, pageHeader, pill, searchBox, segmented, toast,
} from '../core.js';

const GROUPS = {
  new: ['new'], contacted: ['contacted'], replied: ['replied'], won: ['won'], archive: ['lost', 'ignored'], filtered_out: ['filtered_out'],
};

const LANG = { en: 'İngilizce', de: 'Almanca', es: 'İspanyolca', fr: 'Fransızca', pt: 'Portekizce', it: 'İtalyanca', ru: 'Rusça', ar: 'Arapça' };
const langTag = (l) => (l.foreign ? `<span class="tag lang" title="${esc(LANG[l.lang] || l.lang)} ilan${l.title_tr ? ` · orijinal başlık: ${esc(l.title)}` : ''}">${esc(String(l.lang).toUpperCase())}${l.title_tr ? ' → TR' : ''}</span>` : '');
const googleTranslate = (text) => `https://translate.google.com/?sl=auto&tl=tr&op=translate&text=${encodeURIComponent(String(text).slice(0, 4500))}`;

const budgetText = (l) => (l.budget_min == null && l.budget_max == null ? ''
  : `${l.budget_min != null ? money(l.budget_min) : ''}${l.budget_min != null && l.budget_max != null ? ' – ' : ''}${l.budget_max != null ? money(l.budget_max) : ''} ${l.currency || ''}`.trim());

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Mesaj panoya kopyalandı'); } catch { toast('Kopyalanamadı; metni seçip kendiniz kopyalayın', 'error'); }
}

/** "İlan ekle" form; also opened by the bookmarklet with ?u=&t=&d= in the address. */
export async function newLeadDialog(prefill = {}) {
  const r = await modal({
    title: 'İlan ekle',
    description: 'Bionluk, Armut gibi giriş gerektiren sitelerde gördüğünüz ilanları buraya kaydedin. Kaynaklar sayfasındaki "Kalfa\'ya ekle" yer imi bu formu sizin yerinize doldurur.',
    submitText: 'Kaydet',
    body: `<div class="form-grid">
      ${field('url', 'İlan adresi', { value: prefill.url || '', placeholder: 'https://…', span: true })}
      ${field('title', 'Başlık', { value: prefill.title || '', required: true, span: true })}
      ${field('description', 'Açıklama', { type: 'textarea', rows: 5, value: prefill.description || '', span: true, hint: 'İlan metnini yapıştırın; içindeki e-posta ve telefon otomatik bulunur.' })}
      ${field('client_name', 'İlan sahibi', { value: '' })}
      ${field('budget', 'Bütçe', { type: 'number', value: '' })}
      ${field('email', 'E-posta', { type: 'email', value: '' })}
      ${field('phone', 'Telefon', { value: '' })}</div>`,
    onSubmit: (d) => POST('/leads', d),
  });
  if (!r) return null;
  toast(r.duplicate ? 'Bu ilan zaten kayıtlı' : 'İlan kaydedildi');
  return r;
}

function parsePrefill(id) {
  const q = new URLSearchParams(String(id || '').split('?')[1] || '');
  return { url: q.get('u') || '', title: q.get('t') || '', description: q.get('d') || '' };
}

export async function viewLeads(main, id) {
  if (String(id || '').startsWith('new')) {
    const r = await newLeadDialog(parsePrefill(id));
    location.hash = r ? `#/leads/${r.id}` : '#/leads';
    return;
  }
  const filter = sessionStorage.getItem('leadFilter') || 'new';
  const platformFilter = sessionStorage.getItem('leadPlatform') || '';
  const d = await GET(`/leads${filter === 'filtered_out' ? '?status=filtered_out' : ''}`);
  const count = (key) => GROUPS[key].reduce((a, st) => a + (d.counts[st] || 0), 0);
  const platforms = [...new Set(d.leads.map((l) => l.platform))];
  const list = d.leads.filter((l) => GROUPS[filter].includes(l.status) && (!platformFilter || l.platform === platformFilter));

  main.innerHTML = `${pageHeader({
    title: 'İş ilanları',
    subtitle: 'Kaynaklarınızdan bulunan ve anahtar kelimelerinize uyan ilanlar. Uygun olanlara teklif verin veya ilan sahibine yazın.',
    actions: `<a class="btn" href="#/settings/scanner">${icon('filter', 'sm')} Anahtar kelimeler</a>
      <button class="btn" id="addLead">${icon('plus', 'sm')} İlan ekle</button>
      <button class="btn primary" id="scan" ${d.scanning ? 'disabled' : ''}>${icon('refresh-cw', 'sm')} ${d.scanning ? 'Taranıyor…' : 'Şimdi tara'}</button>`,
  })}
  <div class="toolbar">
    ${segmented('lead', [['new', 'Yeni', count('new')], ['contacted', 'Yazıldı', count('contacted')], ['replied', 'Cevap verdi', count('replied')], ['won', 'Kazanılan', count('won')], ['archive', 'Arşiv', count('archive')], ['filtered_out', 'Elenen', count('filtered_out')]], filter)}
    <span class="spacer"></span>
    ${platforms.length > 1 ? `<select id="plat" class="input-sm" aria-label="Site"><option value="">Tüm siteler</option>${platforms.map((p) => `<option value="${esc(p)}" ${p === platformFilter ? 'selected' : ''}>${esc(d.platforms[p]?.label || p)}</option>`).join('')}</select>` : ''}
    ${searchBox('İlan ara…')}
  </div>
  <div class="card-grid" id="grid">${list.map((l) => `
    <article class="lead-card ${l.status}" data-open="${l.id}" tabindex="0">
      <div class="lc-top"><span class="platform">${icon('globe', 'xs')} ${esc(l.platform_label)}</span>${l.score != null ? `<span class="score-dot" title="Uygunluk puanı">${l.score}</span>` : ''}${pill(l.status)}<time>${ago(l.created_at)}</time></div>
      <h3>${langTag(l)}${esc(l.title_tr || l.title)}</h3>
      ${(l.description_tr || l.description) ? `<p class="lc-desc">${esc((l.description_tr || l.description).slice(0, 220))}${(l.description_tr || l.description).length > 220 ? '…' : ''}</p>` : ''}
      ${l.skills ? `<div class="lc-skills">${l.skills.split(',').filter(Boolean).slice(0, 4).map((s) => `<span class="tag">${esc(s.trim())}</span>`).join('')}</div>` : ''}
      ${l.filter_reason ? `<div class="lc-reason">${icon('filter', 'xs')} ${esc(l.filter_reason)}</div>` : ''}
      <div class="lc-foot">
        <div class="lc-budget">${budgetText(l) ? `<small>Bütçe</small><b>${esc(budgetText(l))}</b>` : '<small>Bütçe belirtilmemiş</small>'}</div>
        <div class="row-actions">
          ${l.contact.email ? `<span class="icon-btn static" title="E-posta var">${icon('mail', 'sm')}</span>` : ''}
          ${l.contact.phone ? `<span class="icon-btn static" title="Telefon var">${icon('phone', 'sm')}</span>` : ''}
          ${l.url ? `<a class="icon-btn" href="${esc(l.url)}" target="_blank" rel="noopener" title="İlana git" aria-label="İlana git" data-stop>${icon('external-link', 'sm')}</a>` : ''}
        </div>
      </div>
    </article>`).join('')}
    <div data-no-results hidden class="muted">Aramanızla eşleşen ilan yok.</div>
  </div>
  ${list.length ? '' : empty(filter === 'new' ? 'Yeni ilan yok' : 'Bu listede ilan yok',
    filter === 'new' ? 'Kaynaklar sayfasından site ekleyin, "Şimdi tara"ya basın veya gördüğünüz bir ilanı "İlan ekle" ile kaydedin.' : 'İlanların durumu değiştikçe burada görünecek.',
    'target', filter === 'new' ? '<a class="btn" href="#/sources">Kaynaklar</a>' : '')}`;

  onSegment(main, 'lead', (v) => { sessionStorage.setItem('leadFilter', v); app.route(); });
  $('#plat')?.addEventListener('change', (e) => { sessionStorage.setItem('leadPlatform', e.target.value); app.route(); });
  liveFilter($('#q'), '.lead-card', main);
  $('#scan').onclick = (e) => busy(e.currentTarget, async () => {
    toast('Kaynaklar taranıyor…');
    const r = await act(() => POST('/leads/scan'));
    if (!r) return;
    toast(r.skipped ? 'Tarama zaten sürüyor' : `${r.fetched} ilan okundu · ${r.matched} yeni uygun · ${r.filtered} elendi${r.errors?.length ? ` · ${r.errors.length} kaynakta hata` : ''}`);
    app.route();
  });
  $('#addLead').onclick = async () => { const r = await newLeadDialog(); if (r) location.hash = `#/leads/${r.id}`; };
  $$('[data-stop]').forEach((a) => { a.onclick = (e) => e.stopPropagation(); });
  $$('[data-open]').forEach((c) => {
    c.onclick = () => { location.hash = `#/leads/${c.dataset.open}`; };
    c.onkeydown = (e) => { if (e.key === 'Enter') c.click(); };
  });
  if (id) openLead(Number(id), d.smtp);
}

async function openLead(leadId, smtp) {
  let l;
  try { l = await GET(`/leads/${leadId}`); } catch { return; }
  const done = (msg) => { toast(msg); document.querySelector('.overlay')?.remove(); location.hash = '#/leads'; };
  const canContact = ['new', 'filtered_out'].includes(l.status);
  const result = modal({
    drawer: true, hideFooter: true,
    title: esc(l.title_tr || l.title),
    description: `${esc(l.platform_label)} · ${ago(l.created_at)}${budgetText(l) ? ` · ${esc(budgetText(l))}` : ''}`,
    body: `<div class="pd">
      <div class="row wrap">${pill(l.status)}${l.score != null ? `<span class="tag">Uygunluk ${l.score}/100</span>` : ''}${l.filter_reason ? `<span class="tag">${icon('filter', 'xs')} ${esc(l.filter_reason)}</span>` : ''}</div>
      ${l.url ? `<a class="btn primary block" href="${esc(l.url)}" target="_blank" rel="noopener">${icon('external-link', 'sm')} İlana git · ${esc(l.platform_label)}</a>` : ''}
      ${l.foreign ? `<div class="translate-bar">${icon('globe', 'sm')}<span>${l.title_tr ? `${esc(LANG[l.lang] || l.lang)} ilan, Türkçeye çevrildi.` : `${esc(LANG[l.lang] || l.lang)} ilan, henüz çevrilmedi.`}</span>
        <button type="button" class="btn sm" id="translate">${icon('refresh-cw', 'xs')} ${l.title_tr ? 'Yeniden çevir' : 'Türkçeye çevir'}</button>
        <a class="btn sm ghost" href="${googleTranslate(`${l.title}\n\n${l.description || ''}`)}" target="_blank" rel="noopener">Google Çeviri'de aç</a></div>` : ''}
      ${(l.description_tr || l.description) ? `<div class="lead-desc">${esc(l.description_tr || l.description)}</div>` : ''}
      ${l.title_tr ? `<details class="orig"><summary>Orijinal metin</summary><div class="lead-desc"><b>${esc(l.title)}</b>\n\n${esc(l.description || '')}</div></details>` : ''}
      <div class="pd-grid"><div><h4>İletişim</h4><ul class="pd-contact">
        ${l.client_name ? `<li>${icon('user', 'xs')} ${esc(l.client_name)}</li>` : ''}
        <li>${icon('mail', 'xs')} ${l.contact.email ? esc(l.contact.email) : '<span class="muted">Yok</span>'}</li>
        <li>${icon('phone', 'xs')} ${l.contact.phone ? `<a href="tel:+${esc(l.contact.phone)}">+${esc(l.contact.phone)}</a>` : '<span class="muted">Yok</span>'}</li></ul></div>
        <div><h4>Nasıl yazılır?</h4><p class="small muted">${l.contact.email || l.contact.phone ? 'İlanda iletişim bilgisi var; doğrudan yazabilirsiniz.' : 'İletişim bilgisi yok: mesajı kopyalayıp sitede teklif olarak gönderin, sonra "Teklif verdim"e basın.'}</p></div></div>
      <label class="field">Mesaj <small>${l.foreign ? 'İlan yabancı dilde olduğu için İngilizce şablon kullanıldı. ' : ''}Ayarlar → Mesaj şablonları'ndan değiştirebilirsiniz.</small>
        <textarea id="lmsg" rows="6">${esc(l.message)}</textarea></label>
      <div class="pd-actions">
        <button type="button" class="btn" id="copyMsg">${icon('copy', 'sm')} Mesajı kopyala</button>
        ${canContact ? `<button type="button" class="btn primary" data-ch="platform">${icon('send', 'sm')} Teklif verdim</button>` : ''}
        ${canContact && l.contact.email ? `<button type="button" class="btn" data-ch="email" ${smtp ? '' : 'disabled title="SMTP ayarlı değil"'}>${icon('mail', 'sm')} E-posta gönder</button>` : ''}
        ${canContact && l.contact.phone ? `<button type="button" class="btn" data-ch="whatsapp_link">${icon('message-circle', 'sm')} WhatsApp'ta aç</button>` : ''}
      </div>
      ${l.conversation_id ? `<a class="link" href="#/conversations/${l.conversation_id}">${icon('message-circle', 'xs')} Konuşmayı aç</a>` : ''}
      <label class="field">Notlarınız<textarea id="lnotes" rows="2" placeholder="ör. 3.000 TL teklif verdim, cuma dönecek">${esc(l.notes || '')}</textarea></label>
      <div class="pd-foot">
        <button type="button" class="btn sm" data-st="won">${icon('trophy', 'xs')} İşi aldım</button>
        <button type="button" class="btn sm ghost" data-st="lost">Kaybedildi</button>
        <button type="button" class="btn sm ghost" data-st="ignored">İlgilenmiyorum</button>
        ${l.status !== 'new' ? '<button type="button" class="btn sm ghost" data-st="new">Yeniye al</button>' : ''}
      </div></div>`,
    onSubmit: () => false,
  });
  // Closing the drawer returns to the list address, so the same card can be opened again.
  result.then(() => { if (location.hash === `#/leads/${l.id}`) history.replaceState(null, '', '#/leads'); });
  const dlg = [...document.querySelectorAll('.dialog')].at(-1);
  const msg = () => $('#lmsg', dlg).value;
  $('#copyMsg', dlg).onclick = () => copy(msg());
  $('#translate', dlg)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    if (await act(() => POST(`/leads/${l.id}/translate`), 'Çevrildi')) {
      document.querySelector('.overlay')?.remove();
      openLead(l.id, smtp);
    }
  }));
  $('#lnotes', dlg).onchange = (e) => act(() => PUT(`/leads/${l.id}`, { notes: e.target.value }), 'Not kaydedildi');
  $$('[data-st]', dlg).forEach((b) => { b.onclick = async () => { if (await act(() => PUT(`/leads/${l.id}`, { status: b.dataset.st }))) done('Durum güncellendi'); }; });
  $$('[data-ch]', dlg).forEach((b) => {
    b.onclick = async () => {
      const ch = b.dataset.ch;
      if (ch === 'whatsapp_link') {
        window.open(`https://wa.me/${l.contact.phone}?text=${encodeURIComponent(msg())}`, '_blank', 'noopener');
        if (!(await confirmDialog('Mesajı WhatsApp\'tan gönderdiniz mi?', 'Gönderdiyseniz ilan "Yazıldı" olarak işaretlenir ve bir konuşma açılır.', { confirmText: 'Evet, gönderdim' }))) return;
      }
      if (ch === 'platform') await copy(msg());
      const r = await busy(b, () => act(() => POST(`/leads/${l.id}/contact`, { channel: ch, message: msg() })));
      if (r) done(ch === 'email' ? 'E-posta gönderildi' : 'Yazıldı olarak işaretlendi');
    };
  });
  return result;
}
