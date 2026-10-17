// Small dependency-free SVG charts. Colours come from CSS tokens (--series-1/2) so they follow the theme.
import { $, $$, empty, esc, money } from './core.js';

const niceMax = (v) => {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= v);
};
const monthLabel = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString('tr-TR', { month: 'short' });

function attachTooltip(el, hits, render) {
  const tip = $('.chart-tip', el);
  const cross = $('.crosshair', el);
  $$('[data-i]', el).forEach((h) => {
    h.addEventListener('mousemove', (e) => {
      const i = Number(h.dataset.i);
      tip.innerHTML = render(i);
      tip.hidden = false;
      const box = el.getBoundingClientRect();
      const x = e.clientX - box.left;
      tip.style.left = `${Math.min(Math.max(x + 14, 0), box.width - tip.offsetWidth - 4)}px`;
      tip.style.top = `${Math.max(e.clientY - box.top - tip.offsetHeight - 12, 0)}px`;
      if (cross) { cross.setAttribute('x1', hits[i]); cross.setAttribute('x2', hits[i]); cross.style.opacity = 1; }
      $$('.pt', el).forEach((p, j) => p.classList.toggle('on', j === i));
    });
    h.addEventListener('mouseleave', () => {
      tip.hidden = true;
      if (cross) cross.style.opacity = 0;
      $$('.pt', el).forEach((p) => p.classList.remove('on'));
    });
  });
}

