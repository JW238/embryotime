// Month calendar of target times plus an agenda list (used on small screens too).

import { html, mount } from '../dom.js';
import { eggSummary } from '../components.js';
import { STATUS_LABEL, effectiveStatus, isOverdue } from '../../experiment.js';
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

  // Group experiments by target date in their own time zone.
  const byDay = new Map();
  for (const r of ctx.experiments) {
    const key = zonedDateKey(Date.parse(r.targetAt), r.timeZone);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(r);
  }
  for (const list of byDay.values()) list.sort((a, b) => Date.parse(a.targetAt) - Date.parse(b.targetAt));

  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${monthKey}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);

  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(year, month - 1, 1));
  const kind = (r) => (isOverdue(r, now) ? 'overdue' : effectiveStatus(r, now));
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
    <p class="hint">Experiments appear on their target date in their recorded time zone. Today is highlighted in your computer's zone (${tz}).</p>
    <div class="cal card" aria-hidden="false">
      <div class="cal-head">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => html`<div>${d}</div>`)}</div>
      <div class="cal-grid">
        ${cells.map((key) => {
          if (!key) return html`<div class="cal-cell cal-empty"></div>`;
          const items = byDay.get(key) ?? [];
          return html`<div class="cal-cell ${key === todayKey ? 'is-today' : ''}">
            <div class="cal-day">${Number(key.slice(8))}</div>
            ${items.slice(0, 3).map(
              (r) => html`<a class="cal-item cal-${kind(r)}" href="#/exp/${r.uid}" title="${r.experimentId} — ${r.name} — ${formatDateTime(Date.parse(r.targetAt), r.timeZone)}">
                <span class="cal-time">${formatTime(Date.parse(r.targetAt), r.timeZone)}</span> ${r.experimentId}</a>`
            )}
            ${items.length > 3 ? html`<div class="cal-more">+${items.length - 3} more</div>` : ''}
          </div>`;
        })}
      </div>
    </div>
    <section class="card">
      <h2>Targets in ${monthName}</h2>
      ${inMonth.length
        ? html`<ol class="agenda">${inMonth.map(
            ([key, items]) => html`<li><div class="agenda-day ${key === todayKey ? 'is-today' : ''}">${new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(Date.parse(`${key}T00:00:00Z`))}</div>
              <ul>${items.map(
                (r) => html`<li><a href="#/exp/${r.uid}"><span class="mono">${formatTime(Date.parse(r.targetAt), r.timeZone)} ${zoneAbbreviation(Date.parse(r.targetAt), r.timeZone)}</span> · ${r.experimentId} — ${r.name} <span class="muted">(${eggSummary(r)})</span></a>
                  <span class="badge badge-${kind(r)}">${kind(r) === 'overdue' ? 'Overdue' : STATUS_LABEL[kind(r)]}</span></li>`
              )}</ul></li>`
          )}</ol>`
        : html`<p class="muted">No experiment targets this month.</p>`}
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
