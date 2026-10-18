// Freelance işler (#/leads) ve sigortalı/maaşlı iş ilanları (#/vacancies) — aynı ekran, iki tür.
import {
  $, $$, GET, POST, PUT, act, ago, app, busy, confirmDialog, empty, esc, field, icon, liveFilter, modal, money, onSegment, pageHeader, pill, searchBox, segmented, toast,
} from '../core.js';

const GROUPS = {
  new: ['new'], contacted: ['contacted'], replied: ['replied'], won: ['won'], archive: ['lost', 'ignored'], filtered_out: ['filtered_out'],
};

// Wording differs per list: you send an offer for freelance work, you apply for a job.
const KIND = {
  freelance: {
    route: 'leads', title: 'Freelance işler', one: 'iş',
    subtitle: 'Freelance sitelerinden seçtiğiniz kategorilerde bulunan işler. Uygun olanlara teklif verin veya iş sahibine yazın.',
    tabs: { new: 'Yeni', contacted: 'Teklif verildi', replied: 'Cevap geldi', won: 'Kazanılan', archive: 'Arşiv', filtered_out: 'Elenen' },
    status: { contacted: 'Teklif verildi', replied: 'Cevap geldi', won: 'Kazanıldı', lost: 'Kaybedildi' },
    sent: 'Teklif verdim', won: 'İşi aldım', lost: 'Kaybedildi', who: 'İş sahibi', notes: 'ör. 3.000 TL teklif verdim, cuma dönecek',
  },
  job: {
    route: 'vacancies', title: 'İş ilanları', one: 'ilan',
    subtitle: 'Sigortalı / maaşlı pozisyonlar: iş ilanı sitelerinden seçtiğiniz kategorilerde ve konumlarda bulunan ilanlar.',
    tabs: { new: 'Yeni', contacted: 'Başvuruldu', replied: 'Dönüş geldi', won: 'Teklif aldım', archive: 'Arşiv', filtered_out: 'Elenen' },
    status: { contacted: 'Başvuruldu', replied: 'Dönüş geldi', won: 'Teklif aldım', lost: 'Olumsuz' },
    sent: 'Başvurdum', won: 'Teklif aldım / işe alındım', lost: 'Olumsuz', who: 'Şirket', notes: 'ör. Ön görüşme 12 Kasım 14:00',
  },
};

const LANG = { en: 'İngilizce', de: 'Almanca', es: 'İspanyolca', fr: 'Fransızca', pt: 'Portekizce', it: 'İtalyanca', ru: 'Rusça', ar: 'Arapça' };
const JOB_TYPE = { full_time: 'Tam zamanlı', part_time: 'Yarı zamanlı', contract: 'Sözleşmeli', freelance: 'Serbest', internship: 'Staj', other: 'Diğer' };
const langTag = (l) => (l.foreign ? `<span class="tag lang" title="${esc(LANG[l.lang] || l.lang)} ilan${l.title_tr ? ` · orijinal başlık: ${esc(l.title)}` : ''}">${esc(String(l.lang).toUpperCase())}${l.title_tr ? ' → TR' : ''}</span>` : '');
const googleTranslate = (text) => `https://translate.google.com/?sl=auto&tl=tr&op=translate&text=${encodeURIComponent(String(text).slice(0, 4500))}`;
const statusPill = (l) => pill(l.status, KIND[l.kind === 'job' ? 'job' : 'freelance'].status[l.status]);

const budgetText = (l) => (l.budget_min == null && l.budget_max == null ? ''
  : `${l.budget_min != null ? money(l.budget_min) : ''}${l.budget_min != null && l.budget_max != null ? ' – ' : ''}${l.budget_max != null ? money(l.budget_max) : ''} ${l.currency || ''}`.trim());
const payText = (l) => l.salary || budgetText(l);

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Mesaj panoya kopyalandı'); } catch { toast('Kopyalanamadı; metni seçip kendiniz kopyalayın', 'error'); }
}

