// Reusable view fragments. All return Html from the `html` helper.

import { html } from './dom.js';
import { STATUS_LABEL, calendarState, effectiveStatus, eggCounts, formatEggs, isOpen, isOverdue, recordWarnings } from '../experiment.js';
import {
  formatApproxDuration,
  formatCountdown,
  formatDate,
  formatDuration,
  formatDurationDays,
  formatTime,
  timeRemaining,
  zoneAbbreviation,
} from '../time.js';

const ms = (iso) => Date.parse(iso);

export function statusBadge(record, nowMs) {
  const status = effectiveStatus(record, nowMs);
  return html`<span class="badge badge-${status}">${STATUS_LABEL[status]}</span>${
    isOverdue(record, nowMs) ? html` <span class="badge badge-overdue">Overdue</span>` : ''
  }${record.demo ? html` <span class="badge badge-demo" title="Demo data — not a real experiment">Demo</span>` : ''}`;
}

/** Text shown inside a live countdown element. Shared with the ticker. */
export function countdownText(targetMs, nowMs) {
  const r = timeRemaining(targetMs, nowMs);
  return r.overdue ? `Overdue by ${formatApproxDuration(r.overdueMs)}` : formatCountdown(r.remainingMs);
}

/** Live countdown, updated every second by the app ticker. */
export function countdown(record, nowMs, { large = false } = {}) {
  if (!isOpen(record)) {
    return html`<span class="countdown countdown-closed">${STATUS_LABEL[record.status]}</span>`;
  }
  const targetMs = ms(record.targetAt);
  const overdue = targetMs <= nowMs;
  return html`<span class="countdown ${large ? 'countdown-lg' : ''} ${overdue ? 'is-overdue' : ''}"
    data-countdown="${targetMs}" data-overdue="${String(overdue)}" role="timer" aria-live="off">${countdownText(targetMs, nowMs)}</span>`;
}

/** "40 h (1 d 16 h)" for long durations, "45 min" for short ones. */
export function formatLongDuration(minutes) {
  return minutes >= 1440 ? `${formatDuration(minutes)} (${formatDurationDays(minutes)})` : formatDuration(minutes);
}

/** Duration that keeps growing: baseMinutes + time elapsed since sinceMs. Updated by the ticker. */
export function liveDuration(sinceMs, baseMinutes, nowMs) {
  const minutes = baseMinutes + Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
  return html`<span data-elapsed-since="${sinceMs}" data-base="${baseMinutes}">${formatLongDuration(minutes)}</span>`;
}

export function targetDisplay(iso, timeZone, { large = false } = {}) {
  const t = ms(iso);
  return html`<div class="target ${large ? 'target-lg' : ''}">
    <div class="target-date">${formatDate(t, timeZone)}</div>
    <div class="target-time">${formatTime(t, timeZone)} <span class="tz" title="${timeZone}">${zoneAbbreviation(t, timeZone)}</span></div>
  </div>`;
}

export function calendarButton(record, { compact = false } = {}) {
  const state = calendarState(record);
  const label = { none: 'Add to calendar (.ics)', current: 'Download .ics again', outdated: 'Download updated .ics' }[state];
  return html`<button type="button" class="btn ${state === 'outdated' ? 'btn-warn' : 'btn-secondary'} ${compact ? 'btn-sm' : ''}"
    data-action="ics" data-uid="${record.uid}" title="Downloads a calendar file you can import into Google, Apple or Outlook Calendar">
    <span aria-hidden="true">📅</span> ${label}</button>`;
}

export function calendarStatusText(record, timeZone) {
  const state = calendarState(record);
  if (state === 'none') return 'No calendar file downloaded yet.';
  const when = `${formatDate(ms(record.calendar.exportedAt), timeZone)} ${formatTime(ms(record.calendar.exportedAt), timeZone)}`;
  if (state === 'outdated') return `Calendar file downloaded ${when}, but the schedule has changed since. Download the updated file and replace the old event.`;
  return `Calendar file (.ics) downloaded ${when}. EmbryoTime cannot confirm it was imported into your calendar.`;
}

