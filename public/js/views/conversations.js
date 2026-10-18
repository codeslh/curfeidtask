import {
  $, $$, CHANNEL_ICON, GET, LABELS, POST, act, ago, app, avatar, date, empty, esc, icon, liveFilter, pill, segmented, onSegment,
} from '../core.js';

const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
const waLink = (phone, text) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

export async function viewConversations(main, id) {
  const filter = sessionStorage.getItem('convFilter') || '';
  const all = await GET('/conversations');
  const waiting = (c) => c.status === 'open' && c.last_sender === 'customer';
  const list = all.filter((c) => (filter === 'waiting' ? waiting(c) : filter === 'closed' ? c.status === 'closed' : filter === 'open' ? c.status === 'open' : true));

  main.classList.add('page-full');
  main.innerHTML = `<div class="inbox ${id ? 'has-open' : ''}">
    <section class="inbox-list">
      <div class="inbox-list-head">
        <div class="row-between"><h1 class="h-sm">Konuşmalar</h1><span class="muted small">${all.length} konuşma</span></div>
        <label class="search">${icon('search', 'sm')}<input id="q" type="search" placeholder="İsim veya mesaj ara…" autocomplete="off"></label>
        ${segmented('conv', [['', 'Tümü'], ['waiting', 'Cevap bekleyen', all.filter(waiting).length], ['open', 'Açık'], ['closed', 'Kapalı']], filter)}
      </div>
      <div class="inbox-items" id="items">${list.map((c) => `
        <a class="inbox-item ${String(c.id) === id ? 'active' : ''} ${waiting(c) ? 'urgent' : ''}" href="#/conversations/${c.id}">
          <span class="avatar-wrap">${avatar(c.customer_name || '#')}<span class="channel-dot" title="${LABELS[c.channel] || c.channel}">${icon(CHANNEL_ICON[c.channel] || 'message-circle', 'xs')}</span></span>
          <span class="ii-body"><span class="ii-top"><b>${esc(c.customer_name || `#${c.id}`)}</b><time>${ago(c.last_message_at)}</time></span>
            <span class="ii-last">${c.last_sender === 'admin' ? 'Siz: ' : ''}${esc(c.last_message || '')}</span>
            <span class="ii-tags">${waiting(c) ? '<span class="tag warn">Cevabınızı bekliyor</span>' : ''}${c.status === 'closed' ? '<span class="tag">Kapalı</span>' : ''}</span></span>
        </a>`).join('') || empty('Konuşma yok', 'Bir ilan sahibine veya işletmeye yazdığınızda ve size cevap geldiğinde burada görünür.', 'message-circle')}
        <div data-no-results hidden class="muted center pad">Sonuç yok</div></div>
    </section>
    <section class="inbox-thread" id="thread">${id ? '' : `<div class="thread-empty">${empty('Bir konuşma seçin', 'E-posta cevapları IMAP ayarlıysa kendiliğinden gelir. WhatsApp\'tan gelen cevapları konuşmaya "Gelen mesajı ekle" ile yapıştırabilirsiniz.', 'message-square-text')}</div>`}</section>
    <aside class="inbox-info" id="info"></aside>
  </div>`;
  onSegment(main, 'conv', (v) => { sessionStorage.setItem('convFilter', v); app.route(); });
  liveFilter($('#q'), '.inbox-item', main);
  if (!id) return;

  const thread = $('#thread');
  const info = $('#info');
  let lastCount = -1;

  const draw = async () => {
    const d = await GET(`/conversations/${id}`);
    if (d.messages.length === lastCount) return;
    const draft = $('#reply')?.value || '';
    lastCount = d.messages.length;
    const c = d.conversation;
    const cu = d.customer || {};
    const who = { customer: cu.name || 'Kişi', admin: 'Siz', ai: 'Otomatik', system: '' };
    const waPhone = String(cu.phone || (c.channel === 'whatsapp' ? c.external_id : '') || '').replace(/[^\d]/g, '');
    const mode = sessionStorage.getItem(`replyMode:${id}`) || 'reply';
    const emailNoSmtp = c.channel === 'email' && !d.smtp;
    let lastDay = '';
    const bubbles = d.messages.map((m) => {
      const dayStr = new Date(`${m.created_at.replace(' ', 'T')}Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
      const sep = dayStr !== lastDay ? `<div class="day-sep"><span>${dayStr}</span></div>` : '';
      lastDay = dayStr;
      if (m.sender === 'system') return `${sep}<div class="sys-msg">${icon('circle-dot', 'xs')} ${esc(m.body)}</div>`;
      const time = new Date(`${m.created_at.replace(' ', 'T')}Z`).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      const relayLink = d.relay && m.sender !== 'customer' && waPhone ? `<a class="b-relay" href="${waLink(waPhone, m.body)}" target="_blank" rel="noopener">${icon('external-link', 'xs')} WhatsApp'ta gönder</a>` : '';
      return `${sep}<div class="bubble ${m.sender === 'customer' ? 'customer' : 'admin'}"><div class="b-meta">${esc(who[m.sender] ?? '')}<time>${time}</time></div>${linkify(m.body)}${relayLink}</div>`;
    }).join('');

    thread.innerHTML = `<header class="thread-head">
        <a href="#/conversations" class="icon-btn mobile-only" aria-label="Geri">${icon('arrow-left')}</a>
        ${avatar(cu.name || '#')}
        <div class="th-title"><b>${esc(cu.name || 'Kişi')}</b><span>${icon(CHANNEL_ICON[c.channel] || 'message-circle', 'xs')} ${LABELS[c.channel] || c.channel}${c.status === 'closed' ? ' · Kapalı' : ''}</span></div>
        <span class="spacer"></span>
        ${c.status === 'closed' ? `<button id="reopen" class="btn sm">${icon('refresh-cw', 'sm')} Yeniden aç</button>` : `<button id="close" class="btn sm ghost" title="Konuşmayı kapat">${icon('check', 'sm')} Kapat</button>`}
      </header>
      ${d.relay ? `<div class="relay-bar">${icon('message-circle', 'sm')}<span><b>WhatsApp:</b> Cevabınızı yazıp gönderince WhatsApp açılır, mesaj hazır gelir; siz gönder'e basarsınız. Karşı tarafın cevabını "Gelen mesajı ekle" ile buraya yapıştırın.</span></div>` : ''}
      ${emailNoSmtp ? `<div class="thread-alert">${icon('circle-alert', 'sm')}<span>SMTP ayarlı değil: yazdığınız cevaplar kaydedilir ama e-posta olarak gönderilmez. .env dosyasına SMTP bilgilerini girin.</span></div>` : ''}
      <div class="thread-body" id="msgs">${bubbles}</div>
      <footer class="composer">
        <div class="composer-mode">${segmented('cmode', [['reply', `${icon('send', 'xs')} Yanıt yaz`], ['inbound', `${icon('arrow-down', 'xs')} Gelen mesajı ekle`]], mode)}</div>
        <form id="send" class="composer-box">
          <textarea id="reply" rows="1" placeholder="${mode === 'inbound' ? 'Karşı tarafın WhatsApp\'tan / telefonda söylediğini buraya yapıştırın…' : 'Bir mesaj yazın…'}" aria-label="Mesaj"></textarea>
          <button class="btn primary icon-only" aria-label="Gönder">${icon('send', 'sm')}</button>
        </form>
        <div class="composer-hint"><kbd>Enter</kbd> gönder · <kbd>Shift</kbd>+<kbd>Enter</kbd> yeni satır</div>
      </footer>`;

    info.innerHTML = `<div class="info-card center">
        ${avatar(cu.name || '#', 'lg')}<h3>${esc(cu.name || 'Kişi')}</h3>
        <div class="row center-x">${pill(c.status)}</div></div>
      <dl class="info-list">
        <div><dt>${icon('phone', 'xs')} Telefon</dt><dd>${cu.phone ? `<a href="tel:+${esc(cu.phone)}">+${esc(cu.phone)}</a>` : '—'}</dd></div>
        <div><dt>${icon('mail', 'xs')} E-posta</dt><dd>${esc(cu.email || '—')}</dd></div>
        <div><dt>${icon(CHANNEL_ICON[c.channel] || 'globe', 'xs')} Kanal</dt><dd>${LABELS[c.channel] || c.channel}</dd></div>
        <div><dt>${icon('calendar', 'xs')} İlk temas</dt><dd>${date(c.created_at)}</dd></div>
      </dl>
      ${d.lead ? `<a class="info-project" href="#/leads/${d.lead.id}"><span class="tile-icon accent">${icon('target')}</span><div><b>${esc(d.lead.title)}</b>${pill(d.lead.status)}</div>${icon('chevron-right', 'sm')}</a>` : ''}
      ${d.prospect ? `<a class="info-project" href="#/prospects/${d.prospect.id}"><span class="tile-icon info">${icon('store')}</span><div><b>${esc(d.prospect.name)}</b>${pill(d.prospect.status)}</div>${icon('chevron-right', 'sm')}</a>` : ''}
      ${cu.notes ? `<div class="info-note">${esc(cu.notes)}</div>` : ''}`;

    const reply = $('#reply');
    reply.value = draft;
    const grow = () => { reply.style.height = 'auto'; reply.style.height = `${Math.min(160, reply.scrollHeight)}px`; };
    reply.oninput = grow; grow();
    reply.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#send').requestSubmit(); } };
    const msgs = $('#msgs'); msgs.scrollTop = msgs.scrollHeight;
    $('#close')?.addEventListener('click', () => act(() => POST(`/conversations/${id}/close`), 'Konuşma kapatıldı').then(() => { location.hash = '#/conversations'; }));
    $('#reopen')?.addEventListener('click', () => act(() => POST(`/conversations/${id}/reopen`), 'Konuşma açıldı').then(() => { lastCount = -1; draw(); }));
    onSegment(thread, 'cmode', (v) => { sessionStorage.setItem(`replyMode:${id}`, v); lastCount = -1; draw(); });
    $('#send').onsubmit = async (e) => {
      e.preventDefault();
      const text = reply.value.trim();
      if (!text) return;
      reply.value = '';
      const inbound = mode === 'inbound';
      const r = await act(() => POST(`/conversations/${id}/${inbound ? 'inbound' : 'messages'}`, { text }), inbound ? 'Gelen mesaj eklendi' : null);
      if (!r) { reply.value = text; return; }
      if (r.relay && waPhone) window.open(waLink(waPhone, text), '_blank', 'noopener');
      lastCount = -1; draw();
    };
  };
  await draw();
  app.poll = setInterval(() => draw().catch(() => {}), 5000);
}
