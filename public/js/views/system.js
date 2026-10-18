// Notifications, account security, team, audit log, scheduled tasks and settings.
import {
  $, $$, DEL, GET, POST, PUT, act, ago, app, avatar, busy, confirmDialog, date, empty, esc, field, icon, isAdmin, liveFilter, modal,
  onSegment, pageHeader, parseDate, pill, searchBox, segmented, toast, toggle, until, LABELS,
} from '../core.js';
import { noteIcon } from './dashboard.js';

// --- Notifications ---------------------------------------------------------------

export async function viewNotifications(main) {
  const filter = sessionStorage.getItem('noteFilter') || 'all';
  const all = await GET('/notifications');
  const list = filter === 'unread' ? all.filter((n) => !n.read) : filter === 'security' ? all.filter((n) => n.type === 'security') : all;
  const dayKey = (n) => {
    const d = parseDate(n.created_at); const t = new Date(); t.setHours(0, 0, 0, 0);
    const diff = Math.floor((t - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
    return diff <= 0 ? 'Bugün' : diff === 1 ? 'Dün' : diff < 7 ? 'Bu hafta' : 'Daha eski';
  };
  const groups = [];
  for (const n of list) {
    const k = dayKey(n);
    (groups.find((g) => g.k === k) || groups[groups.push({ k, items: [] }) - 1]).items.push(n);
  }
  main.innerHTML = `${pageHeader({
    title: 'Bildirimler',
    subtitle: 'Size e-postayla da gönderilen tüm uyarılar.',
    actions: `<button class="btn" id="all">${icon('check', 'sm')} Tümünü okundu yap</button>`,
  })}
  <div class="toolbar">${segmented('note', [['all', 'Tümü', all.length], ['unread', 'Okunmamış', all.filter((n) => !n.read).length], ['security', 'Güvenlik', all.filter((n) => n.type === 'security').length]], filter)}</div>
  ${groups.length ? groups.map((g) => `<section class="note-group"><h3 class="group-title">${g.k}</h3><div class="card flush">
    ${g.items.map((n) => {
      const [ic, tone] = noteIcon(n.type);
      return `<button class="note ${n.read ? 'read' : ''}" data-id="${n.id}" data-link="${esc(n.link || '')}">
        <span class="tile-icon ${tone}">${icon(ic, 'sm')}</span>
        <span class="note-body"><span class="note-top"><b>${esc(n.subject)}</b><time>${ago(n.created_at)}</time></span>
          <span class="note-text">${esc(n.body)}</span>
          ${n.emailed ? `<span class="tag">${icon('mail', 'xs')} e-posta gönderildi</span>` : ''}</span>
        ${n.read ? '' : '<span class="unread-dot" aria-label="Okunmadı"></span>'}</button>`;
    }).join('')}</div></section>`).join('') : empty('Her şey yolunda', 'Okunacak bildirim yok.', 'bell')}`;
  onSegment(main, 'note', (v) => { sessionStorage.setItem('noteFilter', v); app.route(); });
  $('#all').onclick = () => act(() => POST('/notifications/read-all'), 'Tümü okundu').then(app.route);
  $$('.note').forEach((el) => { el.onclick = async () => {
    await POST(`/notifications/${el.dataset.id}/read`).catch(() => {});
    if (el.dataset.link) location.hash = `#${el.dataset.link}`; else app.route();
  }; });
}

// --- Security (own account; admins also see the login log) ----------------------------

export async function viewSecurity(main) {
  const susp = sessionStorage.getItem('suspOnly') === '1';
  const [account, sessions, events] = await Promise.all([
    GET('/me'), GET('/security/sessions'), isAdmin() ? GET(`/security/events${susp ? '?suspicious=1' : ''}`) : Promise.resolve(null),
  ]);
  const openSessions = sessions.sessions.filter((x) => !x.revoked_at && new Date(x.expires_at) > new Date());
  const recentSuspicious = (events || []).some((e) => e.suspicious && Date.now() - parseDate(e.created_at) < 7 * 864e5);
  const score = [account.totp_enabled, openSessions.length <= 2, !recentSuspicious].filter(Boolean).length;

  main.innerHTML = `${pageHeader({ title: 'Hesap ve güvenlik', subtitle: `${esc(account.email)} · ${LABELS[account.role]}` })}
  <section class="bento">
    <div class="card span-4 sec-score ${account.totp_enabled ? 'good' : 'warn'}">
      <div class="ring" style="--p:${(score / 3) * 100}"><span>${score}/3</span></div>
      <div><h2>${account.totp_enabled ? 'Hesabınız iyi korunuyor' : 'Korumayı güçlendirin'}</h2>
        <p>${account.totp_enabled ? 'İki adımlı doğrulama açık.' : 'İki adımlı doğrulamayı açarak şifreniz çalınsa bile hesabınızı koruyun.'}</p></div>
    </div>
    <div class="card span-8" id="twofa">
      <div class="card-head"><div><h2>${icon('shield-check', 'sm')} İki adımlı doğrulama</h2><p>Google Authenticator, Microsoft Authenticator, Authy veya 1Password</p></div>
        ${account.totp_enabled ? pill('ok', 'Açık') : pill('pending', 'Kapalı')}</div>
      <div id="twofaBody">${account.totp_enabled
    ? `<div class="row"><button class="btn" id="newCodes">${icon('key-round', 'sm')} Yeni kurtarma kodları</button><button class="btn danger-ghost" id="disable2fa">2FA'yı kapat</button></div>`
    : `<button class="btn primary" id="setup2fa">${icon('shield-check', 'sm')} Kurulumu başlat</button>`}</div>
    </div>
  </section>
  <div class="split even">
    <div class="card">
      <div class="card-head"><div><h2>${icon('key-round', 'sm')} Şifre değiştir</h2><p>Değiştirdiğinizde diğer oturumlarınız kapanır.</p></div></div>
      <form id="pw" class="stack">${field('current', 'Mevcut şifre', { type: 'password', required: true })}
        <div class="form-grid">${field('next', 'Yeni şifre', { type: 'password', required: true })}${field('next2', 'Yeni şifre (tekrar)', { type: 'password', required: true })}</div>
        <div><button class="btn primary">Şifreyi güncelle</button></div></form>
    </div>
    <div class="card flush">
      <div class="card-head pad"><div><h2>${icon('monitor', 'sm')} Oturumlarım</h2><p>${openSessions.length} açık oturum</p></div>
        ${openSessions.length > 1 ? '<button class="btn sm" id="others">Diğerlerini kapat</button>' : ''}</div>
      <ul class="session-list">${sessions.sessions.slice(0, 8).map((x) => {
        const current = x.id === sessions.current;
        const open = !x.revoked_at && new Date(x.expires_at) > new Date();
        const ua = x.user_agent || '';
        const device = /iPhone|Android/i.test(ua) ? 'phone' : 'monitor';
        const browser = (ua.match(/(Edg|Chrome|Firefox|Safari)\/[\d.]+/) || ['Tarayıcı'])[0].split('/')[0].replace('Edg', 'Edge');
        return `<li><span class="tile-icon neutral">${icon(device, 'sm')}</span><div><b>${browser} · ${esc(x.ip)}</b><span class="muted small">Son görülme ${ago(x.last_seen_at)}</span></div>
          <span class="spacer"></span>${current ? pill('ok', 'Bu cihaz') : open ? `<button class="btn sm danger-ghost" data-revoke="${x.id}">Sonlandır</button>` : '<span class="muted small">Kapalı</span>'}</li>`;
      }).join('')}</ul>
    </div>
  </div>
  ${events ? `<div class="card flush">
    <div class="card-head pad"><div><h2>${icon('activity', 'sm')} Giriş kayıtları</h2><p>Tüm kullanıcıların giriş, çıkış ve şüpheli denemeleri</p></div>
      <div class="row">${toggle('susp', susp, 'Sadece şüpheli', 'id="susp"')}<a class="btn sm" href="/api/backup">${icon('download', 'xs')} Veritabanı yedeği</a></div></div>
    <table class="table"><thead><tr><th>Olay</th><th>Kullanıcı</th><th>IP</th><th>Cihaz</th><th>Zaman</th></tr></thead><tbody>
    ${events.slice(0, 100).map((e) => `<tr class="${e.suspicious ? 'row-alert' : ''}"><td>${pill(e.event)} ${e.suspicious ? `<span class="tag bad">${icon('triangle-alert', 'xs')} Şüpheli</span>` : ''}${e.detail ? `<div class="muted small">${esc(e.detail)}</div>` : ''}</td>
      <td>${esc(e.email || '—')}</td><td class="mono small">${esc(e.ip || '')}</td><td class="muted small ellipsis">${esc((e.user_agent || '').slice(0, 48))}</td><td class="muted small">${date(e.created_at)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted center">Kayıt yok</td></tr>'}</tbody></table></div>` : ''}`;

  const body = $('#twofaBody');
  const showCodes = (codes) => {
    body.innerHTML = `<div class="callout good">${icon('circle-check', 'sm')} Bu kodları güvenli bir yere kaydedin. Yalnızca şimdi gösterilir; her biri bir kez kullanılabilir.</div>
      <div class="codes">${codes.map((c) => `<code>${esc(c)}</code>`).join('')}</div><div class="row"><button class="btn" id="copy">${icon('file-text', 'sm')} Kopyala</button><button class="btn primary" id="done">Kaydettim</button></div>`;
    $('#copy').onclick = () => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast('Kopyalandı'));
    $('#done').onclick = app.route;
  };
  $('#setup2fa')?.addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    const r = await act(() => POST('/security/2fa/setup'));
    if (!r) return;
    body.innerHTML = `<div class="totp-setup"><img src="${r.qr}" alt="2FA QR kodu" width="184" height="184">
      <ol class="steps-v"><li><b>QR kodu okutun</b><span>Doğrulama uygulamasında "+" → QR kodu tara.</span></li>
        <li><b>Okutamıyor musunuz?</b><span>Bu anahtarı elle girin: <code class="select-all">${esc(r.secret)}</code></span></li>
        <li><b>Kodu girin</b><form id="en" class="row"><input name="code" class="otp sm" placeholder="000000" inputmode="numeric" autocomplete="one-time-code" required><button class="btn primary">Etkinleştir</button></form></li></ol></div>`;
    $('#en input').focus();
    $('#en').onsubmit = async (e) => {
      e.preventDefault();
      const ok = await act(() => POST('/security/2fa/enable', { code: e.target.code.value }), 'İki adımlı doğrulama açıldı');
      if (ok) { app.me.totp_enabled = true; showCodes(ok.recovery_codes); }
    };
  }));
  $('#newCodes')?.addEventListener('click', async () => {
    const r = await modal({
      title: 'Yeni kurtarma kodları', description: 'Eski kodlar geçersiz olur.', submitText: 'Oluştur',
      body: field('code', 'Doğrulama uygulamanızdaki kod', { required: true, placeholder: '000000' }),
      onSubmit: (d) => POST('/security/2fa/recovery-codes', d),
    });
    if (r) showCodes(r.recovery_codes);
  });
  $('#disable2fa')?.addEventListener('click', async () => {
    const r = await modal({
      title: 'İki adımlı doğrulamayı kapat', description: 'Hesabınız yalnızca şifreyle korunur. Yöneticilere uyarı gider.', submitText: 'Kapat', danger: true,
      body: `<div class="stack">${field('password', 'Şifreniz', { type: 'password', required: true })}${field('code', 'Doğrulama kodu', { required: true })}</div>`,
      onSubmit: (d) => POST('/security/2fa/disable', d),
    });
    if (r) app.route();
  });
  $('#pw').onsubmit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (d.next !== d.next2) return toast('Yeni şifreler eşleşmiyor', 'error');
    busy($('button', e.target), () => act(() => POST('/security/password', d), 'Şifre değiştirildi')).then((r) => r && app.route());
  };
  $('#others')?.addEventListener('click', () => act(() => POST('/security/sessions/revoke-others'), 'Diğer oturumlar kapatıldı').then(app.route));
  $('#susp')?.addEventListener('change', (e) => { sessionStorage.setItem('suspOnly', e.target.checked ? '1' : ''); app.route(); });
  $$('[data-revoke]').forEach((b) => { b.onclick = () => act(() => DEL(`/security/sessions/${b.dataset.revoke}`), 'Oturum sonlandırıldı').then(app.route); });
}