export function warningList(record) {
  const w = recordWarnings(record);
  if (!w.length) return '';
  return html`<ul class="warnings">${w.map((x) => html`<li>${x}</li>`)}</ul>`;
}

export function experimentCard(record, nowMs) {
  const open = isOpen(record);
  const overdue = isOverdue(record, nowMs);
  return html`<article class="card exp-card ${overdue ? 'is-overdue' : ''}" aria-labelledby="card-${record.uid}">
    <header class="exp-card-head">
      <a class="exp-id" id="card-${record.uid}" href="#/exp/${record.uid}">${record.experimentId}</a>
      <span class="badges">${statusBadge(record, nowMs)}</span>
    </header>
    <p class="exp-name">${record.name}${record.batchId ? html` <span class="muted">· ${record.batchId}</span>` : ''}</p>
    <p class="exp-eggs">${eggSummary(record)}</p>
    <div class="exp-card-body">
      <div><div class="label">Target</div>${targetDisplay(record.targetAt, record.timeZone)}</div>
      <div><div class="label">${overdue ? 'Status' : 'Time remaining'}</div>${countdown(record, nowMs)}</div>
    </div>
    ${warningList(record)}
    <footer class="exp-card-actions">
      ${open ? calendarButton(record, { compact: true }) : ''}
      <a class="btn btn-ghost btn-sm" href="#/exp/${record.uid}">View</a>
      ${open ? html`<a class="btn btn-ghost btn-sm" href="#/exp/${record.uid}/edit">Edit</a>
        <button type="button" class="btn btn-ghost btn-sm" data-action="complete" data-uid="${record.uid}">Complete</button>` : ''}
    </footer>
  </article>`;
}

export function emptyState(title, body, actions = '') {
  return html`<div class="empty"><h2>${title}</h2><p>${body}</p><div class="empty-actions">${actions}</div></div>`;
}

export function errorPanel(message, actions = '') {
  return html`<div class="alert alert-error" role="alert"><strong>Problem:</strong> ${message} ${actions}</div>`;
}

/** "24 eggs" · "21 of 24 eggs active" · "36 eggs completed" · "Egg count not recorded" */
export function eggSummary(record) {
  const c = eggCounts(record);
  if (!c.known) return 'Egg count not recorded';
  if (record.status === 'completed') return `${formatEggs(c.completed)} completed${c.removed ? `, ${c.removed} removed` : ''}`;
  if (record.status === 'cancelled') return `Cancelled with ${formatEggs(c.cancelled)}${c.removed ? `, ${c.removed} removed` : ''}`;
  return c.active === c.initial ? formatEggs(c.initial) : `${c.active} of ${c.initial} eggs active`;
}

/** Batch and egg totals for a set of records (each batch counted once). */
export function totalsStrip(t, { label = 'Totals' } = {}) {
  const item = (n, text, kind = '') => html`<li class="${kind}"><strong>${n}</strong> ${text}</li>`;
  return html`<section class="totals" aria-label="${label}">
    <div class="totals-group">
      <h3>Batches</h3>
      <ul>
        ${item(t.batches, 'total')}${item(t.activeBatches, 'active')}${item(t.plannedBatches, 'planned')}
        ${item(t.completedBatches, 'completed')}${item(t.cancelledBatches, 'cancelled')}
        ${t.overdueBatches ? item(t.overdueBatches, 'overdue', 'is-alert') : ''}
      </ul>
    </div>
    <div class="totals-group">
      <h3>Eggs</h3>
      <ul>
        ${item(t.eggsInitial, 'placed')}${item(t.eggsActive, 'active')}${item(t.eggsPlanned, 'planned')}
        ${item(t.eggsCompleted, 'completed')}${item(t.eggsRemoved, 'removed')}${item(t.eggsCancelled, 'in cancelled batches')}
      </ul>
    </div>
    ${t.unknownEggBatches
      ? html`<p class="hint">Egg totals leave out ${t.unknownEggBatches} older ${t.unknownEggBatches === 1 ? 'batch' : 'batches'} without a recorded count.</p>`
      : ''}
  </section>`;
}
