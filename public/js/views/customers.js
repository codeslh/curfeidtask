import {
  $, $$, GET, PUT, act, ago, app, avatar, empty, esc, icon, isAdmin, liveFilter, modal, pageHeader, searchBox,
} from '../core.js';

const SOURCE = { bolge: 'Bölge taraması' };

export async function viewCustomers(main) {
  const list = await GET('/customers');
  main.innerHTML = `${pageHeader({
    title: 'Kişiler',
    subtitle: `Yazıştığınız ${list.length} kişi ve işletme. Bir satıra tıklayarak not ekleyebilirsiniz.`,
    actions: isAdmin() ? `<a class="btn" href="/api/export/customers.csv">${icon('download', 'sm')} CSV</a>` : '',
  })}
  <div class="toolbar">${searchBox('İsim, telefon veya e-posta ara…')}</div>
  ${list.length ? `<div class="card flush"><table class="table"><thead><tr><th>Kişi</th><th>İletişim</th><th>Nereden</th><th>Not</th><th>Son mesaj</th><th></th></tr></thead><tbody>
    ${list.map((c) => `<tr data-id="${c.id}" class="clickable"><td><div class="cell-user">${avatar(c.name)}<div><div class="cell-title">${esc(c.name)}</div><div class="muted small">#${c.id}</div></div></div></td>
      <td><div class="small">${c.phone ? `${icon('phone', 'xs')} ${esc(c.phone)}` : ''}</div><div class="small muted">${c.email ? `${icon('mail', 'xs')} ${esc(c.email)}` : ''}</div>${!c.phone && !c.email ? '<span class="muted">—</span>' : ''}</td>
      <td>${c.platform ? `<span class="tag">${esc(SOURCE[c.platform] || c.platform)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="small">${c.notes ? esc(c.notes.slice(0, 60)) : '<span class="muted">—</span>'}</td>
      <td class="muted">${c.last_message_at ? ago(c.last_message_at) : '—'}</td>
      <td>${c.conversation_id ? `<a class="btn sm ghost" href="#/conversations/${c.conversation_id}" data-stop>${icon('message-circle', 'xs')} Konuşma</a>` : ''}</td></tr>`).join('')}
    </tbody></table><div data-no-results hidden class="muted center pad">Eşleşen kişi yok</div></div>`
    : empty('Henüz kimse yok', 'Bir ilan sahibine veya işletmeye yazdığınızda burada görünür.', 'users')}`;
  liveFilter($('#q'), 'tbody tr', main);
  $$('[data-stop]').forEach((a) => { a.onclick = (e) => e.stopPropagation(); });
  $$('tr[data-id]').forEach((tr) => {
    tr.onclick = async () => {
      const c = list.find((x) => String(x.id) === tr.dataset.id);
      const r = await modal({
        title: esc(c.name), submitText: 'Kaydet',
        body: `<div class="form-grid">
          <label class="field span-2">Ad<input name="name" value="${esc(c.name)}" required></label>
          <label class="field">E-posta<input name="email" type="email" value="${esc(c.email || '')}"></label>
          <label class="field">Telefon<input name="phone" value="${esc(c.phone || '')}"></label>
          <label class="field span-2">Notlar<textarea name="notes" rows="4" placeholder="ör. Fiyat teklifi verildi, haftaya aranacak">${esc(c.notes || '')}</textarea></label></div>`,
        onSubmit: (d) => PUT(`/customers/${c.id}`, d),
      });
      if (r) { await act(async () => r, 'Kaydedildi'); app.route(); }
    };
  });
}
