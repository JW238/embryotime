// Month calendar of target times / estimated windows plus an agenda list (used on small screens too).

import { html, mount } from '../dom.js';
import { eggSummary } from '../components.js';
import { STATUS_LABEL, displayName, effectiveStatus, isOverdue, sortKey, windowOf } from '../../experiment.js';
import { formatDateTime, formatTime, zonedDateKey, zoneAbbreviation } from '../../time.js';

let shownMonth = null; // { year, month } — month is 1-12

const pad = (n) => String(n).padStart(2, '0');

export function renderCalendar(container, ctx) {
  const now = ctx.now();
  const tz = ctx.browserTimeZone;
  const todayKey = zonedDateKey(now, tz);
  if (!shownMonth) shownMonth = { year: Number(todayKey.slice(0, 4)), month: Number(todayKey.slice(5, 7)) };
  const { year, month } = shownMonth;
  const monthKey = `${year}-${pad(month)}`;

  // Group batches by date in their own time zone. A stage-based batch appears on every day its
  // estimated window covers (it is a window, not a single deadline).
  const byDay = new Map();
  const add = (key, entry) => {
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(entry);
  };
  for (const r of ctx.experiments) {
    const w = windowOf(r);
    if (!w) {
      add(zonedDateKey(Date.parse(r.targetAt), r.timeZone), { r, part: 'point' });
      continue;
    }
    const first = zonedDateKey(w.startMs, r.timeZone);
    const last = zonedDateKey(w.endMs, r.timeZone);
    let cursor = Date.parse(`${first}T12:00:00Z`);
    for (let guard = 0; guard < 60; guard++) {
      const key = new Date(cursor).toISOString().slice(0, 10);
      if (key > last) break;
      add(key, { r, part: key === first && key === last ? 'whole' : key === first ? 'start' : key === last ? 'end' : 'middle' });
      cursor += 86_400_000;
    }
  }
  for (const list of byDay.values()) list.sort((a, b) => sortKey(a.r) - sortKey(b.r));
  const timeLabel = ({ r, part }) => {
    const w = windowOf(r);
    if (!w) return formatTime(Date.parse(r.targetAt), r.timeZone);
    if (part === 'whole') return `${formatTime(w.startMs, r.timeZone)}–${formatTime(w.endMs, r.timeZone)}`;
    if (part === 'start') return `${formatTime(w.startMs, r.timeZone)}→`;
    if (part === 'end') return `→${formatTime(w.endMs, r.timeZone)}`;
    return 'window';
  };

  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${monthKey}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);

  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(year, month - 1, 1));
  const kind = (r) => (isOverdue(r, now) ? 'overdue' : effectiveStatus(r, now));
  const kindLabel = (r) => (kind(r) === 'overdue' ? (windowOf(r) ? 'Window passed' : 'Overdue') : STATUS_LABEL[kind(r)]);
  const inMonth = [...byDay.entries()].filter(([k]) => k.startsWith(monthKey)).sort(([a], [b]) => a.localeCompare(b));

  const root = mount(
    container,
    html`<div class="page-head">
      <h1>Calendar</h1>
      <div class="month-nav" role="group" aria-label="Change month">
        <button type="button" class="btn btn-ghost" data-month="-1" aria-label="Previous month">←</button>
        <h2 class="month-title" aria-live="polite">${monthName}</h2>
        <button type="button" class="btn btn-ghost" data-month="1" aria-label="Next month">→</button>
        <button type="button" class="btn btn-secondary btn-sm" data-month="0">Today</button>
      </div>
    </div>
    <p class="hint">Entered-duration batches appear on their target date. Stage-based batches appear across every day of their <strong>estimated window</strong> (shown with a dashed edge) — not as a fixed deadline. Dates use each batch's recorded time zone; today is highlighted in your computer's zone (${tz}).</p>
    <div class="cal card" aria-hidden="false">
      <div class="cal-head">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => html`<div>${d}</div>`)}</div>
      <div class="cal-grid">
        ${cells.map((key) => {
          if (!key) return html`<div class="cal-cell cal-empty"></div>`;
          const items = byDay.get(key) ?? [];
          return html`<div class="cal-cell ${key === todayKey ? 'is-today' : ''}">
            <div class="cal-day">${Number(key.slice(8))}</div>
            ${items.slice(0, 3).map(
              (e) => html`<a class="cal-item cal-${kind(e.r)} ${windowOf(e.r) ? 'cal-window' : ''}" href="#/exp/${e.r.uid}"
                title="${displayName(e.r)} — ${windowOf(e.r) ? `estimated window ${formatDateTime(windowOf(e.r).startMs, e.r.timeZone)} – ${formatDateTime(windowOf(e.r).endMs, e.r.timeZone)}` : formatDateTime(Date.parse(e.r.targetAt), e.r.timeZone)}">
                <span class="cal-time">${timeLabel(e)}</span> ${displayName(e.r)}</a>`
            )}
            ${items.length > 3 ? html`<div class="cal-more">+${items.length - 3} more</div>` : ''}
          </div>`;
        })}
      </div>
    </div>
    <section class="card">
      <h2>Targets and estimated windows in ${monthName}</h2>
      ${inMonth.length
        ? html`<ol class="agenda">${inMonth.map(
            ([key, items]) => html`<li><div class="agenda-day ${key === todayKey ? 'is-today' : ''}">${new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(Date.parse(`${key}T00:00:00Z`))}</div>
              <ul>${items.map(
                (e) => html`<li><a href="#/exp/${e.r.uid}"><span class="mono">${timeLabel(e)} ${zoneAbbreviation(sortKey(e.r), e.r.timeZone)}</span> · ${displayName(e.r)}
                  ${windowOf(e.r) ? html`<span class="est-tag">estimated window</span>` : ''} <span class="muted">(${eggSummary(e.r)} · ${e.r.experimentId})</span></a>
                  <span class="badge badge-${kind(e.r)}">${kindLabel(e.r)}</span></li>`
              )}</ul></li>`
          )}</ol>`
        : html`<p class="muted">No targets or estimated windows this month.</p>`}
    </section>`
  );

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-month]');
    if (!btn) return;
    const step = Number(btn.dataset.month);
    if (step === 0) shownMonth = null;
    else {
      const d = new Date(Date.UTC(year, month - 1 + step, 1));
      shownMonth = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
    }
    renderCalendar(container, ctx);
    container.querySelector(`[data-month="${step}"]`)?.focus();
  });
  return { tickRerender: true };
}
