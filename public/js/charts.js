/* SVG chart primitives.
 *
 * Every chart here ships a legend (2+ series), selective direct labels, a hover
 * tooltip and a table view. The table view is not optional polish: several
 * palette slots sit below 3:1 against the light surface, and the readable
 * fallback is what makes them legal.
 */

const NS = 'http://www.w3.org/2000/svg';

export const SERIES_VARS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
];
/** Categorical hues are assigned in fixed order and never cycled. */
export const seriesColor = (i) => SERIES_VARS[i] ?? 'var(--text-muted)';

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  return node;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ---------------------------------------------------------------- *
 * Scales & ticks
 * ---------------------------------------------------------------- */

/** Round a raw axis span out to human numbers (1/2/5 x 10^n). */
function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad; max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(Math.abs(raw) || 1));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Math.round(v));
  return { min: niceMin, max: niceMax, ticks };
}

/** Approximate text width so the y-axis gutter fits its widest label. */
const textWidth = (s) => String(s).length * 6.6 + 8;

/* ---------------------------------------------------------------- *
 * Shared chart shell: title row, legend, frame, tooltip, table view
 * ---------------------------------------------------------------- */

class ChartShell {
  constructor({ title, note, series, tableBuilder, showLegend = true }) {
    this.root = el('div', 'chart-card');
    this.tableBuilder = tableBuilder;
    this.mode = 'chart';

    if (title || tableBuilder) {
      const head = el('div', 'row');
      head.style.cssText = 'margin-bottom:6px;align-items:baseline';
      if (title) {
        const box = el('div');
        box.appendChild(el('h3', null, title));
        if (note) box.appendChild(el('div', 'card-note', note));
        box.style.marginRight = 'auto';
        head.appendChild(box);
      }
      if (tableBuilder) {
        const toggle = el('div', 'seg no-print');
        const chartBtn = el('button', null, 'Chart');
        const tableBtn = el('button', null, 'Table');
        chartBtn.setAttribute('aria-pressed', 'true');
        tableBtn.setAttribute('aria-pressed', 'false');
        chartBtn.onclick = () => this.setMode('chart', chartBtn, tableBtn);
        tableBtn.onclick = () => this.setMode('table', chartBtn, tableBtn);
        toggle.append(chartBtn, tableBtn);
        head.appendChild(toggle);
      }
      this.root.appendChild(head);
    }

    // Identity is never colour-alone: a legend is always present for 2+ series.
    if (showLegend && series && series.length > 1) {
      const legend = el('div', 'legend');
      for (const s of series) {
        const item = el('span', 'legend-item');
        const sw = el('span', 'swatch');
        sw.style.background = s.color;
        item.append(sw, el('span', null, s.name));
        legend.appendChild(item);
      }
      this.root.appendChild(legend);
    }

    this.frame = el('div', 'chart-frame');
    this.tooltip = el('div', 'tooltip');
    this.frame.appendChild(this.tooltip);
    this.root.appendChild(this.frame);

    this.tableHost = el('div', 'table-wrap');
    this.tableHost.style.display = 'none';
    this.root.appendChild(this.tableHost);
  }

  setMode(mode, chartBtn, tableBtn) {
    this.mode = mode;
    chartBtn.setAttribute('aria-pressed', String(mode === 'chart'));
    tableBtn.setAttribute('aria-pressed', String(mode === 'table'));
    this.frame.style.display = mode === 'chart' ? '' : 'none';
    this.tableHost.style.display = mode === 'table' ? '' : 'none';
    if (mode === 'table' && !this.tableHost.firstChild && this.tableBuilder) {
      this.tableHost.appendChild(this.tableBuilder());
    }
  }

  showTooltip(html, x, y) {
    this.tooltip.innerHTML = html;
    this.tooltip.classList.add('show');
    const frameRect = this.frame.getBoundingClientRect();
    const tipRect = this.tooltip.getBoundingClientRect();
    let left = x + 14;
    if (left + tipRect.width > frameRect.width) left = x - tipRect.width - 14;
    this.tooltip.style.left = `${Math.max(0, left)}px`;
    this.tooltip.style.top = `${Math.max(0, Math.min(y - 10, frameRect.height - tipRect.height))}px`;
  }

  hideTooltip() { this.tooltip.classList.remove('show'); }
}

