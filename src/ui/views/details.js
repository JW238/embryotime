import { html, mount } from '../dom.js';
import {
  calendarButton,
  calendarStatusText,
  countdown,
  emptyState,
  formatLongDuration as durationWithDays,
  liveDuration,
  statusBadge,
  targetDisplay,
  warningList,
} from '../components.js';
import { bindActions } from '../actions.js';
import {
  EGG_ADJUSTMENT_LABEL,
  describeDelta,
  eggCounts,
  formatReminder,
  incubationTimeline,
  isOpen,
  targetShiftMs,
} from '../../experiment.js';
import { formatDateTime } from '../../time.js';

export function renderDetails(container, ctx, { uid }) {
  const r = ctx.find(uid);
  if (!r) {
    mount(container, emptyState('Experiment not found', 'It may have been deleted, or the link is from another browser.', html`<a class="btn btn-primary" href="#/">Back to hatchery</a>`));
    return { tickRerender: false };
  }
  const now = ctx.now();
  const tz = r.timeZone;
  const dt = (iso) => (iso ? formatDateTime(Date.parse(iso), tz) : '—');
  const open = isOpen(r);
  const timeline = incubationTimeline(r, now);
  const shift = targetShiftMs(r);
  const placed = timeline.nowMinutes !== null;
  const placementMs = Date.parse(r.placementAt);
  const c = eggCounts(r);

  const root = mount(
    container,
    html`<div class="page-head">
      <div>
        <p class="crumbs"><a href="#/">← Hatchery</a></p>
        <h1><span class="mono">${r.experimentId}</span> <span class="badges">${statusBadge(r, now)}</span></h1>
        <p class="subtitle">${r.name}${r.batchId ? html` · Batch/sample <strong>${r.batchId}</strong>` : ''}</p>
      </div>
      <div class="action-bar">
        ${open ? calendarButton(r) : ''}
        ${open ? html`<a class="btn btn-secondary" href="#/exp/${r.uid}/edit">Edit schedule</a>` : ''}
        ${open ? html`<button type="button" class="btn btn-primary" data-action="complete" data-uid="${r.uid}">Mark completed</button>` : ''}
        ${!open ? html`<button type="button" class="btn btn-secondary" data-action="reopen" data-uid="${r.uid}">Reopen</button>` : ''}
        <details class="more">
          <summary class="btn btn-ghost">More</summary>
          <div class="more-menu">
            <button type="button" class="btn btn-ghost" data-action="duplicate" data-uid="${r.uid}">Duplicate as template</button>
            ${!open ? calendarButton(r) : ''}
            ${open ? html`<button type="button" class="btn btn-ghost" data-action="cancel" data-uid="${r.uid}">Cancel experiment</button>` : ''}
            <button type="button" class="btn btn-ghost danger" data-action="delete" data-uid="${r.uid}">Delete record</button>
          </div>
        </details>
      </div>
    </div>
    ${warningList(r)}

    <div class="detail-grid">
      <section class="card target-card ${open && Date.parse(r.targetAt) <= now ? 'is-overdue' : ''}">
        <h2 class="label">${shift ? 'Updated target' : 'Target'} — lab return</h2>
        ${targetDisplay(r.targetAt, tz, { large: true })}
        <p class="hint">${tz}</p>
        <div class="label">Time remaining</div>
        ${countdown(r, now, { large: true })}
        ${shift
          ? html`<p class="alert alert-info">Original planned target: <strong>${dt(r.originalTargetAt)}</strong> (moved ${describeDelta(shift).replace('late', 'later').replace('early', 'earlier')}).</p>`
          : ''}
      </section>

      <section class="card eggs-card">
        <h2>Eggs in this batch</h2>
        ${c.known
          ? html`<dl class="kv">
              <dt>Placed (initial count)</dt><dd><strong>${c.initial}</strong></dd>
              <dt>${open ? 'Active' : 'Active at close'}</dt><dd>${c.active}</dd>
              <dt>Completed</dt><dd>${c.completed}</dd>
              <dt>Removed</dt><dd>${c.removed}</dd>
              ${c.cancelled ? html`<dt>In cancelled batch</dt><dd>${c.cancelled}</dd>` : ''}
            </dl>
            ${open
              ? html`<div class="action-bar">
                  <button type="button" class="btn btn-secondary btn-sm" data-action="eggs-remove" data-uid="${r.uid}" ${c.active ? '' : 'disabled'}>Remove eggs…</button>
                  <button type="button" class="btn btn-secondary btn-sm" data-action="eggs-complete" data-uid="${r.uid}" ${c.active ? '' : 'disabled'}>Complete some eggs early…</button>
                </div>`
              : ''}
            ${r.eggAdjustments.length
              ? html`<div class="label adj-label">Count changes</div>
                <ul class="adjustments">${r.eggAdjustments.map(
                  (a) => html`<li><span class="muted">${dt(a.at)}</span> — ${EGG_ADJUSTMENT_LABEL[a.kind]} ${a.count}
                    (active ${a.activeBefore} → ${a.activeAfter})${a.reason ? html`: <em>${a.reason}</em>` : ''}</li>`
                )}</ul>`
              : html`<p class="hint">No count changes. All eggs share this batch's schedule and status.</p>`}`
          : html`<p>This batch was created before egg counts existed, so the number of eggs is not recorded.</p>
            ${open ? html`<a class="btn btn-secondary btn-sm" href="#/exp/${r.uid}/edit">Add the egg count</a>` : ''}`}
      </section>

      <section class="card">
        <h2>Incubation status</h2>
        <dl class="kv">
          <dt>Incubation at placement</dt><dd>${durationWithDays(timeline.atPlacementMinutes)}</dd>
          <dt>Placed in incubator</dt><dd>${dt(r.placementAt)}</dd>
          <dt>Elapsed since placement</dt><dd>${!placed ? 'Not yet placed' : open ? liveDuration(placementMs, 0, now) : durationWithDays(timeline.sincePlacementMinutes)}</dd>
          <dt>Calculated incubation now</dt><dd>${placed && open ? liveDuration(placementMs, r.currentIncubationMinutes, now) : '—'}</dd>
          <dt>Waiting duration</dt><dd>${durationWithDays(r.waitMinutes)}</dd>
          <dt>Projected total at target</dt><dd><strong>${durationWithDays(timeline.projectedAtTargetMinutes)}</strong></dd>
        </dl>
        <p class="hint">Calculated from the entered values assuming uninterrupted incubation. Not a measurement of developmental stage.</p>
      </section>

      <section class="card">
        <h2>Completion</h2>
        ${r.status === 'completed'
          ? html`<dl class="kv">
              <dt>Actual completion</dt><dd>${dt(r.completedAt)}</dd>
              <dt>vs. current target</dt><dd>${describeDelta(Date.parse(r.completedAt) - Date.parse(r.targetAt))}</dd>
              ${shift ? html`<dt>vs. original target</dt><dd>${describeDelta(Date.parse(r.completedAt) - Date.parse(r.originalTargetAt))}</dd>` : ''}
              ${r.completionNote ? html`<dt>Note</dt><dd class="pre">${r.completionNote}</dd>` : ''}
            </dl>`
          : r.status === 'cancelled'
            ? html`<dl class="kv"><dt>Cancelled</dt><dd>${dt(r.cancelledAt)}</dd>${r.cancelReason ? html`<dt>Reason</dt><dd class="pre">${r.cancelReason}</dd>` : ''}</dl>`
            : html`<p class="muted">Not completed yet.</p>`}
      </section>

      <section class="card">
        <h2>Calendar and reminders</h2>
        <p>${calendarStatusText(r, tz)}</p>
        <div class="label">Reminders in calendar file</div>
        ${r.reminderOffsets.length
          ? html`<ul class="plain">${r.reminderOffsets.map((m) => html`<li>${formatReminder(m)}</li>`)}</ul>`
          : html`<p class="warn-text">None configured.</p>`}
        <p class="hint">Direct calendar sync is not available yet; download the .ics file and open it in your calendar app.</p>
      </section>

      <section class="card">
        <h2>Notes and conditions</h2>
        <div class="label">Conditions</div>
        <p class="pre">${r.conditions || '—'}</p>
        <div class="label">Notes</div>
        <p class="pre">${r.notes || '—'}</p>
      </section>

      <section class="card">
        <h2>Record</h2>
        <dl class="kv">
          <dt>Time zone</dt><dd>${tz}</dd>
          <dt>Created</dt><dd>${dt(r.createdAt)}</dd>
          <dt>Last updated</dt><dd>${dt(r.updatedAt)}</dd>
          ${r.demo ? html`<dt>Source</dt><dd>Demo data</dd>` : ''}
        </dl>
      </section>
    </div>

    <section class="card">
      <h2>Change history</h2>
      <ol class="timeline">
        ${[...r.history].reverse().map(
          (h) => html`<li>
            <div class="timeline-when">${dt(h.at)}</div>
            <div class="timeline-what"><strong>${h.summary}</strong>
              ${h.reason ? html`<div class="muted">Reason/note: ${h.reason}</div>` : ''}
              ${h.changes?.length
                ? html`<ul class="changes">${h.changes.map((c) => html`<li>${c.label}: <span class="from">${c.from}</span> → <span class="to">${c.to}</span></li>`)}</ul>`
                : ''}
            </div>
          </li>`
        )}
      </ol>
    </section>`
  );
  bindActions(root, ctx);
  return { tickRerender: true };
}