// --- Team ------------------------------------------------------------------------------

export async function viewUsers(main) {
  const { users, roles } = await GET('/users');
  const roleOpts = Object.entries(roles);
  main.innerHTML = `${pageHeader({
    title: 'Ekip', subtitle: `${users.filter((u) => u.active).length} aktif üye`,
    actions: `<button class="btn primary" id="add">${icon('user-plus', 'sm')} Üye ekle</button>`,
  })}
  <div class="role-legend">
    <div><span class="tag accent">Yönetici</span> Her şey</div>
    <div><span class="tag info">Operatör</span> Satış ve üretim; ödeme/iade, ayar ve ekip yok</div>
    <div><span class="tag">İzleyici</span> Yalnızca görüntüleme</div>
  </div>
  <div class="card-grid">${users.map((u) => `<article class="member ${u.active ? '' : 'inactive'}">
    <div class="m-top">${avatar(u.name, 'lg')}<div><h3>${esc(u.name)}${u.id === app.me.id ? ' <span class="tag">Siz</span>' : ''}</h3><p>${esc(u.email)}</p></div></div>
    <div class="m-meta"><span>${u.totp_enabled ? `${icon('shield-check', 'xs')} 2FA açık` : `${icon('triangle-alert', 'xs')} 2FA kapalı`}</span><span>${icon('clock', 'xs')} ${u.last_login_at ? ago(u.last_login_at) : 'Hiç giriş yok'}</span></div>
    <div class="m-controls">
      <select data-role="${u.id}" class="input-sm" aria-label="Rol">${roleOpts.map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${v}</option>`).join('')}</select>
      ${toggle('notify', u.notify, 'E-posta', `data-notify="${u.id}"`)}
    </div>
    <div class="m-actions">
      <button class="btn sm" data-pw="${u.id}">${icon('key-round', 'xs')} Şifre ata</button>
      ${u.totp_enabled && u.id !== app.me.id ? `<button class="btn sm" data-2fa="${u.id}">2FA sıfırla</button>` : ''}
      ${u.id !== app.me.id ? `<button class="btn sm ${u.active ? 'danger-ghost' : ''}" data-active="${u.id}" data-to="${u.active ? 0 : 1}">${u.active ? 'Pasif yap' : 'Aktif yap'}</button>` : ''}
    </div></article>`).join('')}</div>`;

  $('#add').onclick = async () => {
    const ok = await modal({
      title: 'Ekip üyesi ekle', description: 'Geçici bir şifre belirleyin; üye ilk girişten sonra değiştirebilir.', submitText: 'Ekle',
      body: `<div class="form-grid">${field('name', 'Ad soyad', { required: true })}${field('email', 'E-posta', { type: 'email', required: true })}
        ${field('password', 'Geçici şifre', { type: 'password', required: true, hint: 'En az 10 karakter, harf ve rakam.' })}${field('role', 'Rol', { options: roleOpts, value: 'operator' })}</div>`,
      onSubmit: (d) => POST('/users', d),
    });
    if (ok) { toast('Üye eklendi'); app.route(); }
  };
  $$('[data-role]').forEach((el) => { el.onchange = () => act(() => PUT(`/users/${el.dataset.role}`, { role: el.value }), 'Rol güncellendi').then(app.route); });
  $$('[data-notify]').forEach((el) => { el.onchange = () => act(() => PUT(`/users/${el.dataset.notify}`, { notify: el.checked }), 'Kaydedildi'); });
  $$('[data-active]').forEach((b) => { b.onclick = async () => {
    const on = b.dataset.to === '1';
    if (!on && !(await confirmDialog('Üye pasif yapılsın mı?', 'Tüm oturumları kapanır ve giriş yapamaz.', { danger: true, confirmText: 'Pasif yap' }))) return;
    act(() => PUT(`/users/${b.dataset.active}`, { active: on }), 'Güncellendi').then(app.route);
  }; });
  $$('[data-pw]').forEach((b) => { b.onclick = () => modal({
    title: 'Yeni şifre ata', description: 'Kullanıcının tüm oturumları kapanır.', submitText: 'Şifreyi ata',
    body: field('password', 'Yeni geçici şifre', { type: 'password', required: true }),
    onSubmit: (d) => POST(`/users/${b.dataset.pw}/password`, d),
  }).then((r) => r && toast('Şifre atandı')); });
  $$('[data-2fa]').forEach((b) => { b.onclick = async () => {
    if (await confirmDialog('2FA sıfırlansın mı?', 'Telefonunu kaybeden üye yeniden kurulum yapabilir.', { danger: true, confirmText: 'Sıfırla' })) {
      act(() => POST(`/users/${b.dataset['2fa']}/reset-2fa`), '2FA sıfırlandı').then(app.route);
    }
  }; });
}

// --- Audit log --------------------------------------------------------------------------

export async function viewAudit(main) {
  const rows = await GET('/audit');
  const verb = (a) => {
    const [m, path] = a.split(' ');
    return `<span class="method ${m.toLowerCase()}">${m}</span><code>${esc(path.replace('/api', ''))}</code>`;
  };
  main.innerHTML = `${pageHeader({ title: 'Denetim kaydı', subtitle: 'Panelde yapılan her değişiklik. Şifre, kod ve IBAN gibi alanlar maskelenir.' })}
  <div class="toolbar">${searchBox('İşlem, kullanıcı veya ayrıntı ara…')}</div>
  <div class="card flush">${rows.length ? `<table class="table"><thead><tr><th>İşlem</th><th>Kullanıcı</th><th>Sonuç</th><th>Ayrıntı</th><th>IP</th><th>Zaman</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="nowrap">${verb(r.action)}</td><td><div class="cell-user">${avatar(r.email || '?', 'xs')}${esc(r.email || '—')}</div></td>
      <td>${pill(r.status < 400 ? 'ok' : 'error', String(r.status))}</td><td class="muted small detail">${esc(r.detail || '')}</td><td class="mono small">${esc(r.ip || '')}</td><td class="muted small nowrap">${date(r.created_at)}</td></tr>`).join('')}
    </tbody></table><div data-no-results hidden class="muted center pad">Eşleşme yok</div>` : empty('Kayıt yok', 'Değişiklik yapıldıkça burada görünecek.', 'scroll-text')}</div>`;
  liveFilter($('#q'), 'tbody tr', main);
}

