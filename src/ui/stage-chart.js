// Estimated vs observed HH stage over calculated incubation age.
//
// Integrity rules: the reference band is labelled as an estimate; each observation also shows
// the estimate that was stored with it; observed stages are separate markers (shape-coded,
// same colour for "matches" and "different"); nothing connects observations; "unable to
// confirm" sits in its own lane with no stage; periods without observations stay empty.

import { esc } from './dom.js';
import { VERDICTS, observationsByTime } from '../experiment.js';
import { estimateStage } from '../hh-stages.js';
import { formatDateTime, formatDuration } from '../time.js';

const CONFLICT_WINDOW_MIN = 60;

/** Pairs of staged observations within an hour of each other that record different stages. */
export function findConflicts(record) {
  const staged = observationsByTime(record).filter((o) => o.observedStage !== null);
  const out = [];
  for (let i = 0; i < staged.length; i++) {
    for (let j = i + 1; j < staged.length; j++) {
      const gap = Math.abs(staged[j].ageMinutes - staged[i].ageMinutes);
      if (gap <= CONFLICT_WINDOW_MIN && staged[i].observedStage !== staged[j].observedStage) out.push([staged[i], staged[j]]);
    }
  }
  return out;
}

function niceStep(span, target) {
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
}

function ageTickLabel(h, useDays) {
  return useDays ? `${+(h / 24).toFixed(1)} d` : `${Math.round(h)} h`;
}

export function observationTip(o, tz) {
  const what =
    o.verdict === VERDICTS.UNCONFIRMED
      ? 'Stage not confirmed'
      : `Observed HH${o.observedStage} (${o.verdict === VERDICTS.MATCH ? 'matches' : 'differs from'} estimate ${o.estimate.label})`;
  return `${what} · ${formatDuration(o.ageMinutes)} incubation · ${formatDateTime(Date.parse(o.observedAt), tz)}${o.note ? ` · Note: ${o.note}` : ''}`;
}