/** Single-series area chart with crosshair tooltip. points: [{label, value}] */
export function areaChart(el, points, { height = 150, currency = '', axis = false } = {}) {
  if (!points.length || points.every((p) => !p.value)) {
    el.innerHTML = `<div class="chart-empty">Henüz veri yok</div>`;
    return;
  }
  const W = 600; const H = height; const pad = { l: axis ? 44 : 4, r: 4, t: 10, b: axis ? 22 : 4 };
  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const x = (i) => pad.l + (points.length === 1 ? 0 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  // Smooth path (monotone-ish cubic) through the points.
  const pts = points.map((p, i) => [x(i), y(p.value)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i]; const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  const area = `${d} L${pts.at(-1)[0]},${H - pad.b} L${pts[0][0]},${H - pad.b} Z`;
  const gid = `g${Math.random().toString(36).slice(2, 8)}`;
  const step = (W - pad.l - pad.r) / Math.max(1, points.length - 1);
  el.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Alan grafiği">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--series-1)" stop-opacity=".28"/><stop offset="1" stop-color="var(--series-1)" stop-opacity="0"/></linearGradient></defs>
    ${axis ? [0, 0.5, 1].map((f) => `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="axis" x="${pad.l - 8}" y="${y(max * f) + 4}" text-anchor="end">${Math.round(max * f).toLocaleString('tr-TR', { notation: 'compact' })}</text>`).join('') : ''}
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${d}" fill="none" stroke="var(--series-1)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
    <line class="crosshair" y1="${pad.t}" y2="${H - pad.b}" x1="0" x2="0"/>
    ${pts.map(([px, py]) => `<circle class="pt" cx="${px}" cy="${py}" r="4"/>`).join('')}
    ${axis ? points.map((p, i) => (i % 2 === points.length % 2 ? '' : `<text class="axis" x="${x(i)}" y="${H - 5}" text-anchor="middle">${esc(p.label)}</text>`)).join('') : ''}
    ${points.map((_, i) => `<rect data-i="${i}" x="${x(i) - step / 2}" y="0" width="${step}" height="${H}" fill="transparent"/>`).join('')}
  </svg><div class="chart-tip" hidden></div></div>`;
  attachTooltip(el, pts.map((p) => p[0]), (i) => `<span class="tip-label">${esc(points[i].label)}</span><b>${money(points[i].value, currency)}</b>`);
}

/** Two-series grouped bars (revenue vs expenses) with legend and table fallback. */
export function barChart(el, rows, currency) {
  const raw = Math.max(0, ...rows.flatMap((r) => [r.revenue, r.expenses]));
  if (!raw) { el.innerHTML = empty('Henüz veri yok', 'Ödemeler ve giderler oluştukça grafik burada görünecek.', 'chart-no-axes-column'); return; }
  const W = 720; const H = 230; const pad = { l: 48, r: 6, t: 8, b: 24 };
  const max = niceMax(raw);
  const step = (W - pad.l - pad.r) / rows.length;
  const bw = Math.max(4, Math.min(16, step / 2 - 5));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const bar = (bx, v, color) => {
    const top = y(v); const h = H - pad.b - top;
    if (h <= 0.5) return '';
    const r = Math.min(4, h, bw / 2);
    return `<path fill="${color}" d="M${bx},${H - pad.b} V${top + r} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} V${H - pad.b} Z"/>`;
  };
  el.innerHTML = `<div class="legend"><span><i style="background:var(--series-1)"></i>Ciro</span><span><i style="background:var(--series-2)"></i>Gider</span></div>
  <div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Aylık ciro ve gider">
    ${[0, 0.25, 0.5, 0.75, 1].map((f) => `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="axis" x="${pad.l - 8}" y="${y(max * f) + 4}" text-anchor="end">${Math.round(max * f).toLocaleString('tr-TR', { notation: 'compact' })}</text>`).join('')}
    ${rows.map((r, i) => {
      const cx = pad.l + step * i + step / 2;
      return `<g><rect class="col-hover" data-i="${i}" x="${pad.l + step * i + 2}" y="${pad.t}" width="${step - 4}" height="${H - pad.t - pad.b}" rx="6"/>
        ${bar(cx - bw - 1, r.revenue, 'var(--series-1)')}${bar(cx + 1, r.expenses, 'var(--series-2)')}
        <text class="axis" x="${cx}" y="${H - 6}" text-anchor="middle">${monthLabel(r.month)}</text></g>`;
    }).join('')}
  </svg><div class="chart-tip" hidden></div></div>
  <details class="table-toggle"><summary>Tablo olarak göster</summary><table class="table"><thead><tr><th>Ay</th><th class="num">Ciro</th><th class="num">Gider</th><th class="num">Kâr</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${r.month}</td><td class="num">${money(r.revenue, currency)}</td><td class="num">${money(r.expenses, currency)}</td><td class="num">${money(r.profit, currency)}</td></tr>`).join('')}</tbody></table></details>`;
  attachTooltip(el, [], (i) => {
    const r = rows[i];
    return `<span class="tip-label">${new Date(`${r.month}-01T12:00:00`).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}</span>
      <div class="tip-row"><i style="background:var(--series-1)"></i>Ciro<b>${money(r.revenue, currency)}</b></div>
      <div class="tip-row"><i style="background:var(--series-2)"></i>Gider<b>${money(r.expenses, currency)}</b></div>
      <div class="tip-row"><i></i>Kâr<b>${money(r.profit, currency)}</b></div>`;
  });
}

/** Horizontal funnel; one hue, darker = earlier stage. steps: [{label, value}] */
export function funnel(el, steps) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  el.innerHTML = `<div class="funnel">${steps.map((s, i) => {
    const conv = i > 0 && steps[i - 1].value ? Math.round((s.value / steps[i - 1].value) * 100) : null;
    return `<div class="funnel-row" title="${esc(s.label)}: ${s.value}">
      <div class="funnel-meta"><span>${esc(s.label)}</span><b>${s.value.toLocaleString('tr-TR')}</b></div>
      <div class="funnel-track"><div class="funnel-bar" style="width:${Math.max(2, (s.value / max) * 100)}%; opacity:${1 - i * 0.16}"></div></div>
      ${conv !== null ? `<div class="funnel-conv">%${conv} geçiş</div>` : ''}</div>`;
  }).join('')}</div>`;
}
