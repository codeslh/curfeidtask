import {
  $, $$, CHANNEL_ICON, GET, LABELS, POST, act, ago, app, avatar, date, empty, esc, icon, liveFilter, pill, segmented, onSegment,
} from '../core.js';

let shortcutCache = null;
export async function shortcuts(force = false) {
  if (force) shortcutCache = null;
  shortcutCache ??= (await fetch('/api/chat/info').then((r) => r.json())).shortcuts;
  return shortcutCache;
}
export const resetShortcuts = () => { shortcutCache = null; };

const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

export async function viewConversations(main, id) {
  const filter = sessionStorage.getItem('convFilter') || '';
  const all = await GET('/conversations');
  const list = filter ? all.filter((c) => (filter === 'ai' || filter === 'human' ? c.mode === filter : c.status === filter)) : all;
  const counts = { escalated: all.filter((c) => c.status === 'escalated').length, human: all.filter((c) => c.mode === 'human').length };

  main.classList.add('page-full');
  main.innerHTML = `<div class="inbox ${id ? 'has-open' : ''}">
    <section class="inbox-list">
      <div class="inbox-list-head">
        <div class="row-between"><h1 class="h-sm">Gelen kutusu</h1><span class="muted small">${all.length} konuşma</span></div>
        <label class="search">${icon('search', 'sm')}<input id="q" type="search" placeholder="İsim veya mesaj ara…" autocomplete="off"></label>
        ${segmented('conv', [['', 'Tümü'], ['escalated', 'Bekleyen', counts.escalated], ['human', 'Admin'], ['ai', 'Yapay zeka']], filter)}
      </div>
      <div class="inbox-items" id="items">${list.map((c) => `
        <a class="inbox-item ${String(c.id) === id ? 'active' : ''} ${c.status === 'escalated' ? 'urgent' : ''}" href="#/conversations/${c.id}">
          <span class="avatar-wrap">${avatar(c.customer_name || '#')}<span class="channel-dot" title="${LABELS[c.channel]}">${icon(CHANNEL_ICON[c.channel] || 'message-circle', 'xs')}</span></span>
          <span class="ii-body"><span class="ii-top"><b>${esc(c.customer_name || `#${c.id}`)}</b><time>${ago(c.last_message_at)}</time></span>
            <span class="ii-last">${esc(c.last_message || '')}</span>
            <span class="ii-tags">${c.mode === 'ai' ? `<span class="tag accent">${icon('sparkles', 'xs')} Yapay zeka</span>` : `<span class="tag warn">${icon('user', 'xs')} Admin</span>`}${c.status === 'escalated' ? '<span class="tag bad">Bekliyor</span>' : ''}</span></span>
        </a>`).join('') || empty('Konuşma yok', 'Müşteriler yazdığında burada görünecek.', 'message-circle')}
        <div data-no-results hidden class="muted center pad">Sonuç yok</div></div>
    </section>
    <section class="inbox-thread" id="thread">${id ? '' : `<div class="thread-empty">${empty('Bir konuşma seçin', 'Soldan bir sohbet açın. Yapay zeka cevap veremediğinde konuşmalar burada "Bekliyor" olarak işaretlenir.', 'message-square-text')}</div>`}</section>
    <aside class="inbox-info" id="info"></aside>
  </div>`;
  onSegment(main, 'conv', (v) => { sessionStorage.setItem('convFilter', v); app.route(); });
  liveFilter($('#q'), '.inbox-item', main);
  if (!id) return;

  const thread = $('#thread');
  const info = $('#info');
  const sc = await shortcuts();
  let lastCount = -1;

  const draw = async () => {
    const d = await GET(`/conversations/${id}`);
    if (d.messages.length === lastCount) return;
    const draft = $('#reply')?.value || '';
    lastCount = d.messages.length;
    const c = d.conversation;
    const cu = d.customer || {};
    const who = { customer: cu.name || 'Müşteri', ai: 'Yapay zeka', admin: 'Siz', system: '' };
    let lastDay = '';
    const bubbles = d.messages.map((m) => {
      const dayStr = new Date(`${m.created_at.replace(' ', 'T')}Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
      const sep = dayStr !== lastDay ? `<div class="day-sep"><span>${dayStr}</span></div>` : '';
      lastDay = dayStr;
      if (m.sender === 'system') return `${sep}<div class="sys-msg">${icon('circle-dot', 'xs')} ${esc(m.body)}</div>`;
      const time = new Date(`${m.created_at.replace(' ', 'T')}Z`).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      return `${sep}<div class="bubble ${m.sender}"><div class="b-meta">${m.sender === 'ai' ? icon('sparkles', 'xs') : ''}${esc(who[m.sender])}<time>${time}</time></div>${linkify(m.body)}</div>`;
    }).join('');

    thread.innerHTML = `<header class="thread-head">
        <a href="#/conversations" class="icon-btn mobile-only" aria-label="Geri">${icon('arrow-left')}</a>
        ${avatar(cu.name || '#')}
        <div class="th-title"><b>${esc(cu.name || 'Müşteri')}</b><span>${icon(CHANNEL_ICON[c.channel] || 'message-circle', 'xs')} ${LABELS[c.channel]} · ${c.mode === 'ai' ? 'Yapay zeka yanıtlıyor' : 'Siz yanıtlıyorsunuz'}</span></div>
        <span class="spacer"></span>
        ${c.mode === 'ai' ? `<button id="takeover" class="btn primary sm">${icon('user', 'sm')} Devral</button>` : `<button id="release" class="btn ai sm">${icon('sparkles', 'sm')} Yapay zekaya ver</button>`}
        <button id="close" class="icon-btn" title="Konuşmayı kapat" aria-label="Konuşmayı kapat">${icon('check')}</button>
      </header>
      ${c.status === 'escalated' ? `<div class="thread-alert">${icon('circle-alert', 'sm')}<span><b>Size aktarıldı:</b> ${esc(c.escalation_reason || '')}</span></div>` : ''}
      <div class="thread-body" id="msgs">${bubbles}</div>
      <footer class="composer">
        <div class="quick">${[
          ...sc.themes.map((t) => [`${icon('sparkles', 'xs')} ${esc(t.name)}`, `Tema önerisi: ${t.name}${t.preview_url ? ` (${t.preview_url})` : ''}`]),
          ...sc.languages.map((l) => [`${icon('cpu', 'xs')} ${esc(l.name)}`, `Teknoloji: ${l.name}`]),
          ...sc.products.map((p) => [`${icon('package', 'xs')} ${esc(p.name)}`, `${p.name}${p.demo_url ? ` örneği: ${p.demo_url}` : ''}`]),
        ].map(([l, t]) => `<button type="button" class="quick-chip" data-text="${esc(t)}">${l}</button>`).join('')}</div>
        <form id="send" class="composer-box">
          <textarea id="reply" rows="1" placeholder="${c.mode === 'ai' ? 'Yazarsanız konuşmayı devralırsınız…' : 'Bir mesaj yazın…'}" aria-label="Mesaj"></textarea>
          <button class="btn primary icon-only" aria-label="Gönder">${icon('send', 'sm')}</button>
        </form>
        <div class="composer-hint"><kbd>Enter</kbd> gönder · <kbd>Shift</kbd>+<kbd>Enter</kbd> yeni satır</div>
      </footer>`;

    const p = d.project;
    info.innerHTML = `<div class="info-card center">
        ${avatar(cu.name || '#', 'lg')}<h3>${esc(cu.name || 'Müşteri')}</h3>
        <div class="row center-x">${pill(c.mode)}${pill(c.status)}</div></div>
      <dl class="info-list">
        <div><dt>${icon('phone', 'xs')} Telefon</dt><dd>${esc(cu.phone || '—')}</dd></div>
        <div><dt>${icon('mail', 'xs')} E-posta</dt><dd>${esc(cu.email || '—')}</dd></div>
        <div><dt>${icon(CHANNEL_ICON[c.channel] || 'globe', 'xs')} Kanal</dt><dd>${LABELS[c.channel]}</dd></div>
        <div><dt>${icon('calendar', 'xs')} İlk temas</dt><dd>${date(c.created_at)}</dd></div>
        <div><dt>${icon('message-circle', 'xs')} Mesaj</dt><dd>${d.messages.filter((m) => m.sender !== 'system').length}</dd></div>
      </dl>
      ${p ? `<a class="info-project" href="#/projects/${p.id}"><span class="tile-icon accent">${icon('folder-kanban')}</span><div><b>${esc(p.title)}</b>${pill(p.status)}</div>${icon('chevron-right', 'sm')}</a>`
    : '<div class="info-note">Henüz proje yok. Müşteri fiyatta anlaşınca yapay zeka projeyi otomatik açar.</div>'}
      ${c.channel === 'platform' ? '<div class="info-note">Bu konuşma bir freelancer platformunda; mesajları platformdan iletin.</div>' : ''}`;

    const reply = $('#reply');
    reply.value = draft;
    const grow = () => { reply.style.height = 'auto'; reply.style.height = `${Math.min(160, reply.scrollHeight)}px`; };
    reply.oninput = grow; grow();
    reply.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#send').requestSubmit(); } };
    const msgs = $('#msgs'); msgs.scrollTop = msgs.scrollHeight;
    $$('.quick-chip', thread).forEach((b) => { b.onclick = () => { reply.value = `${reply.value}${reply.value ? '\n' : ''}${b.dataset.text}`; grow(); reply.focus(); }; });
    $('#takeover')?.addEventListener('click', () => act(() => POST(`/conversations/${id}/takeover`), 'Konuşmayı devraldınız').then(() => { lastCount = -1; draw(); }));
    $('#release')?.addEventListener('click', () => act(() => POST(`/conversations/${id}/release`), 'Yapay zeka devam edecek').then(() => { lastCount = -1; draw(); }));
    $('#close').onclick = () => act(() => POST(`/conversations/${id}/close`), 'Konuşma kapatıldı').then(() => { location.hash = '#/conversations'; });
    $('#send').onsubmit = async (e) => {
      e.preventDefault();
      const text = reply.value.trim();
      if (!text) return;
      reply.value = '';
      if (await act(() => POST(`/conversations/${id}/messages`, { text }))) { lastCount = -1; draw(); } else reply.value = text;
    };
  };
  await draw();
  app.poll = setInterval(() => draw().catch(() => {}), 4000);
}