/** "İlan ekle" form; also opened by the bookmarklet with ?u=&t=&d= in the address. */
export async function newLeadDialog(prefill = {}, kind = '') {
  const r = await modal({
    title: 'İlan ekle',
    description: 'Giriş gerektiren sitelerde (Bionluk, Armut, LinkedIn…) gördüğünüz ilanları buraya kaydedin. Kaynaklar sayfasındaki "Kalfa\'ya ekle" yer imi bu formu sizin yerinize doldurur.',
    submitText: 'Kaydet',
    body: `<div class="form-grid">
      ${field('kind', 'Tür', { options: [['', 'Siteye göre otomatik'], ['freelance', 'Freelance iş'], ['job', 'İş ilanı (sigortalı / maaşlı)']], value: kind })}
      ${field('url', 'İlan adresi', { value: prefill.url || '', placeholder: 'https://…' })}
      ${field('title', 'Başlık', { value: prefill.title || '', required: true, span: true })}
      ${field('description', 'Açıklama', { type: 'textarea', rows: 5, value: prefill.description || '', span: true, hint: 'İlan metnini yapıştırın; içindeki e-posta ve telefon otomatik bulunur.' })}
      ${field('client_name', 'İş sahibi / şirket', { value: '' })}
      ${field('location', 'Konum', { value: '', placeholder: 'ör. İstanbul, Uzaktan' })}
      ${field('budget', 'Bütçe / maaş', { type: 'number', value: '' })}
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

async function categoryDialog(d, kind) {
  const r = await modal({
    title: `${KIND[kind].title}: kategoriler`,
    description: 'Hangi alanlardaki ilanları görmek istiyorsunuz? Kalfa her kategori için Türkçe ve İngilizce kelimeleri kendisi tanır. Hiçbirini seçmezseniz tüm ilanlar gelir.',
    submitText: 'Kaydet', wide: true,
    body: `<div class="choice-grid tight">${d.categories.map((c) => `<label class="choice"><input type="checkbox" name="cat" value="${c.key}" ${d.selected.includes(c.key) ? 'checked' : ''}><span>${esc(c.label)}</span></label>`).join('')}</div>
      ${kind === 'job' ? `<label class="field" style="margin-top:14px">Konum (isteğe bağlı)<input name="locations" value="${esc((d.locations || []).join(', '))}" placeholder="ör. İstanbul, Ankara, Uzaktan"><small>Virgülle ayırın. "Uzaktan" yazarsanız remote ilanlar da gelir. Boş bırakırsanız her yer.</small></label>` : ''}`,
    onSubmit: (_d, form) => PUT('/leads/categories', {
      kind,
      categories: $$('input[name=cat]:checked', form).map((x) => x.value),
      ...(kind === 'job' ? { locations: form.elements.locations.value.split(',').map((x) => x.trim()).filter(Boolean) } : {}),
    }),
  });
  if (r) { toast(`Kaydedildi · ${r.matched} ilan uygun, ${r.filtered} elendi`); app.route(); }
}

export async function viewLeads(main, id, kind = 'freelance') {
  const K = KIND[kind];
  if (String(id || '').startsWith('new')) {
    const r = await newLeadDialog(parsePrefill(id), kind === 'job' && !String(id).includes('?') ? 'job' : '');
    location.hash = r ? `#/${r.kind === 'job' ? 'vacancies' : 'leads'}/${r.id}` : `#/${K.route}`;
    return;
  }
  const filter = sessionStorage.getItem(`leadFilter:${kind}`) || 'new';
  const platformFilter = sessionStorage.getItem(`leadPlatform:${kind}`) || '';
  const catFilter = sessionStorage.getItem(`leadCat:${kind}`) || '';
  const d = await GET(`/leads?kind=${kind}${filter === 'filtered_out' ? '&status=filtered_out' : ''}`);
  const count = (key) => GROUPS[key].reduce((a, st) => a + (d.counts[st] || 0), 0);
  const platforms = [...new Set(d.leads.map((l) => l.platform))];
  const cats = [...new Set(d.leads.map((l) => l.category).filter(Boolean))];
  const catLabel = (k) => d.categories.find((c) => c.key === k)?.label || (k === 'custom' ? 'Kendi kelimelerim' : k);
  const list = d.leads.filter((l) => GROUPS[filter].includes(l.status) && (!platformFilter || l.platform === platformFilter) && (!catFilter || l.category === catFilter));

  main.innerHTML = `${pageHeader({
    title: K.title,
    subtitle: K.subtitle,
    actions: `<button class="btn" id="addLead">${icon('plus', 'sm')} İlan ekle</button>
      <button class="btn primary" id="scan" ${d.scanning ? 'disabled' : ''}>${icon('refresh-cw', 'sm')} ${d.scanning ? 'Taranıyor…' : 'Şimdi tara'}</button>`,
  })}
  <div class="cat-bar">
    <span class="cat-bar-label">${icon('layout-grid', 'sm')} Kategoriler</span>
    ${d.selected.length ? d.selected.map((k) => `<span class="chip-static">${esc(catLabel(k))}</span>`).join('') : '<span class="muted small">Tümü (kategori seçilmedi)</span>'}
    ${kind === 'job' && d.locations.length ? `<span class="chip-static">${icon('map-pin', 'xs')} ${esc(d.locations.join(', '))}</span>` : ''}
    <button class="btn sm" id="pickCats">${icon('pencil', 'xs')} Değiştir</button>
  </div>
  <div class="toolbar">
    ${segmented('lead', Object.entries(K.tabs).map(([k, label]) => [k, label, count(k)]), filter)}
    <span class="spacer"></span>
    ${cats.length > 1 ? `<select id="cat" class="input-sm" aria-label="Kategori"><option value="">Tüm kategoriler</option>${cats.map((c) => `<option value="${esc(c)}" ${c === catFilter ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('')}</select>` : ''}
    ${platforms.length > 1 ? `<select id="plat" class="input-sm" aria-label="Site"><option value="">Tüm siteler</option>${platforms.map((p) => `<option value="${esc(p)}" ${p === platformFilter ? 'selected' : ''}>${esc(d.platforms[p]?.label || p)}</option>`).join('')}</select>` : ''}
    ${searchBox('İlan ara…')}
  </div>
  <div class="card-grid" id="grid">${list.map((l) => `
    <article class="lead-card ${l.status}" data-open="${l.id}" tabindex="0">
      <div class="lc-top"><span class="platform">${icon('globe', 'xs')} ${esc(l.platform_label)}</span>${l.score != null ? `<span class="score-dot" title="Uygunluk puanı">${l.score}</span>` : ''}${statusPill(l)}<time>${ago(l.created_at)}</time></div>
      <h3>${langTag(l)}${esc(l.title_tr || l.title)}</h3>
      ${kind === 'job' && (l.company || l.location) ? `<div class="lc-meta">${l.company ? `${icon('briefcase', 'xs')} ${esc(l.company)}` : ''}${l.location ? `<span>${icon('map-pin', 'xs')} ${esc(l.location)}</span>` : ''}${l.job_type ? `<span>${esc(JOB_TYPE[l.job_type] || l.job_type)}</span>` : ''}</div>` : ''}
      ${(l.description_tr || l.description) ? `<p class="lc-desc">${esc((l.description_tr || l.description).slice(0, 220))}${(l.description_tr || l.description).length > 220 ? '…' : ''}</p>` : ''}
      <div class="lc-skills">${l.category ? `<span class="tag accent">${esc(l.category_label)}</span>` : ''}${l.skills ? l.skills.split(',').filter(Boolean).slice(0, 3).map((s) => `<span class="tag">${esc(s.trim())}</span>`).join('') : ''}</div>
      ${l.filter_reason ? `<div class="lc-reason">${icon('filter', 'xs')} ${esc(l.filter_reason)}</div>` : ''}
      <div class="lc-foot">
        <div class="lc-budget">${payText(l) ? `<small>${kind === 'job' ? 'Maaş' : 'Bütçe'}</small><b>${esc(payText(l))}</b>` : `<small>${kind === 'job' ? 'Maaş' : 'Bütçe'} belirtilmemiş</small>`}</div>
        <div class="row-actions">
          ${l.contact.email ? `<span class="icon-btn static" title="E-posta var">${icon('mail', 'sm')}</span>` : ''}
          ${l.contact.phone ? `<span class="icon-btn static" title="Telefon var">${icon('phone', 'sm')}</span>` : ''}
          ${l.url ? `<a class="icon-btn" href="${esc(l.url)}" target="_blank" rel="noopener" title="İlana git" aria-label="İlana git" data-stop>${icon('external-link', 'sm')}</a>` : ''}
        </div>
      </div>
    </article>`).join('')}
    <div data-no-results hidden class="muted">Aramanızla eşleşen ilan yok.</div>
  </div>
  ${list.length ? '' : empty(filter === 'new' ? `Yeni ${K.one} yok` : 'Bu listede ilan yok',
    filter === 'new' ? `Kategorilerinizi kontrol edin, Kaynaklar sayfasından site ekleyin veya "Şimdi tara"ya basın. Gördüğünüz bir ilanı "İlan ekle" ile de kaydedebilirsiniz.` : 'İlanların durumu değiştikçe burada görünecek.',
    kind === 'job' ? 'briefcase' : 'target', filter === 'new' ? '<a class="btn" href="#/sources">Kaynaklar</a>' : '')}`;

  onSegment(main, 'lead', (v) => { sessionStorage.setItem(`leadFilter:${kind}`, v); app.route(); });
  $('#plat')?.addEventListener('change', (e) => { sessionStorage.setItem(`leadPlatform:${kind}`, e.target.value); app.route(); });
  $('#cat')?.addEventListener('change', (e) => { sessionStorage.setItem(`leadCat:${kind}`, e.target.value); app.route(); });
  $('#pickCats').onclick = () => categoryDialog(d, kind);
  liveFilter($('#q'), '.lead-card', main);
  $('#scan').onclick = (e) => busy(e.currentTarget, async () => {
    toast('Kaynaklar taranıyor…');
    const r = await act(() => POST('/leads/scan'));
    if (!r) return;
    toast(r.skipped ? 'Tarama zaten sürüyor' : `${r.fetched} ilan okundu · ${r.matched} yeni uygun · ${r.filtered} elendi${r.errors?.length ? ` · ${r.errors.length} kaynakta hata` : ''}`);
    app.route();
  });
  $('#addLead').onclick = async () => {
    const r = await newLeadDialog({}, kind);
    if (r) location.hash = `#/${r.kind === 'job' ? 'vacancies' : 'leads'}/${r.id}`;
  };
  $$('[data-stop]').forEach((a) => { a.onclick = (e) => e.stopPropagation(); });
  $$('[data-open]').forEach((c) => {
    c.onclick = () => { location.hash = `#/${K.route}/${c.dataset.open}`; };
    c.onkeydown = (e) => { if (e.key === 'Enter') c.click(); };
  });
  if (id) openLead(Number(id), d.smtp, kind);
}

async function openLead(leadId, smtp, kind) {
  let l;
  try { l = await GET(`/leads/${leadId}`); } catch { return; }
  const K = KIND[l.kind === 'job' ? 'job' : 'freelance'];
  const back = `#/${K.route}`;
  const done = (msg) => { toast(msg); document.querySelector('.overlay')?.remove(); location.hash = back; };
  const canContact = ['new', 'filtered_out'].includes(l.status);
  const isJob = l.kind === 'job';
  const result = modal({
    drawer: true, hideFooter: true,
    title: esc(l.title_tr || l.title),
    description: [esc(l.platform_label), isJob && l.company ? esc(l.company) : '', isJob && l.location ? esc(l.location) : '', ago(l.created_at), payText(l) ? esc(payText(l)) : ''].filter(Boolean).join(' · '),
    body: `<div class="pd">
      <div class="row wrap">${statusPill(l)}${l.category_labels.map((c) => `<span class="tag accent">${esc(c)}</span>`).join('')}${l.score != null ? `<span class="tag">Uygunluk ${l.score}/100</span>` : ''}${isJob && l.job_type ? `<span class="tag">${esc(JOB_TYPE[l.job_type] || l.job_type)}</span>` : ''}${l.filter_reason ? `<span class="tag">${icon('filter', 'xs')} ${esc(l.filter_reason)}</span>` : ''}</div>
      ${l.url ? `<a class="btn primary block" href="${esc(l.url)}" target="_blank" rel="noopener">${icon('external-link', 'sm')} ${isJob ? 'İlana git ve başvur' : 'İlana git'} · ${esc(l.platform_label)}</a>` : ''}
      ${l.foreign ? `<div class="translate-bar">${icon('globe', 'sm')}<span>${l.title_tr ? `${esc(LANG[l.lang] || l.lang)} ilan, Türkçeye çevrildi.` : `${esc(LANG[l.lang] || l.lang)} ilan, henüz çevrilmedi.`}</span>
        <button type="button" class="btn sm" id="translate">${icon('refresh-cw', 'xs')} ${l.title_tr ? 'Yeniden çevir' : 'Türkçeye çevir'}</button>
        <a class="btn sm ghost" href="${googleTranslate(`${l.title}\n\n${l.description || ''}`)}" target="_blank" rel="noopener">Google Çeviri'de aç</a></div>` : ''}
      ${(l.description_tr || l.description) ? `<div class="lead-desc">${esc(l.description_tr || l.description)}</div>` : ''}
      ${l.title_tr ? `<details class="orig"><summary>Orijinal metin</summary><div class="lead-desc"><b>${esc(l.title)}</b>\n\n${esc(l.description || '')}</div></details>` : ''}
      <div class="pd-grid"><div><h4>İletişim</h4><ul class="pd-contact">
        ${l.client_name ? `<li>${icon('user', 'xs')} ${esc(l.client_name)}</li>` : ''}
        <li>${icon('mail', 'xs')} ${l.contact.email ? esc(l.contact.email) : '<span class="muted">Yok</span>'}</li>
        <li>${icon('phone', 'xs')} ${l.contact.phone ? `<a href="tel:+${esc(l.contact.phone)}">+${esc(l.contact.phone)}</a>` : '<span class="muted">Yok</span>'}</li></ul></div>
        <div><h4>${isJob ? 'Nasıl başvurulur?' : 'Nasıl yazılır?'}</h4><p class="small muted">${l.contact.email || l.contact.phone ? 'İlanda iletişim bilgisi var; doğrudan yazabilirsiniz.' : isJob ? 'İlana gidip sitede başvurun; ön yazı olarak aşağıdaki mesajı kullanabilirsiniz. Sonra "Başvurdum"a basın.' : 'İletişim bilgisi yok: mesajı kopyalayıp sitede teklif olarak gönderin, sonra "Teklif verdim"e basın.'}</p></div></div>
      <label class="field">${isJob ? 'Ön yazı' : 'Mesaj'} <small>${l.foreign ? 'İlan yabancı dilde olduğu için İngilizce şablon kullanıldı. ' : ''}Ayarlar → Mesaj şablonları'ndan değiştirebilirsiniz.</small>
        <textarea id="lmsg" rows="6">${esc(l.message)}</textarea></label>
      <div class="pd-actions">
        <button type="button" class="btn" id="copyMsg">${icon('copy', 'sm')} Kopyala</button>
        ${canContact ? `<button type="button" class="btn primary" data-ch="platform">${icon('send', 'sm')} ${K.sent}</button>` : ''}
        ${canContact && l.contact.email ? `<button type="button" class="btn" data-ch="email" ${smtp ? '' : 'disabled title="SMTP ayarlı değil"'}>${icon('mail', 'sm')} E-posta gönder</button>` : ''}
        ${canContact && l.contact.phone ? `<button type="button" class="btn" data-ch="whatsapp_link">${icon('message-circle', 'sm')} WhatsApp'ta aç</button>` : ''}
      </div>
      ${l.conversation_id ? `<a class="link" href="#/conversations/${l.conversation_id}">${icon('message-circle', 'xs')} Konuşmayı aç</a>` : ''}
      <label class="field">Notlarınız<textarea id="lnotes" rows="2" placeholder="${K.notes}">${esc(l.notes || '')}</textarea></label>
      <div class="pd-foot">
        <button type="button" class="btn sm" data-st="won">${icon('trophy', 'xs')} ${K.won}</button>
        <button type="button" class="btn sm ghost" data-st="lost">${K.lost}</button>
        <button type="button" class="btn sm ghost" data-st="ignored">İlgilenmiyorum</button>
        ${l.status !== 'new' ? '<button type="button" class="btn sm ghost" data-st="new">Yeniye al</button>' : ''}
      </div></div>`,
    onSubmit: () => false,
  });
  // Closing the drawer returns to the list address, so the same card can be opened again.
  result.then(() => { if (location.hash === `${back}/${l.id}`) history.replaceState(null, '', back); });
  const dlg = [...document.querySelectorAll('.dialog')].at(-1);
  const msg = () => $('#lmsg', dlg).value;
  $('#copyMsg', dlg).onclick = () => copy(msg());
  $('#translate', dlg)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    if (await act(() => POST(`/leads/${l.id}/translate`), 'Çevrildi')) {
      document.querySelector('.overlay')?.remove();
      openLead(l.id, smtp, kind);
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
      if (r) done(ch === 'email' ? 'E-posta gönderildi' : `${K.status.contacted} olarak işaretlendi`);
    };
  });
  return result;
}

export const viewVacancies = (main, id) => viewLeads(main, id, 'job');
