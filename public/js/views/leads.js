import {
  $, $$, GET, POST, PUT, act, ago, app, busy, empty, esc, field, icon, liveFilter, modal, money, onSegment, pageHeader, pill, searchBox, segmented, toast,
} from '../core.js';

export async function viewLeads(main) {
  const filter = sessionStorage.getItem('leadFilter') || 'active';
  const all = await GET('/leads');
  const count = (st) => all.filter((l) => st.includes(l.status)).length;
  const GROUPS = {
    active: ['new', 'needs_admin', 'contacted'], needs_admin: ['needs_admin'], contacted: ['contacted'], won: ['won'], filtered_out: ['filtered_out', 'lost'],
  };
  const list = all.filter((l) => GROUPS[filter].includes(l.status));

  main.innerHTML = `${pageHeader({
    title: 'İş ilanları',
    subtitle: 'Freelancer platformlarından kapsamınıza göre bulunan ilanlar. İletişim bilgisi olanlara yapay zeka yazar; olmayanlar size kalır.',
    actions: `<a class="btn" href="#/settings/scanner">${icon('filter', 'sm')} Kapsam</a><button class="btn primary" id="scan">${icon('refresh-cw', 'sm')} Şimdi tara</button>`,
  })}
  <div class="toolbar">
    ${segmented('lead', [['active', 'Aktif', count(GROUPS.active)], ['needs_admin', 'Size kalan', count(GROUPS.needs_admin)], ['contacted', 'Yazıldı', count(GROUPS.contacted)], ['won', 'Kazanılan', count(GROUPS.won)], ['filtered_out', 'Elenen', count(GROUPS.filtered_out)]], filter)}
    <span class="spacer"></span>${searchBox('İlan ara…')}
  </div>
  <div class="card-grid" id="grid">${list.map((l) => `
    <article class="lead-card ${l.status}">
      <div class="lc-top"><span class="platform">${icon('globe', 'xs')} ${esc(l.platform)}</span>${pill(l.status)}<time>${ago(l.created_at)}</time></div>
      <h3>${esc(l.title)}</h3>
      <p class="lc-desc">${esc(l.description.slice(0, 220))}${l.description.length > 220 ? '…' : ''}</p>
      ${l.skills ? `<div class="lc-skills">${l.skills.split(',').filter(Boolean).slice(0, 4).map((s) => `<span class="tag">${esc(s.trim())}</span>`).join('')}</div>` : ''}
      ${l.filter_reason ? `<div class="lc-reason">${icon('filter', 'xs')} ${esc(l.filter_reason)}</div>` : ''}
      <div class="lc-foot">
        <div class="lc-budget"><small>Bütçe</small><b>${l.budget_min != null ? money(l.budget_min) : '?'} – ${l.budget_max != null ? money(l.budget_max) : '?'} ${esc(l.currency || '')}</b></div>
        <div class="row-actions">
          ${l.url ? `<a class="icon-btn" href="${esc(l.url)}" target="_blank" rel="noopener" title="İlana git" aria-label="İlana git">${icon('external-link', 'sm')}</a>` : ''}
          ${l.conversation_id ? `<a class="icon-btn" href="#/conversations/${l.conversation_id}" title="Konuşma" aria-label="Konuşma">${icon('message-circle', 'sm')}</a>` : ''}
          ${!['won', 'lost'].includes(l.status) ? `<button class="icon-btn" data-lost="${l.id}" title="Kaybedildi" aria-label="Kaybedildi">${icon('x', 'sm')}</button>
            <button class="btn sm primary" data-project="${l.id}">${icon('check', 'xs')} İşi aldım</button>` : ''}
        </div>
      </div>
    </article>`).join('')}
    <div data-no-results hidden class="muted">Aramanızla eşleşen ilan yok.</div>
  </div>
  ${list.length ? '' : empty('Bu listede ilan yok', 'Platformları taramak için "Şimdi tara"ya basın veya otomasyonlardan düzenli taramayı açın.', 'target', '<button class="btn primary" id="scan2">Şimdi tara</button>')}`;

  onSegment(main, 'lead', (v) => { sessionStorage.setItem('leadFilter', v); app.route(); });
  liveFilter($('#q'), '.lead-card', main);
  const scan = (btn) => busy(btn, async () => {
    const r = await act(() => POST('/leads/scan'));
    if (!r) return;
    toast(`${r.fetched} ilan tarandı · ${r.contacted} yazıldı · ${r.needs_admin} size kaldı · ${r.filtered} elendi${r.errors?.length ? ` · ${r.errors.length} hata` : ''}`);
    app.route();
  });
  $('#scan').onclick = (e) => scan(e.currentTarget);
  $('#scan2')?.addEventListener('click', (e) => scan(e.currentTarget));
  $$('[data-project]').forEach((b) => { b.onclick = async () => {
    const lead = all.find((l) => String(l.id) === b.dataset.project);
    const r = await modal({
      title: 'İşi aldınız mı?', description: 'Proje açılır ve yapay zeka geliştirmeye başlar.', submitText: 'Projeyi oluştur',
      body: `<div class="form-grid">${field('title', 'Proje adı', { value: lead.title, required: true, span: true })}
        ${field('price', 'Anlaşılan fiyat', { type: 'number', value: lead.budget_max ?? '', required: true })}
        ${field('currency', 'Para birimi', { value: lead.currency || 'TRY' })}
        ${field('requirements', 'Gereksinimler', { type: 'textarea', value: lead.description, span: true, rows: 5 })}</div>`,
      onSubmit: (d) => POST(`/leads/${lead.id}/project`, d),
    });
    if (r) { toast('Proje oluşturuldu, yapay zeka geliştirmeye başladı'); location.hash = `#/projects/${r.id}`; }
  }; });
  $$('[data-lost]').forEach((b) => { b.onclick = () => act(() => PUT(`/leads/${b.dataset.lost}`, { status: 'lost' }), 'Kaybedildi olarak işaretlendi').then(app.route); });
}