// --- Scheduled tasks ------------------------------------------------------------------------

const JOB_ICON = {
  platform_scan: 'target', prospect_scan: 'radar', email_inbox: 'mail', reply_reminders: 'circle-alert',
  daily_digest: 'calendar', security_scan: 'shield', backup: 'download', cleanup: 'trash-2',
};

export async function viewJobs(main) {
  const { jobs, runs } = await GET('/jobs');
  const ok = jobs.filter((j) => j.last_status === 'ok').length;
  main.innerHTML = `${pageHeader({ title: 'Otomasyonlar', subtitle: `${jobs.filter((j) => j.enabled).length}/${jobs.length} görev açık · son çalışmalarda ${ok} başarılı. Eşikler Ayarlar → Otomasyon'da.` })}
  <div class="job-grid">${jobs.map((j) => `<article class="job ${j.enabled ? '' : 'off'}">
    <div class="job-top"><span class="tile-icon ${j.enabled ? 'accent' : 'neutral'}">${icon(JOB_ICON[j.name] || 'clock')}</span>
      <div class="job-title"><h3>${esc(j.label)}</h3><button class="link small" data-edit="${j.name}">${icon('clock', 'xs')} ${esc(j.schedule_text)}</button></div>
      ${toggle('enabled', j.enabled, '', `data-toggle="${j.name}" aria-label="Aç/kapat"`)}</div>
    <p>${esc(j.description)}</p>
    <div class="job-foot">
      <div class="job-status">${j.last_run_at ? `${pill(j.last_status)} <span class="muted small" title="${esc(j.last_message || '')}">${ago(j.last_run_at)}</span>` : '<span class="muted small">Henüz çalışmadı</span>'}
        ${j.enabled ? `<span class="muted small">· sonraki ${until(j.next_run_at)}</span>` : ''}</div>
      <button class="btn sm" data-run="${j.name}" ${j.running ? 'disabled' : ''}>${icon('play', 'xs')} Çalıştır</button></div>
    ${j.last_message ? `<div class="job-msg">${esc(j.last_message)}</div>` : ''}
  </article>`).join('')}</div>
  <div class="card flush"><div class="card-head pad"><div><h2>Çalışma geçmişi</h2><p>Son 100 çalışma</p></div></div>
    ${runs.length ? `<table class="table"><thead><tr><th>Görev</th><th>Tetikleyen</th><th>Sonuç</th><th>Mesaj</th><th class="num">Süre</th><th>Zaman</th></tr></thead><tbody>
    ${runs.map((r) => `<tr><td class="cell-title">${esc(jobs.find((j) => j.name === r.job)?.label || r.job)}</td><td>${pill(r.trigger === 'manual' ? 'operator' : 'admin', LABELS[r.trigger])}</td><td>${pill(r.status)}</td>
      <td class="muted small detail">${esc(r.message || '')}</td><td class="num mono small">${r.finished_at ? `${((parseDate(r.finished_at) - parseDate(r.started_at)) / 1000).toFixed(1)} sn` : '—'}</td><td class="muted small nowrap">${date(r.started_at)}</td></tr>`).join('')}</tbody></table>`
    : empty('Henüz çalışma yok', 'Görevler zamanı gelince otomatik çalışır; "Çalıştır" ile hemen deneyebilirsiniz.', 'history')}</div>`;

  $$('[data-toggle]').forEach((el) => { el.onchange = () => act(() => PUT(`/jobs/${el.dataset.toggle}`, { enabled: el.checked }), el.checked ? 'Görev açıldı' : 'Görev kapatıldı').then(app.route); });
  $$('[data-run]').forEach((b) => { b.onclick = () => busy(b, async () => {
    const r = await act(() => POST(`/jobs/${b.dataset.run}/run`));
    if (r) toast(`${r.status === 'ok' ? 'Tamamlandı' : 'Hata'}: ${r.message}`, r.status === 'ok' ? 'ok' : 'error');
    app.route();
  }); });
  $$('[data-edit]').forEach((b) => { b.onclick = async () => {
    const j = jobs.find((x) => x.name === b.dataset.edit);
    const s = j.schedule;
    const r = await modal({
      title: j.label, description: 'Zamanlamayı değiştirin. Saatler işletme saat dilimine göredir.', submitText: 'Kaydet',
      body: `<div class="form-grid">${field('type', 'Tür', { options: [['interval', 'Belirli aralıkla'], ['daily', 'Her gün'], ['monthly', 'Her ay']], value: s.type, span: true })}
        ${field('minutes', 'Aralık (dakika)', { type: 'number', value: s.minutes || 60 })}${field('time', 'Saat', { type: 'time', value: s.time || '08:00' })}
        ${field('day', 'Ayın günü (1–28)', { type: 'number', value: s.day || 1 })}</div>`,
      onSubmit: (d) => PUT(`/jobs/${j.name}`, {
        schedule: d.type === 'interval' ? { type: 'interval', minutes: Number(d.minutes) } : d.type === 'daily' ? { type: 'daily', time: d.time } : { type: 'monthly', day: Number(d.day), time: d.time },
      }),
    });
    if (r) { toast('Zamanlama güncellendi'); app.route(); }
  }; });
}

// --- Settings ---------------------------------------------------------------------------------

const SETTINGS = {
  business: ['İşletme', 'briefcase', 'Adınız ve mesaj imzasında kullanılan bilgiler', [
    ['name', 'İşletme / marka adı'], ['owner_name', 'Adınız'], ['admin_email', 'Bildirim e-postası', 'email'], ['phone', 'Telefonunuz'],
    ['website', 'Web siteniz / portfolyonuz'], ['timezone', 'Saat dilimi'], ['base_currency', 'Ana para birimi'],
    ['fx_rates', 'Döviz kurları (1 birim = ? ana para; bütçe filtresi için)', 'json'],
  ]],
  scanner: ['İş ilanları', 'target', 'Hangi ilanların uygun sayılacağı', [
    ['keywords', 'Anahtar kelimeler (biri geçmeli)', 'list'], ['exclude_keywords', 'Hariç kelimeler', 'list'],
    ['min_budget', 'En düşük bütçe (ana para)', 'number'], ['max_budget', 'En yüksek bütçe (0 = sınırsız)', 'number'], ['currencies', 'Para birimleri (boş = hepsi)', 'list'],
    ['max_age_hours', 'En fazla ilan yaşı (saat)', 'number'], ['max_leads_per_scan', 'Kaynak başına en fazla ilan', 'number'],
    ['notify_new', 'Yeni uygun ilan bulununca e-postayla bildir', 'bool'],
  ]],
  templates: ['Mesaj şablonları', 'message-square-text', 'İşletmelere ve ilan sahiplerine yazılan hazır mesajlar', [
    ['_help', '', 'help'],
    ['prospect_no_site', 'İşletme — web sitesi yok', 'textarea'], ['prospect_social', 'İşletme — sadece sosyal medya var', 'textarea'],
    ['prospect_old_site', 'İşletme — sitesi eski / zayıf', 'textarea'], ['prospect_subject', 'İşletme e-posta konusu'],
    ['lead_message', 'İş ilanı sahibine mesaj', 'textarea'], ['lead_subject', 'İlan e-posta konusu'],
  ]],
  prospecting: ['Bölge taraması', 'radar', 'Konum, kategoriler ve gönderim kuralları', [
    ['location', 'Taranacak konum (semt, ilçe veya adres)'], ['radius_km', 'Yarıçap (km)', 'number'],
    ['source', 'Veri kaynağı', 'prospect_source'],
    ['categories', 'İşletme kategorileri', 'prospect_categories'],
    ['min_score', 'İletişime geçilecek en düşük puan (0-100)', 'number'], ['max_per_scan', 'Tarama başına en fazla yeni işletme', 'number'],
    ['auto_send', 'Zamanlanmış taramada otomatik e-posta gönder', 'bool'], ['daily_limit', 'Günlük en fazla gönderim', 'number'],
    ['signature', 'Mesaj imzası (boşsa: adınız · işletme adı)', 'textarea'], ['opt_out_text', 'Her mesajın sonuna eklenen ret cümlesi', 'textarea'],
  ]],
  security: ['Güvenlik', 'shield', 'Giriş kuralları ve uyarı eşikleri', [
    ['require_2fa_for_admins', 'Yöneticiler için 2FA zorunlu', 'bool'], ['alert_on_new_ip', 'Yeni IP adresinden girişte uyar', 'bool'],
    ['max_failed_logins', 'Hesap başına hatalı giriş sınırı (15 dk)', 'number'], ['max_failed_per_ip', 'IP başına hatalı giriş sınırı (15 dk)', 'number'],
    ['idle_timeout_minutes', 'Hareketsizlikte oturumu kapat (dk, 0 = kapalı)', 'number'],
    ['allowed_ips', 'İzin verilen IP adresleri (boş = herkes; 192.168.1.* olabilir)', 'list'],
    ['audit_retention_days', 'Kayıt saklama süresi (gün)', 'number'],
  ]],
  automation: ['Otomasyon', 'clock', 'Zamanlanmış görevlerin eşikleri', [
    ['reply_reminder_hours', 'Cevap bekleyen mesajı kaç saat sonra hatırlat', 'number'],
    ['backup_keep', 'Saklanacak yedek sayısı', 'number'], ['notification_retention_days', 'Okunmuş bildirim saklama (gün)', 'number'],
  ]],
};

const TEMPLATE_HELP = `<div class="callout info span-2">${icon('circle-dot', 'sm')}<span>Şablonlarda şu alanlar otomatik doldurulur:
  <code>{ad}</code> işletme / ilan sahibi adı, <code>{kategori}</code> işletme türü, <code>{bulgu}</code> site incelemesi bulguları,
  <code>{ilan}</code> ilan başlığı, <code>{isletmem}</code> <code>{yetkili}</code> <code>{telefonum}</code> <code>{sitem}</code> sizin bilgileriniz.
  İmza ve "İPTAL" cümlesi işletme mesajlarının sonuna ayrıca eklenir.</span></div>`;

export async function viewSettings(main, sectionParam) {
  const section = SETTINGS[sectionParam] ? sectionParam : 'business';
  const [settings, status, pros] = await Promise.all([
    GET('/settings'), GET('/system/status'), section === 'prospecting' ? GET('/prospects') : Promise.resolve(null),
  ]);
  const [title, ic, desc, fields] = SETTINGS[section];
  const v = settings[section];
  const input = ([k, l, t]) => {
    const val = v[k];
    if (t === 'help') return TEMPLATE_HELP;
    if (t === 'bool') return `<div class="setting-row span-2"><div><b>${l}</b></div>${toggle(k, val)}</div>`;
    if (t === 'textarea') return field(k, l, { type: 'textarea', value: val, span: true, rows: 3 });
    if (t === 'json') return `<label class="field span-2">${l}<textarea name="${k}" class="mono" rows="4">${esc(JSON.stringify(val, null, 2))}</textarea></label>`;
    if (t === 'list') return `<label class="field">${l}<input name="${k}" value="${esc((val || []).join(', '))}" placeholder="virgülle ayırın"><small>Virgülle ayırın</small></label>`;
    if (t === 'prospect_categories') return `<div class="field span-2">${l}<div class="choice-grid tight">${pros.categories.map((c) => `<label class="choice"><input type="checkbox" data-cat value="${c.key}" ${val.includes(c.key) ? 'checked' : ''}><span>${esc(c.label)}</span></label>`).join('')}</div></div>`;
    if (t === 'prospect_source') return field(k, l, { options: [['osm', 'OpenStreetMap (ücretsiz, anahtarsız)'], ['google', `Google Places${status.google_places ? '' : ' — GOOGLE_PLACES_API_KEY gerekli'}`]], value: val });
    return field(k, l, { type: t || 'text', value: val });
  };
  main.innerHTML = `${pageHeader({ title: 'Ayarlar', subtitle: 'Değişiklikler hemen uygulanır ve denetim kaydına yazılır.' })}
  <div class="settings">
    <nav class="settings-nav">${Object.entries(SETTINGS).map(([k, [t, i, d]]) => `<a href="#/settings/${k}" class="${k === section ? 'active' : ''}">${icon(i, 'sm')}<span><b>${t}</b><small>${d}</small></span></a>`).join('')}</nav>
    <form class="card settings-panel" id="sf">
      <div class="card-head"><div><h2>${icon(ic, 'sm')} ${title}</h2><p>${desc}</p></div></div>
      ${section === 'business' ? `<div class="sys-status"><h3 class="h-xs">Bağlantılar</h3>${[
    ['smtp', 'E-posta gönderimi', 'SMTP_* — yoksa e-posta gönderilemez'], ['imap', 'Gelen e-postalar', 'IMAP_* — yoksa cevapları elle eklersiniz'],
    ['whatsapp_api', 'WhatsApp API', 'WHATSAPP_* — yoksa mesajlar wa.me ile kendi WhatsApp\'ınızdan gider'], ['google_places', 'Google Places', 'GOOGLE_PLACES_API_KEY (isteğe bağlı)'],
  ].map(([k, l, h]) => `<div class="sys-row ${status[k] ? 'on' : ''}">${icon(status[k] ? 'circle-check' : 'circle-dot', 'sm')}<b>${l}</b><span>${status[k] ? 'Bağlı' : h}</span></div>`).join('')}
        <p class="muted small">Anahtarlar proje klasöründeki <code>.env</code> dosyasındadır; değiştirdikten sonra uygulamayı yeniden başlatın.</p></div>` : ''}
      ${section === 'business' ? `<div class="callout info">${icon('shield', 'sm')} Bildirim e-postası değişirse eski adrese ve tüm yöneticilere güvenlik uyarısı gider.</div>` : ''}
      <div class="form-grid">${fields.map(input).join('')}</div>
      <div class="settings-foot"><span class="muted small">Son kaydedilen değerler gösteriliyor</span><button class="btn primary">${icon('check', 'sm')} Değişiklikleri kaydet</button></div>
    </form>
  </div>`;
  const form = $('#sf');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = {};
    try {
      for (const [k, , t] of fields) {
        if (t === 'help') continue;
        if (t === 'prospect_categories') { data[k] = $$('[data-cat]:checked', form).map((x) => x.value); continue; }
        const el = form.elements[k];
        if (t === 'bool') data[k] = el.checked;
        else if (t === 'number') data[k] = Number(el.value || 0);
        else if (t === 'json') data[k] = JSON.parse(el.value || 'null');
        else if (t === 'list') data[k] = el.value.split(',').map((x) => x.trim()).filter(Boolean);
        else data[k] = el.value;
      }
    } catch { return toast('JSON alanı geçersiz', 'error'); }
    busy($('button.primary', form), () => act(() => PUT(`/settings/${section}`, data), 'Ayarlar kaydedildi'));
  };
}
