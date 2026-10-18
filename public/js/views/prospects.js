// "Bölge taraması": nearby businesses on a map, scored by how likely they need a website.
import {
  $, $$, GET, POST, PUT, act, ago, app, busy, confirmDialog, empty, esc, icon, modal, onSegment, pageHeader, pill, segmented, toast,
} from '../core.js';

let L; // Leaflet, loaded on first visit
async function loadLeaflet() {
  if (L) return L;
  if (!document.querySelector('link[data-leaflet]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = '/vendor/leaflet/leaflet.css'; link.dataset.leaflet = '1';
    document.head.append(link);
  }
  L = await import('/vendor/leaflet/leaflet-src.esm.js');
  return L;
}

const STATUS = {
  new: ['Yeni', 'neutral'], analyzed: ['İncelendi', 'info'], contacted: ['Yazıldı', 'accent'], replied: ['Cevap verdi', 'good'],
  opted_out: ['İstemiyor', 'bad'], skipped: ['Atlandı', 'neutral'], converted: ['Müşteri oldu', 'good'],
};
const scoreTone = (s) => (s == null ? 'neutral' : s >= 70 ? 'hot' : s >= 45 ? 'warm' : 'cold');
const scoreBadge = (s) => `<span class="score ${scoreTone(s)}" title="Web sitesi ihtiyacı puanı">${s ?? '—'}</span>`;
const RADII = [0.5, 1, 2, 3, 5, 10];
let currentId = null;

export async function viewProspects(main, openId) {
  const d = await GET('/prospects');
  const s = d.settings;
  const filter = sessionStorage.getItem('prospectFilter') || 'hot';
  const FILTERS = {
    hot: (p) => p.status === 'analyzed' && p.score >= s.min_score,
    all: () => true,
    contacted: (p) => p.status === 'contacted',
    replied: (p) => ['replied', 'converted'].includes(p.status),
    out: (p) => ['skipped', 'opted_out'].includes(p.status) || (p.status === 'analyzed' && p.score < s.min_score),
  };
  const list = d.prospects.filter(FILTERS[filter]);
  const count = (f) => d.prospects.filter(FILTERS[f]).length;

  main.innerHTML = `${pageHeader({
    title: 'Bölge taraması',
    subtitle: 'Çevrenizdeki işletmeleri bulur, web sitelerini inceler ve "web sitesine ihtiyacı var mı?" diye puanlar. Mesaj taslağı şablonlarınızdan hazırlanır; siz onaylayınca gönderilir.',
    actions: `<a class="btn" href="#/settings/prospecting">${icon('settings', 'sm')} Ayarlar</a>
      <button class="btn ai" id="autoSend" ${d.stats.hot ? '' : 'disabled'}>${icon('send', 'sm')} Sıcak olanlara gönder</button>`,
  })}

  <form class="card scan-bar" id="scanForm">
    <label class="field grow">Konum<span class="input-icon">${icon('map-pin', 'sm')}<input name="location" value="${esc(s.location)}" placeholder="Ör. Moda, Kadıköy, İstanbul" autocomplete="off"></span></label>
    <button type="button" class="btn" id="locate" title="Bulunduğum konumu kullan">${icon('locate-fixed', 'sm')}</button>
    <label class="field">Yarıçap<select name="radius_km">${RADII.map((r) => `<option value="${r}" ${Number(s.radius_km) === r ? 'selected' : ''}>${r < 1 ? `${r * 1000} m` : `${r} km`}</option>`).join('')}</select></label>
    <label class="field">Kaynak<select name="source"><option value="osm" ${s.source === 'osm' ? 'selected' : ''}>OpenStreetMap (ücretsiz)</option><option value="google" ${s.source === 'google' ? 'selected' : ''} ${d.capabilities.google ? '' : 'disabled'}>Google Places${d.capabilities.google ? '' : ' (anahtar yok)'}</option></select></label>
    <button class="btn primary" id="scanBtn" ${d.scanning ? 'disabled' : ''}>${icon('radar', 'sm')} ${d.scanning ? 'Taranıyor…' : 'Tara'}</button>
    <details class="cat-picker span-all"><summary>${icon('store', 'sm')} Kategoriler <span class="muted">(${s.categories.length} seçili)</span></summary>
      <div class="choice-grid tight">${d.categories.map((c) => `<label class="choice"><input type="checkbox" name="cat" value="${c.key}" ${s.categories.includes(c.key) ? 'checked' : ''}><span>${esc(c.label)}</span></label>`).join('')}</div>
    </details>
  </form>

  <section class="bento kpi-strip">
    ${[['Bulunan', d.stats.total, 'store', 'neutral'], ['Sıcak aday', d.stats.hot, 'gauge', 'accent'], ['Yazıldı', d.stats.contacted, 'send', 'info'], ['Cevap verdi', d.stats.replied, 'message-circle', 'good'], ['Bugün', `${d.stats.today}/${d.stats.daily_limit}`, 'clock', 'warn']]
    .map(([l, v, ic, tone]) => `<div class="card kpi mini span-auto"><div class="kpi-top"><span class="tile-icon ${tone}">${icon(ic)}</span><span class="kpi-label">${l}</span></div><div class="kpi-value">${v}</div></div>`).join('')}
  </section>

  <div class="callout info">${icon('shield', 'sm')}<span>Her mesajın sonuna otomatik olarak "istemezseniz İPTAL yazın" cümlesi eklenir; İPTAL yazanlar kalıcı olarak listeden çıkar. Ticari ileti kurallarına (İYS, KVKK) ve WhatsApp politikalarına uymak sizin sorumluluğunuzdadır.</span></div>

  <div class="prospect-layout">
    <div class="card flush map-card"><div id="map" class="map"></div>
      <div class="map-legend"><span><i class="hot"></i>70+</span><span><i class="warm"></i>45–69</span><span><i class="cold"></i>0–44</span></div></div>
    <div class="card flush list-card">
      <div class="list-head">${segmented('pf', [['hot', 'Sıcak', count('hot')], ['all', 'Tümü', count('all')], ['contacted', 'Yazıldı', count('contacted')], ['replied', 'Cevap', count('replied')], ['out', 'Elenen', count('out')]], filter)}</div>
      <div class="prospect-list" id="plist">${list.map((p) => `
        <button class="prospect" data-id="${p.id}">
          ${scoreBadge(p.score)}
          <span class="pr-body"><span class="pr-top"><b>${esc(p.name)}</b>${p.status !== 'analyzed' ? pill(p.status, STATUS[p.status]?.[0]) : ''}</span>
            <span class="pr-meta">${esc(p.category_label)}${p.address ? ` · ${esc(p.address)}` : ''}</span>
            <span class="pr-signals">${(p.signals || []).slice(0, 2).map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</span></span>
          <span class="pr-contact">${p.email ? icon('mail', 'xs') : ''}${p.phone ? icon('phone', 'xs') : ''}${p.website ? icon('globe', 'xs') : ''}</span>
        </button>`).join('') || empty(d.stats.total ? 'Bu listede işletme yok' : 'Henüz tarama yapılmadı', d.stats.total ? 'Başka bir sekmeye bakın.' : 'Yukarıya bir konum yazıp "Tara"ya basın. İlk tarama birkaç dakika sürebilir.', 'radar')}</div>
    </div>
  </div>

  ${d.scans.length ? `<div class="card flush"><div class="card-head pad"><div><h2>Son taramalar</h2></div></div><table class="table"><thead><tr><th>Konum</th><th class="num">Yarıçap</th><th class="num">Bulunan</th><th class="num">Yeni</th><th>Durum</th><th>Zaman</th></tr></thead><tbody>
    ${d.scans.map((x) => `<tr><td>${esc(x.location || `${x.lat?.toFixed(4)}, ${x.lng?.toFixed(4)}`)}</td><td class="num">${x.radius_km} km</td><td class="num">${x.found}</td><td class="num">${x.added}</td>
      <td>${pill(x.status === 'running' ? 'running' : x.status === 'ok' ? 'ok' : 'error')}${x.message ? `<div class="muted small detail">${esc(x.message)}</div>` : ''}</td><td class="muted small">${ago(x.created_at)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;

  onSegment(main, 'pf', (v) => { sessionStorage.setItem('prospectFilter', v); app.route(); });

  // --- Map ---
  const Lf = await loadLeaflet();
  const center = s.lat != null ? [s.lat, s.lng] : list[0] ? [list[0].lat, list[0].lng] : [41.0082, 28.9784];
  const map = Lf.map('map', { zoomControl: true, attributionControl: true }).setView(center, s.lat != null ? (s.radius_km <= 1 ? 15 : s.radius_km <= 3 ? 14 : 12) : 11);
  Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap katkıcıları' }).addTo(map);
  if (s.lat != null) Lf.circle([s.lat, s.lng], { radius: s.radius_km * 1000, weight: 1.5, dashArray: '5 5', className: 'scan-radius' }).addTo(map);
  const markers = new Map();
  for (const p of list) {
    if (p.lat == null) continue;
    const m = Lf.circleMarker([p.lat, p.lng], { radius: 8, weight: 2, className: `pin ${scoreTone(p.score)}` }).addTo(map);
    m.bindTooltip(`<b>${esc(p.name)}</b><br>${esc(p.category_label)} · puan ${p.score ?? '—'}`, { direction: 'top' });
    m.on('click', () => openProspect(p.id));
    markers.set(p.id, m);
  }
  map.on('click', async (e) => {
    if (await confirmDialog('Taramayı buradan yapalım mı?', `Seçilen nokta: ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`, { confirmText: 'Bu noktayı tara' })) {
      runScan({ lat: e.latlng.lat, lng: e.latlng.lng, location: `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}` });
    }
  });
  setTimeout(() => map.invalidateSize(), 50);

  // --- Scan ---
  const form = $('#scanForm');
  const formData = () => ({
    location: form.location.value.trim(), radius_km: Number(form.radius_km.value), source: form.source.value,
    categories: $$('input[name=cat]:checked', form).map((x) => x.value),
  });
  async function runScan(extra = {}) {
    const btn = $('#scanBtn');
    const data = { ...formData(), ...extra };
    if (!data.location && data.lat == null) return toast('Önce bir konum yazın veya haritada bir noktaya tıklayın', 'error');
    if (!data.categories.length) return toast('En az bir kategori seçin', 'error');
    await busy(btn, async () => {
      toast('Tarama başladı; işletmeler ve web siteleri tek tek inceleniyor…');
      const r = await act(() => POST('/prospects/scan', data));
      if (r) toast(`${r.found} işletme bulundu · ${r.added} yeni · ${r.analyzed} incelendi${r.errors?.length ? ` · ${r.errors.length} uyarı` : ''}`);
    });
    sessionStorage.setItem('prospectFilter', 'hot');
    app.route();
  }
  form.onsubmit = (e) => { e.preventDefault(); runScan(); };
  $('#locate').onclick = () => {
    if (!navigator.geolocation) return toast('Tarayıcınız konum desteklemiyor', 'error');
    navigator.geolocation.getCurrentPosition(
      (pos) => runScan({ lat: pos.coords.latitude, lng: pos.coords.longitude, location: 'Bulunduğum konum' }),
      () => toast('Konum izni verilmedi', 'error'), { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  $('#autoSend').onclick = async (e) => {
    const how = [d.capabilities.smtp && 'e-posta', d.capabilities.whatsapp_template && 'WhatsApp şablonu'].filter(Boolean).join(' / ');
    if (!how) return toast('Otomatik gönderim için SMTP veya WhatsApp şablonu gerekir. Tek tek "WhatsApp\'ta aç" ile gönderebilirsiniz.', 'error');
    if (!(await confirmDialog('Sıcak adaylara gönderilsin mi?', `Puanı ${s.min_score}+ olan ve ${how} ile ulaşılabilen işletmelere, günlük sınır (${d.stats.daily_limit - d.stats.today} kaldı) içinde mesaj gönderilecek.`, { confirmText: 'Gönder' }))) return;
    await busy(e.currentTarget, async () => {
      const r = await act(() => POST('/prospects/auto-send', {}));
      if (r) toast(r.reason || `${r.sent.length} işletmeye gönderildi${r.skipped.length ? ` · ${r.skipped.length} kanal olmadığı için atlandı` : ''}`);
    });
    app.route();
  };

  // --- Detail ---
  $$('.prospect').forEach((b) => {
    b.onclick = () => openProspect(Number(b.dataset.id));
    b.onmouseenter = () => markers.get(Number(b.dataset.id))?.setStyle({ radius: 12 });
    b.onmouseleave = () => markers.get(Number(b.dataset.id))?.setStyle({ radius: 8 });
  });

  async function openProspect(pid) {
    const p = d.prospects.find((x) => x.id === pid);
    if (!p) return;
    currentId = pid;
    $$('.prospect').forEach((x) => x.classList.toggle('active', Number(x.dataset.id) === pid));
    const m = markers.get(pid);
    if (m) { map.panTo(m.getLatLng()); m.openTooltip(); }
    const site = p.site_check || {};
    const check = (ok, label) => `<li class="${ok ? 'ok' : 'no'}">${icon(ok ? 'circle-check' : 'circle-x', 'xs')} ${label}</li>`;
    const canContact = ['new', 'analyzed'].includes(p.status);
    const result = await modal({
      drawer: true, hideFooter: true,
      title: esc(p.name),
      description: `${esc(p.category_label)}${p.address ? ` · ${esc(p.address)}` : ''}`,
      body: `<div class="pd">
        <div class="pd-score">${scoreBadge(p.score)}<div><b>Web sitesi ihtiyacı</b><p>${esc(p.score_reason || 'Henüz incelenmedi')}</p></div></div>
        <div class="pd-grid">
          <div><h4>İletişim</h4><ul class="pd-contact">
            <li>${icon('phone', 'xs')} ${p.phone ? `<a href="tel:+${esc(p.phone)}">+${esc(p.phone)}</a>` : '<span class="muted">Yok</span>'}</li>
            <li>${icon('mail', 'xs')} ${p.email ? esc(p.email) : '<span class="muted">Yok</span>'}</li>
            <li>${icon('globe', 'xs')} ${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener">${esc(p.website.replace(/^https?:\/\//, '').slice(0, 40))}</a>` : '<span class="muted">Yok</span>'}</li></ul></div>
          <div><h4>Site incelemesi</h4>${!site.exists ? '<p class="muted small">Web sitesi bulunamadı.</p>' : site.social_only ? `<p class="muted small">Sadece sosyal medya: ${esc(site.host)}</p>` : `<ul class="pd-checks">
            ${check(site.ok, site.ok ? 'Site açılıyor' : `Açılmıyor (${esc(site.error || site.status)})`)}
            ${site.ok ? `${check(site.https, 'HTTPS')}${check(site.mobile, 'Mobil uyumlu')}${check(!site.copyright_year || new Date().getFullYear() - site.copyright_year < 3, site.copyright_year ? `Güncellik (© ${site.copyright_year})` : 'Güncellik')}${check(site.ms < 4000, `Hız (${((site.ms || 0) / 1000).toFixed(1)} sn)`)}` : ''}</ul>`}</div>
        </div>
        ${(p.signals || []).length ? `<div class="pd-signals">${p.signals.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : ''}
        <label class="field">Mesaj ${canContact ? '<small>Düzenleyebilirsiniz; imza ve "İPTAL" cümlesi otomatik eklenir.</small>' : ''}
          <textarea id="pmsg" rows="6" ${canContact ? '' : 'readonly'}>${esc(p.message || '')}</textarea></label>
        ${p.status !== 'analyzed' && p.status !== 'new' ? `<div class="callout">${icon('circle-dot', 'sm')} Durum: <b>${STATUS[p.status]?.[0]}</b>${p.contacted_at ? ` · ${ago(p.contacted_at)} (${esc(p.channel)})` : ''}${p.conversation_id ? ` · <a class="link" href="#/conversations/${p.conversation_id}">Konuşmayı aç</a>` : ''}</div>` : ''}
        ${canContact ? `<div class="pd-actions">
          <button type="button" class="btn primary" data-ch="email" ${p.email && d.capabilities.smtp ? '' : 'disabled'} title="${!p.email ? 'E-posta adresi yok' : !d.capabilities.smtp ? 'SMTP ayarlı değil' : ''}">${icon('mail', 'sm')} E-posta gönder</button>
          <button type="button" class="btn" data-ch="whatsapp_link" ${p.phone ? '' : 'disabled'}>${icon('message-circle', 'sm')} WhatsApp'ta aç</button>
          ${d.capabilities.whatsapp_template ? `<button type="button" class="btn" data-ch="whatsapp" ${p.phone ? '' : 'disabled'}>${icon('send', 'sm')} WhatsApp şablonu</button>` : ''}
          <button type="button" class="btn" data-ch="phone" ${p.phone ? '' : 'disabled'}>${icon('phone-call', 'sm')} Aradım</button>
        </div>
        ${!p.email && !p.phone ? `<div class="callout warn">${icon('triangle-alert', 'sm')} İletişim bilgisi bulunamadı. Biliyorsanız ekleyin:</div>
          <div class="form-grid"><label class="field">E-posta<input id="addEmail" type="email"></label><label class="field">Telefon<input id="addPhone" inputmode="tel"></label></div>
          <button type="button" class="btn sm" id="saveContact">Kaydet</button>` : ''}` : ''}
        <div class="pd-foot">
          <button type="button" class="btn sm" id="reanalyze">${icon('refresh-cw', 'xs')} Yeniden incele</button>
          ${canContact ? `<button type="button" class="btn sm ghost" id="skipP">Atla</button>` : ''}
          ${p.status !== 'opted_out' ? `<button type="button" class="btn sm danger-ghost" id="blockP">${icon('ban', 'xs')} Bir daha yazma</button>` : ''}
        </div></div>`,
      onSubmit: () => false, // Enter in a field must not close the drawer; actions are handled below.
    }).then(() => null);
    return result;
  }

  // Delegated handlers for the drawer (it is rendered outside <main>).
  document.body.onclick = async (e) => {
    const dlg = e.target.closest('.dialog');
    if (!dlg || !dlg.querySelector('.pd')) return;
    const p = d.prospects.find((x) => x.id === currentId);
    if (!p) return;
    const msg = () => $('#pmsg', dlg)?.value;
    const done = (text) => { toast(text); dlg.closest('.overlay')?.remove(); app.route(); };
    const chBtn = e.target.closest('[data-ch]');
    if (chBtn) {
      const ch = chBtn.dataset.ch;
      if (ch === 'whatsapp_link') {
        const saved = await act(() => PUT(`/prospects/${p.id}`, { message: msg() }));
        if (!saved?.whatsapp_link) return;
        window.open(saved.whatsapp_link, '_blank', 'noopener');
        if (!(await confirmDialog('Mesajı WhatsApp\'tan gönderdiniz mi?', 'Gönderdiyseniz işletme "Yazıldı" olarak işaretlenir ve bir konuşma açılır; cevabını o konuşmaya yapıştırabilirsiniz.', { confirmText: 'Evet, gönderdim' }))) return;
      }
      if (ch === 'phone' && !(await confirmDialog('İşletmeyi aradınız mı?', 'Arandı olarak işaretlenir.', { confirmText: 'Evet' }))) return;
      const r = await busy(chBtn, () => act(() => POST(`/prospects/${p.id}/contact`, { channel: ch, message: msg() })));
      if (r) done(ch === 'email' ? 'E-posta gönderildi' : ch === 'whatsapp' ? 'WhatsApp şablonu gönderildi' : 'Kaydedildi');
      return;
    }
    if (e.target.closest('#reanalyze')) {
      const r = await busy(e.target.closest('#reanalyze'), () => act(() => POST(`/prospects/${p.id}/analyze`)));
      if (r) done('Yeniden incelendi');
    } else if (e.target.closest('#skipP')) {
      if (await act(() => POST(`/prospects/${p.id}/skip`))) done('Atlandı');
    } else if (e.target.closest('#blockP')) {
      if (await confirmDialog('Bu işletmeye bir daha yazılmasın mı?', 'Telefon ve e-postası kalıcı olarak engellenir.', { danger: true, confirmText: 'Engelle' })) {
        if (await act(() => POST(`/prospects/${p.id}/block`))) done('Engellendi');
      }
    } else if (e.target.closest('#saveContact')) {
      const r = await act(() => PUT(`/prospects/${p.id}`, { email: $('#addEmail', dlg).value, phone: $('#addPhone', dlg).value }));
      if (r) done('İletişim bilgisi kaydedildi');
    }
  };

  if (openId) openProspect(Number(openId));
}