/** Returns SVG markup sized to `width` px. */
export function stageChartSvg(record, { width, nowMs, open }) {
  const obs = observationsByTime(record);
  const placementAge = record.currentIncubationMinutes / 60;
  const targetAge = (record.currentIncubationMinutes + record.waitMinutes) / 60;
  const nowAge = open ? (record.currentIncubationMinutes + Math.max(0, (nowMs - Date.parse(record.placementAt)) / 60_000)) / 60 : null;
  const obsAges = obs.map((o) => o.ageMinutes / 60);
  let x0 = Math.min(placementAge, ...obsAges);
  let x1 = Math.max(targetAge, ...obsAges);
  const pad = Math.max(1, (x1 - x0) * 0.04);
  x0 = Math.max(0, x0 - pad);
  x1 += pad;

  // Reference band sampled from the table (current reference version).
  const N = 240;
  const samples = Array.from({ length: N + 1 }, (_, i) => {
    const h = x0 + ((x1 - x0) * i) / N;
    return { h, stages: estimateStage(h * 60).stages };
  });
  const stageVals = [
    ...samples.flatMap((s) => s.stages),
    ...obs.flatMap((o) => [...o.estimate.stages, o.observedStage ?? o.estimate.stages[0]]),
  ];
  const y0 = Math.max(1, Math.min(...stageVals) - 1);
  const y1 = Math.min(46, Math.max(...stageVals) + 1);

  const H = width < 520 ? 270 : 320;
  const m = { l: 44, r: 14, t: 14, b: 62 };
  const laneH = 22;
  const plotB = H - m.b - laneH - 6;
  const X = (h) => m.l + ((h - x0) / (x1 - x0)) * (width - m.l - m.r);
  const Y = (s) => m.t + ((y1 + 0.5 - s) / (y1 - y0 + 1)) * (plotB - m.t);
  const laneY = plotB + 6 + laneH / 2;

  const parts = [];
  // grid + y ticks
  const yStep = Math.max(1, niceStep(y1 - y0, 6));
  for (let s = Math.ceil(y0 / yStep) * yStep; s <= y1; s += yStep) {
    parts.push(`<line class="sc-grid" x1="${m.l}" x2="${width - m.r}" y1="${Y(s)}" y2="${Y(s)}"/>`);
    parts.push(`<text class="sc-tick" x="${m.l - 6}" y="${Y(s) + 4}" text-anchor="end">HH${s}</text>`);
  }
  // x ticks
  const useDays = x1 - x0 > 96;
  const xStep = useDays ? Math.max(24, niceStep(x1 - x0, width < 520 ? 4 : 7) ) : niceStep(x1 - x0, width < 520 ? 4 : 8);
  for (let h = Math.ceil(x0 / xStep) * xStep; h <= x1; h += xStep) {
    parts.push(`<line class="sc-tickline" x1="${X(h)}" x2="${X(h)}" y1="${plotB + 6 + laneH}" y2="${plotB + 10 + laneH}"/>`);
    parts.push(`<text class="sc-tick" x="${X(h)}" y="${plotB + laneH + 22}" text-anchor="middle">${ageTickLabel(h, useDays)}</text>`);
  }
  parts.push(`<text class="sc-axis" x="${(m.l + width - m.r) / 2}" y="${H - 6}" text-anchor="middle">Calculated incubation age</text>`);

  // reference band (stepped; no smoothing)
  const top = [];
  const bottom = [];
  for (let i = 0; i < N; i++) {
    const a = X(samples[i].h);
    const b = X(samples[i + 1].h);
    const [lo, hi] = samples[i].stages;
    top.push(`${a},${Y(hi + 0.45)}`, `${b},${Y(hi + 0.45)}`);
    bottom.unshift(`${b},${Y(lo - 0.45)}`, `${a},${Y(lo - 0.45)}`);
  }
  parts.push(`<polygon class="sc-band" points="${[...top, ...bottom].join(' ')}"/>`);

  // "not confirmed" lane
  parts.push(`<rect class="sc-lane" x="${m.l}" y="${plotB + 6}" width="${width - m.l - m.r}" height="${laneH}" rx="4"/>`);
  parts.push(`<text class="sc-lane-label" x="${width - m.r - 6}" y="${laneY + 4}" text-anchor="end">not confirmed</text>`);

  // reference lines
  const vline = (h, label, cls) =>
    h >= x0 && h <= x1
      ? `<line class="${cls}" x1="${X(h)}" x2="${X(h)}" y1="${m.t}" y2="${plotB + 6 + laneH}"/>${
          X(h) > width - m.r - 48
            ? `<text class="sc-ref-label" x="${X(h) - 4}" y="${m.t + 10}" text-anchor="end">${label}</text>`
            : `<text class="sc-ref-label" x="${X(h) + 4}" y="${m.t + 10}">${label}</text>`
        }`
      : '';
  parts.push(vline(targetAge, 'Target', 'sc-target'));
  if (nowAge !== null) parts.push(vline(nowAge, 'Now', 'sc-now'));

  // observations: stored estimate bracket + observed marker (no connecting lines)
  for (const o of obs) {
    const x = X(o.ageMinutes / 60);
    const [lo, hi] = o.estimate.stages;
    const tip = esc(observationTip(o, record.timeZone));
    parts.push(`<g class="sc-snap"><line x1="${x}" x2="${x}" y1="${Y(hi + 0.4)}" y2="${Y(lo - 0.4)}"/>
      <line x1="${x - 5}" x2="${x + 5}" y1="${Y(hi + 0.4)}" y2="${Y(hi + 0.4)}"/><line x1="${x - 5}" x2="${x + 5}" y1="${Y(lo - 0.4)}" y2="${Y(lo - 0.4)}"/></g>`);
    let mark;
    if (o.verdict === VERDICTS.UNCONFIRMED) mark = `<circle class="sc-unconfirmed" cx="${x}" cy="${laneY}" r="6"/>`;
    else if (o.verdict === VERDICTS.MATCH) mark = `<circle class="sc-obs" cx="${x}" cy="${Y(o.observedStage)}" r="6.5"/>`;
    else {
      const y = Y(o.observedStage);
      mark = `<path class="sc-obs" d="M${x} ${y - 8}L${x + 8} ${y}L${x} ${y + 8}L${x - 8} ${y}Z"/>`;
    }
    const hitY = o.verdict === VERDICTS.UNCONFIRMED ? laneY : Y(o.observedStage);
    parts.push(`<g class="sc-mark" tabindex="0" role="img" aria-label="${tip}" data-tip="${tip}">
      <circle class="sc-hit" cx="${x}" cy="${hitY}" r="14"/>${mark}</g>`);
  }

  return `<svg class="stage-chart-svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="group"
    aria-label="HH stage estimate band and ${obs.length} recorded observation${obs.length === 1 ? '' : 's'} by incubation age">${parts.join('')}</svg>`;
}

/** Render into a container, re-render on resize, and add hover/focus tooltips. */
export function mountStageChart(container, record, { nowMs, open }) {
  const draw = () => {
    const width = Math.max(300, Math.floor(container.clientWidth));
    container.querySelector('.sc-canvas').innerHTML = stageChartSvg(record, { width, nowMs: nowMs(), open });
  };
  draw();
  const tip = container.querySelector('.sc-tooltip');
  const show = (g) => {
    tip.textContent = g.dataset.tip;
    tip.hidden = false;
    const box = container.getBoundingClientRect();
    const r = g.getBoundingClientRect();
    const left = Math.min(box.width - 260, Math.max(0, r.left - box.left - 120));
    tip.style.left = `${left}px`;
    tip.style.top = `${r.top - box.top - tip.offsetHeight - 8}px`;
  };
  const hide = () => (tip.hidden = true);
  container.addEventListener('pointerover', (e) => {
    const g = e.target.closest('.sc-mark');
    if (g) show(g);
  });
  container.addEventListener('pointerout', (e) => {
    if (e.target.closest('.sc-mark')) hide();
  });
  container.addEventListener('focusin', (e) => {
    const g = e.target.closest('.sc-mark');
    if (g) show(g);
  });
  container.addEventListener('focusout', hide);
  if (typeof ResizeObserver === 'function') {
    let last = container.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(container.clientWidth - last) > 8) {
        last = container.clientWidth;
        draw();
      }
    });
    ro.observe(container);
  }
}