function tooltipRows(title, rows) {
  const body = rows.map((r) => `
    <div class="tooltip-row">
      <span class="label">${r.color ? `<span class="dot" style="background:${r.color}"></span>` : ''}${escapeHtml(r.label)}</span>
      <span class="value">${escapeHtml(r.value)}</span>
    </div>`).join('');
  return `<div class="tooltip-title">${escapeHtml(title)}</div>${body}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function emptyState(message) {
  const box = el('div', 'chart-empty');
  box.appendChild(el('div', null, message));
  return box;
}

/* ---------------------------------------------------------------- *
 * Line chart -- change over time, 1..4 series
 * ---------------------------------------------------------------- */

export function lineChart({
  title, note, labels, series, format, height = 240,
  showArea = false, refLine = null, tableHeader = 'Month',
}) {
  const coloured = series.map((s, i) => ({ ...s, color: s.color ?? seriesColor(i) }));
  const shell = new ChartShell({
    title, note, series: coloured,
    tableBuilder: () => buildTable(labels, coloured, format, tableHeader),
  });

  if (!labels.length || coloured.every((s) => s.values.every((v) => v === null || v === 0))) {
    shell.frame.appendChild(emptyState('No data recorded for this period yet.'));
    return shell.root;
  }

  const all = coloured.flatMap((s) => s.values.filter((v) => Number.isFinite(v)));
  const scale = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4);
  const gutter = Math.max(...scale.ticks.map((t) => textWidth(format(t, true))));

  const W = 720;
  const H = height;
  const pad = { top: 14, right: 58, bottom: 26, left: gutter };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const xAt = (i) => pad.left + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const yAt = (v) => pad.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;

  const svg = svgEl('svg', {
    class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none',
    role: 'img', 'aria-label': title ?? 'Trend chart', style: `height:${H}px`,
  });

  for (const t of scale.ticks) {
    const y = yAt(t);
    svg.appendChild(svgEl('line', { class: 'grid-line', x1: pad.left, x2: W - pad.right, y1: y, y2: y }));
    const label = svgEl('text', { class: 'tick tick-y', x: pad.left - 7, y: y + 3.5 });
    label.textContent = format(t, true);
    svg.appendChild(label);
  }
  if (scale.min < 0) {
    svg.appendChild(svgEl('line', { class: 'zero-line', x1: pad.left, x2: W - pad.right, y1: yAt(0), y2: yAt(0) }));
  }

  // X labels thin out so they never collide.
  const stride = Math.ceil(labels.length / 8);
  labels.forEach((label, i) => {
    if (i % stride !== 0 && i !== labels.length - 1) return;
    const t = svgEl('text', { class: 'tick', x: xAt(i), y: H - 8, 'text-anchor': 'middle' });
    t.textContent = label;
    svg.appendChild(t);
  });

  if (refLine && Number.isFinite(refLine.value)) {
    const y = yAt(refLine.value);
    svg.appendChild(svgEl('line', { class: 'ref-line', x1: pad.left, x2: W - pad.right, y1: y, y2: y }));
    const rl = svgEl('text', { class: 'ref-label', x: W - pad.right + 4, y: y + 3.5 });
    rl.textContent = refLine.label;
    svg.appendChild(rl);
  }

  const crosshair = svgEl('line', { class: 'crosshair', y1: pad.top, y2: pad.top + plotH, opacity: 0 });
  svg.appendChild(crosshair);

  for (const s of coloured) {
    const points = s.values.map((v, i) => (Number.isFinite(v) ? [xAt(i), yAt(v)] : null)).filter(Boolean);
    if (!points.length) continue;
    if (showArea) {
      const area = `M${points[0][0]},${yAt(scale.min)} ${points.map((p) => `L${p[0]},${p[1]}`).join(' ')} L${points.at(-1)[0]},${yAt(scale.min)} Z`;
      svg.appendChild(svgEl('path', { d: area, fill: s.color, opacity: 0.1 }));
    }
    svg.appendChild(svgEl('path', {
      class: 'series-line', d: `M${points.map((p) => `${p[0]},${p[1]}`).join(' L')}`, stroke: s.color,
    }));
    // Direct-label the endpoint only -- never a number on every point.
    const last = points.at(-1);
    svg.appendChild(svgEl('circle', { class: 'series-marker', cx: last[0], cy: last[1], r: 4, fill: s.color }));
    const endLabel = svgEl('text', { class: 'point-label', x: last[0] + 9, y: last[1] + 3.5, fill: s.color });
    endLabel.textContent = format(s.values.at(-1), true);
    svg.appendChild(endLabel);
  }

  // One hit band per x position drives the crosshair and a combined tooltip.
  const bandW = plotW / Math.max(labels.length - 1, 1);
  labels.forEach((label, i) => {
    const hit = svgEl('rect', {
      class: 'hit', x: xAt(i) - bandW / 2, y: pad.top, width: bandW, height: plotH,
    });
    const show = () => {
      crosshair.setAttribute('x1', xAt(i));
      crosshair.setAttribute('x2', xAt(i));
      crosshair.setAttribute('opacity', 1);
      const rect = shell.frame.getBoundingClientRect();
      shell.showTooltip(
        tooltipRows(label, coloured.map((s) => ({
          label: s.name, color: s.color,
          value: Number.isFinite(s.values[i]) ? format(s.values[i]) : '—',
        }))),
        (xAt(i) / W) * rect.width,
        (pad.top / H) * rect.height,
      );
    };
    hit.addEventListener('mouseenter', show);
    hit.addEventListener('mousemove', show);
    hit.addEventListener('mouseleave', () => {
      crosshair.setAttribute('opacity', 0);
      shell.hideTooltip();
    });
    svg.appendChild(hit);
  });

  shell.frame.appendChild(svg);
  return shell.root;
}

/* ---------------------------------------------------------------- *
 * Grouped bar chart -- comparing 2..3 measures per month
 * ---------------------------------------------------------------- */

export function groupedBarChart({ title, note, labels, series, format, height = 250, tableHeader = 'Month' }) {
  const coloured = series.map((s, i) => ({ ...s, color: s.color ?? seriesColor(i) }));
  const shell = new ChartShell({
    title, note, series: coloured,
    tableBuilder: () => buildTable(labels, coloured, format, tableHeader),
  });

  const all = coloured.flatMap((s) => s.values.filter(Number.isFinite));
  if (!labels.length || !all.length || all.every((v) => v === 0)) {
    shell.frame.appendChild(emptyState('No income or spending recorded yet.'));
    return shell.root;
  }

  const scale = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4);
  const gutter = Math.max(...scale.ticks.map((t) => textWidth(format(t, true))));

  const W = 720;
  const H = height;
  const pad = { top: 12, right: 12, bottom: 26, left: gutter };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const groupW = plotW / labels.length;
  const GAP = 2; // 2px surface gap between adjacent bars, never a border
  const barW = Math.max(3, (groupW * 0.72 - GAP * (coloured.length - 1)) / coloured.length);
  const yAt = (v) => pad.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;

  const svg = svgEl('svg', {
    class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none',
    role: 'img', 'aria-label': title ?? 'Bar chart', style: `height:${H}px`,
  });

  for (const t of scale.ticks) {
    const y = yAt(t);
    svg.appendChild(svgEl('line', { class: 'grid-line', x1: pad.left, x2: W - pad.right, y1: y, y2: y }));
    const label = svgEl('text', { class: 'tick tick-y', x: pad.left - 7, y: y + 3.5 });
    label.textContent = format(t, true);
    svg.appendChild(label);
  }

  const stride = Math.ceil(labels.length / 10);
  labels.forEach((label, gi) => {
    const groupX = pad.left + gi * groupW;
    if (gi % stride === 0 || gi === labels.length - 1) {
      const t = svgEl('text', { class: 'tick', x: groupX + groupW / 2, y: H - 8, 'text-anchor': 'middle' });
      t.textContent = label;
      svg.appendChild(t);
    }

    const clusterW = barW * coloured.length + GAP * (coloured.length - 1);
    coloured.forEach((s, si) => {
      const v = s.values[gi] ?? 0;
      const x = groupX + (groupW - clusterW) / 2 + si * (barW + GAP);
      const y = yAt(Math.max(v, 0));
      const h = Math.abs(yAt(v) - yAt(0));
      const rect = svgEl('rect', {
        class: 'bar', x, y, width: barW, height: Math.max(h, v === 0 ? 0 : 1), fill: s.color,
      });
      rect.addEventListener('mouseenter', () => {
        const frameRect = shell.frame.getBoundingClientRect();
        shell.showTooltip(
          tooltipRows(label, coloured.map((ss) => ({
            label: ss.name, color: ss.color, value: format(ss.values[gi] ?? 0),
          }))),
          ((x + barW / 2) / W) * frameRect.width,
          (y / H) * frameRect.height,
        );
      });
      rect.addEventListener('mouseleave', () => shell.hideTooltip());
      svg.appendChild(rect);
    });
  });

  svg.appendChild(svgEl('line', { class: 'axis-line', x1: pad.left, x2: W - pad.right, y1: yAt(0), y2: yAt(0) }));
  shell.frame.appendChild(svg);
  return shell.root;
}

/* ---------------------------------------------------------------- *
 * Horizontal bars -- ranking nominal categories.
 * One series, one colour: bar length already encodes magnitude, so a
 * value-ramp across the bars would double-encode it.
 * ---------------------------------------------------------------- */

export function barListChart({ title, note, rows, format, color = 'var(--series-1)', height = 230, valueHeader = 'Amount', labelHeader = 'Category' }) {
  const shell = new ChartShell({
    title, note, series: null, showLegend: false,
    tableBuilder: () => {
      const table = el('table', 'data');
      const thead = el('thead');
      const hr = el('tr');
      hr.append(el('th', null, labelHeader), el('th', 'num', valueHeader), el('th', 'num', 'Share'));
      thead.appendChild(hr);
      const tbody = el('tbody');
      const total = rows.reduce((a, r) => a + r.value, 0);
      for (const r of rows) {
        const tr = el('tr');
        tr.append(
          el('td', 'name', r.label),
          el('td', 'num', format(r.value)),
          el('td', 'num', total ? `${((r.value / total) * 100).toFixed(1)}%` : '—'),
        );
        tbody.appendChild(tr);
      }
      table.append(thead, tbody);
      return table;
    },
  });

  if (!rows.length) {
    shell.frame.appendChild(emptyState('No spending recorded for this month.'));
    return shell.root;
  }

  const max = Math.max(...rows.map((r) => r.value), 1);
  const ROW_H = 26;
  const W = 720;
  const labelW = 148;
  const valueW = 92;
  const H = Math.max(height, rows.length * ROW_H + 8);

  const svg = svgEl('svg', {
    class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none',
    role: 'img', 'aria-label': title ?? 'Category breakdown', style: `height:${H}px`,
  });

  rows.forEach((row, i) => {
    const y = i * ROW_H + 4;
    const barH = 12;
    const trackW = W - labelW - valueW;

    const name = svgEl('text', { class: 'tick', x: labelW - 10, y: y + barH, 'text-anchor': 'end' });
    name.style.fill = 'var(--text-secondary)';
    name.style.fontSize = '12px';
    name.textContent = row.label.length > 22 ? `${row.label.slice(0, 21)}…` : row.label;
    svg.appendChild(name);

    svg.appendChild(svgEl('rect', { class: 'bar-track', x: labelW, y: y + 3, width: trackW, height: barH }));
    const w = Math.max((row.value / max) * trackW, 2);
    const bar = svgEl('rect', { class: 'bar', x: labelW, y: y + 3, width: w, height: barH, fill: row.color ?? color });
    svg.appendChild(bar);

    // Values live outside the bar, so nothing is ever clipped by a short one.
    const value = svgEl('text', { class: 'point-label', x: W - 6, y: y + barH, 'text-anchor': 'end' });
    value.textContent = format(row.value, true);
    svg.appendChild(value);

    const hit = svgEl('rect', { class: 'hit', x: 0, y, width: W, height: ROW_H });
    hit.addEventListener('mouseenter', () => {
      const rect = shell.frame.getBoundingClientRect();
      shell.showTooltip(
        tooltipRows(row.label, [
          { label: 'Amount', value: format(row.value), color: row.color ?? color },
          ...(row.detail ? [{ label: row.detail.label, value: row.detail.value }] : []),
        ]),
        (labelW / W) * rect.width + 40,
        (y / H) * rect.height,
      );
    });
    hit.addEventListener('mouseleave', () => shell.hideTooltip());
    svg.appendChild(hit);
  });

  shell.frame.appendChild(svg);
  return shell.root;
}

/* ---------------------------------------------------------------- *
 * Donut -- part-to-whole at a glance, capped at 6 slices
 * ---------------------------------------------------------------- */

export function donutChart({ title, note, slices, format, centerLabel, centerValue, size = 190 }) {
  const capped = [...slices].sort((a, b) => b.value - a.value);
  const shown = capped.slice(0, 5);
  const rest = capped.slice(5);
  if (rest.length) {
    shown.push({ label: 'Other', value: rest.reduce((a, s) => a + s.value, 0) });
  }
  const coloured = shown.map((s, i) => ({ ...s, color: s.color ?? seriesColor(i) }));
  const total = coloured.reduce((a, s) => a + s.value, 0);

  const shell = new ChartShell({
    title, note,
    series: coloured.map((s) => ({ name: s.label, color: s.color })),
    tableBuilder: () => {
      const table = el('table', 'data');
      const thead = el('thead');
      const hr = el('tr');
      hr.append(el('th', null, 'Segment'), el('th', 'num', 'Amount'), el('th', 'num', 'Share'));
      thead.appendChild(hr);
      const tbody = el('tbody');
      for (const s of coloured) {
        const tr = el('tr');
        tr.append(
          el('td', 'name', s.label),
          el('td', 'num', format(s.value)),
          el('td', 'num', total ? `${((s.value / total) * 100).toFixed(1)}%` : '—'),
        );
        tbody.appendChild(tr);
      }
      table.append(thead, tbody);
      return table;
    },
  });

  if (!total) {
    shell.frame.appendChild(emptyState('Nothing to break down yet.'));
    return shell.root;
  }

  const R = size / 2;
  const inner = R * 0.62;
  const svg = svgEl('svg', {
    class: 'chart', viewBox: `0 0 ${size} ${size}`,
    role: 'img', 'aria-label': title ?? 'Breakdown', style: `height:${size}px;margin:0 auto`,
  });

  let angle = -Math.PI / 2;
  const GAP = 0.018; // radians of surface showing between segments
  for (const slice of coloured) {
    const sweep = (slice.value / total) * Math.PI * 2;
    if (sweep <= 0) continue;
    const a0 = angle + GAP / 2;
    const a1 = angle + sweep - GAP / 2;
    if (a1 > a0) {
      const large = sweep > Math.PI ? 1 : 0;
      const d = [
        `M${R + R * Math.cos(a0)},${R + R * Math.sin(a0)}`,
        `A${R},${R} 0 ${large} 1 ${R + R * Math.cos(a1)},${R + R * Math.sin(a1)}`,
        `L${R + inner * Math.cos(a1)},${R + inner * Math.sin(a1)}`,
        `A${inner},${inner} 0 ${large} 0 ${R + inner * Math.cos(a0)},${R + inner * Math.sin(a0)}`,
        'Z',
      ].join(' ');
      const path = svgEl('path', { d, fill: slice.color });
      path.addEventListener('mouseenter', () => {
        const rect = shell.frame.getBoundingClientRect();
        const mid = (a0 + a1) / 2;
        shell.showTooltip(
          tooltipRows(slice.label, [
            { label: 'Amount', value: format(slice.value), color: slice.color },
            { label: 'Share', value: `${((slice.value / total) * 100).toFixed(1)}%` },
          ]),
          ((R + (R * 0.8) * Math.cos(mid)) / size) * rect.width,
          ((R + (R * 0.8) * Math.sin(mid)) / size) * rect.height,
        );
      });
      path.addEventListener('mouseleave', () => shell.hideTooltip());
      svg.appendChild(path);
    }
    angle += sweep;
  }

  if (centerValue) {
    const v = svgEl('text', { x: R, y: R + 2, 'text-anchor': 'middle' });
    v.style.cssText = 'fill:var(--text-primary);font-size:16px;font-weight:650';
    v.textContent = centerValue;
    svg.appendChild(v);
  }
  if (centerLabel) {
    const l = svgEl('text', { x: R, y: R + 18, 'text-anchor': 'middle' });
    l.style.cssText = 'fill:var(--text-muted);font-size:10.5px';
    l.textContent = centerLabel;
    svg.appendChild(l);
  }

  shell.frame.appendChild(svg);
  return shell.root;
}

/* ---------------------------------------------------------------- */

function buildTable(labels, series, format, header) {
  const table = el('table', 'data');
  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', null, header));
  for (const s of series) hr.appendChild(el('th', 'num', s.name));
  thead.appendChild(hr);
  const tbody = el('tbody');
  labels.forEach((label, i) => {
    const tr = el('tr');
    tr.appendChild(el('td', 'name', label));
    for (const s of series) {
      tr.appendChild(el('td', 'num', Number.isFinite(s.values[i]) ? format(s.values[i]) : '—'));
    }
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);
  return table;
}
