// Reusable view fragments. All return Html from the `html` helper.

import { html } from './dom.js';
import {
  STATUS_LABEL,
  calendarState,
  displayName,
  effectiveStatus,
  eggCounts,
  formatEggs,
  isOpen,
  isOverdue,
  plannedReturnOf,
  recordWarnings,
  windowOf,
} from '../experiment.js';
import { BACKUP_MAX_AGE_DAYS, backupStatus, createBackupMetaStore } from '../storage.js';
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
    isOverdue(record, nowMs) ? html` <span class="badge badge-overdue">${windowOf(record) ? 'Window passed' : 'Overdue'}</span>` : ''
  }${record.demo ? html` <span class="badge badge-demo" title="Demo data — not a real experiment">Demo</span>` : ''}`;
}

/** Text shown inside a live countdown element. Shared with the ticker. */
export function countdownText(targetMs, nowMs) {
  const r = timeRemaining(targetMs, nowMs);
  return r.overdue ? `Overdue by ${formatApproxDuration(r.overdueMs)}` : formatCountdown(r.remainingMs);
}

/** Window phase text: "Window opens in…" / "In window · closes in…" / "Window passed". */
export function windowText(startMs, endMs, nowMs) {
  if (nowMs < startMs) return `Window opens in ${formatApproxDuration(startMs - nowMs)}`;
  if (nowMs <= endMs) return `In window · closes in ${formatApproxDuration(endMs - nowMs)}`;
  return 'Window passed';
}

export function windowPhaseAt(startMs, endMs, nowMs) {
  return nowMs < startMs ? 'before' : nowMs <= endMs ? 'in' : 'after';
}

/** Live countdown, updated every second by the app ticker. */
export function countdown(record, nowMs, { large = false } = {}) {
  if (!isOpen(record)) {
    return html`<span class="countdown countdown-closed">${STATUS_LABEL[record.status]}</span>`;
  }
  const w = windowOf(record);
  if (w) {
    const phase = windowPhaseAt(w.startMs, w.endMs, nowMs);
    return html`<span class="countdown window-state phase-${phase} ${large ? 'countdown-lg' : ''}"
      data-window-start="${w.startMs}" data-window-end="${w.endMs}" data-phase="${phase}" role="timer" aria-live="off">${windowText(w.startMs, w.endMs, nowMs)}</span>`;
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

/** "Tue, Oct 27 · 03:26 – 12:26 EDT" (or across dates) for an estimated window. */
export function windowDisplay(record, { large = false } = {}) {
  const w = windowOf(record);
  const tz = record.timeZone;
  const sameDay = formatDate(w.startMs, tz) === formatDate(w.endMs, tz);
  const ret = plannedReturnOf(record);
  return html`<div class="target window-display ${large ? 'target-lg' : ''}">
    <div class="window-tag"><span class="est-tag">estimate</span> HH${record.stagePlan.targetStage} window</div>
    ${sameDay
      ? html`<div class="target-date">${formatDate(w.startMs, tz)}</div>
          <div class="target-time window-times">${formatTime(w.startMs, tz)}–${formatTime(w.endMs, tz)} <span class="tz" title="${tz}">${zoneAbbreviation(w.endMs, tz)}</span></div>`
      : html`<div class="window-range">${formatDate(w.startMs, tz)} ${formatTime(w.startMs, tz)}<br>– ${formatDate(w.endMs, tz)} ${formatTime(w.endMs, tz)}
          <span class="tz" title="${tz}">${zoneAbbreviation(w.endMs, tz)}</span></div>`}
    ${ret !== null ? html`<div class="planned-return">Planned return: <strong>${formatDate(ret, tz)} ${formatTime(ret, tz)}</strong></div>` : ''}
  </div>`;
}

/** Target block for any batch: the estimated window, or the entered target time. */
export function scheduleDisplay(record, opts = {}) {
  return windowOf(record) ? windowDisplay(record, opts) : targetDisplay(record.targetAt, record.timeZone, opts);
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
  const w = windowOf(record);
  return html`<article class="card exp-card ${overdue ? 'is-overdue' : ''}" aria-labelledby="card-${record.uid}">
    <header class="exp-card-head">
      <a class="exp-title" id="card-${record.uid}" href="#/exp/${record.uid}">${displayName(record)}</a>
      <span class="badges">${statusBadge(record, nowMs)}</span>
    </header>
    <p class="exp-name"><span class="record-id">${record.experimentId}</span>${record.batchId ? html` · ${record.batchId}` : ''}</p>
    <p class="exp-eggs">${eggSummary(record)}</p>
    <div class="exp-card-body">
      <div><div class="label">${w ? 'Estimated window' : 'Target'}</div>${scheduleDisplay(record)}</div>
      <div><div class="label">${w ? 'Window status' : overdue ? 'Status' : 'Time remaining'}</div>${countdown(record, nowMs)}</div>
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
        ${t.overdueBatches ? item(t.overdueBatches, 'overdue or window passed', 'is-alert') : ''}
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

/**
 * Backup health. The browser cannot confirm a download was saved, so the wording is
 * "download started", never "backed up".
 */
export function backupStatusPanel(ctx, { withButton = true, compact = false } = {}) {
  const st = backupStatus(createBackupMetaStore().load(), ctx.experiments, ctx.now());
  if (st.state === 'empty') return compact ? '' : html`<p class="backup-state">No batches yet — nothing to back up.</p>`;
  if (compact && st.state === 'recent') return '';
  const when = st.lastMs ? `${formatDate(st.lastMs, ctx.browserTimeZone)} ${formatTime(st.lastMs, ctx.browserTimeZone)}` : '';
  const text = {
    none: 'No backup download recorded in this browser.',
    stale: `Last backup download started ${when} — more than ${BACKUP_MAX_AGE_DAYS} days ago.`,
    changed: `Last backup download started ${when}; batches have changed since.`,
    recent: `Last backup download started ${when}. (The browser cannot confirm the file was saved.)`,
  }[st.state];
  const warn = st.state !== 'recent';
  return html`<div class="backup-state ${warn ? 'alert alert-warn' : 'hint'}" role="${warn ? 'status' : ''}">
    ${warn ? html`<strong>Backup:</strong> ` : ''}${text}${warn ? ' Data saved only in this browser is lost if browser data is cleared.' : ''}
    ${withButton && warn ? html` <button type="button" class="btn btn-secondary btn-sm" data-backup-now>Download backup now</button>` : ''}
  </div>`;
}
