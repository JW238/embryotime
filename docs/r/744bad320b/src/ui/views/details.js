import { html, mount } from '../dom.js';
import {
  calendarButton,
  calendarStatusText,
  countdown,
  emptyState,
  formatLongDuration as durationWithDays,
  liveDuration,
  scheduleDisplay,
  statusBadge,
  warningList,
} from '../components.js';
import { bindActions } from '../actions.js';
import {
  EGG_ADJUSTMENT_LABEL,
  VERDICT_LABEL,
  describeDelta,
  displayName,
  eggCounts,
  estimateStageAt,
  formatAgeRange,
  formatReminder,
  formatTemperature,
  formatWindow,
  incubationTimeline,
  isOpen,
  observationsByTime,
  plannedReturnOf,
  retractionFor,
  targetShiftMs,
  temperatureNotice,
  windowOf,
} from '../../experiment.js';
import { formatDateTime } from '../../time.js';
import { BASIS_LABEL, PLANNED_RETURN, formatHoursRange } from '../../hh-stages.js';
import { findConflicts, mountStageChart } from '../stage-chart.js';


export function renderDetails(container, ctx, { uid }) {
  const r = ctx.find(uid);
  if (!r) {
    mount(container, emptyState('Batch not found', 'It may have been deleted, or the link is from another browser (data is stored per browser).', html`<a class="btn btn-primary" href="#/">Back to hatchery</a>`));
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
  const w = windowOf(r);
  const ret = plannedReturnOf(r);
  const passed = open && (w ? now > w.endMs : Date.parse(r.targetAt) <= now);

  const root = mount(
    container,
    html`<div class="page-head">
      <div>
        <p class="crumbs"><a href="#/">← Hatchery</a></p>
        <h1>${displayName(r)} <span class="badges">${statusBadge(r, now)}</span></h1>
        <p class="subtitle">Record ID <span class="mono">${r.experimentId}</span>${r.batchId ? html` · Batch/sample <strong>${r.batchId}</strong>` : ''}
          · ${w ? 'Stage-based timing (estimate)' : 'Entered durations'}</p>
      </div>
      <div class="action-bar">
        ${open ? calendarButton(r) : ''}
        ${open ? html`<a class="btn btn-secondary" href="#/exp/${r.uid}/edit">Edit</a>` : ''}
        ${r.status !== 'cancelled' ? html`<button type="button" class="btn btn-secondary" data-action="observe" data-uid="${r.uid}">Record observation</button>` : ''}
        ${open ? html`<button type="button" class="btn btn-primary" data-action="complete" data-uid="${r.uid}">Mark completed</button>` : ''}
        ${!open ? html`<button type="button" class="btn btn-secondary" data-action="reopen" data-uid="${r.uid}">Reopen</button>` : ''}
        <details class="more">
          <summary class="btn btn-ghost">More</summary>
          <div class="more-menu">
            ${open && !w ? html`<button type="button" class="btn btn-ghost" data-action="convert" data-uid="${r.uid}">Convert to stage-based timing…</button>` : ''}
            <button type="button" class="btn btn-ghost" data-action="duplicate" data-uid="${r.uid}">Duplicate as template</button>
            ${!open ? calendarButton(r) : ''}
            ${open ? html`<button type="button" class="btn btn-ghost" data-action="cancel" data-uid="${r.uid}">Cancel batch</button>` : ''}
            <button type="button" class="btn btn-ghost danger" data-action="delete" data-uid="${r.uid}">Delete record</button>
          </div>
        </details>
      </div>
    </div>
    ${warningList(r)}

    <div class="detail-grid">
      <section class="card target-card ${passed ? 'is-overdue' : ''}">
        <h2 class="label">${w ? `Estimated HH${r.stagePlan.targetStage} window` : `${shift ? 'Updated target' : 'Target'} — lab return`}</h2>
        ${scheduleDisplay(r, { large: true })}
        <p class="hint">${tz}</p>
        <div class="label">${w ? 'Window status' : 'Time remaining'}</div>
        ${countdown(r, now, { large: true })}
        ${w
          ? html`<p class="hint">${ret === null
              ? 'No planned return time — the window itself is tracked.'
              : html`Planned return (${PLANNED_RETURN[r.stagePlan.plannedReturn].toLowerCase()}): <strong>${formatDateTime(ret, tz)}</strong>. A planning choice, not a biological deadline.`}
              The target stage is not guaranteed at any exact time.</p>`
          : ''}
        ${!w && shift
          ? html`<p class="alert alert-info">Original planned target: <strong>${dt(r.originalTargetAt)}</strong> (moved ${describeDelta(shift).replace('late', 'later').replace('early', 'earlier')}).</p>`
          : ''}
        ${open && !w ? html`<p class="hint">Older batch with entered durations. <button type="button" class="link" data-action="convert" data-uid="${r.uid}">Convert to stage-based timing</button> (asks for confirmation).</p>` : ''}
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
        ${r.stagePlan ? stagePlanBlock(r) : ''}
        <dl class="kv">
          <dt>Incubation at placement</dt><dd>${formatAgeRange(timeline.atPlacementRange)}${
            timeline.atPlacementRange[0] !== timeline.atPlacementRange[1] ? html` <span class="est-tag">estimate</span>` : ''
          }</dd>
          <dt>Placed in incubator</dt><dd>${dt(r.placementAt)}</dd>
          <dt>Elapsed since placement</dt><dd>${!placed ? 'Not yet placed' : open ? liveDuration(placementMs, 0, now) : durationWithDays(timeline.sincePlacementMinutes)}</dd>
          <dt>Calculated incubation now</dt><dd>${placed && open
            ? timeline.atPlacementRange[0] === timeline.atPlacementRange[1]
              ? liveDuration(placementMs, timeline.atPlacementRange[0], now)
              : html`≈ ${liveDuration(placementMs, timeline.atPlacementRange[0], now)} – ${liveDuration(placementMs, timeline.atPlacementRange[1], now)} <span class="est-tag">estimate</span>`
            : '—'}</dd>
          ${w
            ? html`<dt>Target reference age</dt><dd>HH${r.stagePlan.targetStage}: ${formatHoursRange(r.stagePlan.targetAgeHours)}</dd>`
            : html`<dt>Waiting duration</dt><dd>${durationWithDays(r.waitMinutes)}</dd>
                <dt>Projected total at target</dt><dd><strong>${durationWithDays(timeline.projectedAtTargetMinutes)}</strong></dd>`}
          ${r.temperature ? html`<dt>Incubation temperature</dt><dd>${formatTemperature(r.temperature)}</dd>` : ''}
        </dl>
        <p class="hint">${r.stagePlan
          ? 'Ages are carried as a range from the starting point and assume uninterrupted incubation. They are estimates, not measurements.'
          : 'Calculated from the entered values assuming uninterrupted incubation. Not a measurement of developmental stage.'}
          ${r.temperature ? temperatureNotice(r.temperature) : ''}</p>
      </section>

      <section class="card">
        <h2>Completion</h2>
        ${r.status === 'completed'
          ? html`<dl class="kv">
              <dt>Actual completion</dt><dd>${dt(r.completedAt)}</dd>
              ${w
                ? html`<dt>vs. estimated window</dt><dd>${completionVsWindow(Date.parse(r.completedAt), w)}</dd>`
                : html`<dt>vs. current target</dt><dd>${describeDelta(Date.parse(r.completedAt) - Date.parse(r.targetAt))}</dd>
                  ${shift ? html`<dt>vs. original target</dt><dd>${describeDelta(Date.parse(r.completedAt) - Date.parse(r.originalTargetAt))}</dd>` : ''}`}
              ${r.completionNote ? html`<dt>Note</dt><dd class="pre">${r.completionNote}</dd>` : ''}
            </dl>`
          : r.status === 'cancelled'
            ? html`<dl class="kv"><dt>Cancelled</dt><dd>${dt(r.cancelledAt)}</dd>${r.cancelReason ? html`<dt>Reason</dt><dd class="pre">${r.cancelReason}</dd>` : ''}</dl>`
            : html`<p class="muted">Not completed yet.</p>`}
      </section>

      <section class="card">
        <h2>Calendar and alerts</h2>
        <p>${calendarStatusText(r, tz)}</p>
        <div class="label">Alerts in the calendar file</div>
        ${r.reminderOffsets.length
          ? html`<ul class="plain">${r.reminderOffsets.map((m) => html`<li>${formatReminder(m)}</li>`)}</ul>`
          : html`<p class="muted">None chosen.</p>`}
        <p class="hint">${w ? 'The calendar file contains the whole estimated window' : 'The calendar file contains the target time'}${ret !== null ? ' and a separate planned-return event' : ''}.
          Alerts depend on your calendar app; EmbryoTime does not send notifications.</p>
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
          <dt>Record ID</dt><dd class="mono">${r.experimentId}</dd>
          <dt>Time zone</dt><dd>${tz}</dd>
          <dt>Created</dt><dd>${dt(r.createdAt)}</dd>
          <dt>Last updated</dt><dd>${dt(r.updatedAt)}</dd>
          ${r.stagePlan ? html`<dt>Reference version</dt><dd>${r.stagePlan.referenceVersion}</dd>` : ''}
          ${r.demo ? html`<dt>Source</dt><dd>Demo data</dd>` : ''}
        </dl>
      </section>
    </div>

    ${developmentSection(r, now, open)}

    <section class="card">
      <h2>Change history</h2>
      <ol class="timeline">
        ${[...r.history].reverse().map(
          (h) => html`<li>
            <div class="timeline-when">${dt(h.at)}</div>
            <div class="timeline-what"><strong>${h.summary}</strong>
              ${h.reason ? html`<div class="muted">Reason/note: ${h.reason}</div>` : ''}
              ${h.changes?.length
                ? html`<ul class="changes">${h.changes.map((x) => html`<li>${x.label}: <span class="from">${x.from}</span> → <span class="to">${x.to}</span></li>`)}</ul>`
                : ''}
            </div>
          </li>`
        )}
      </ol>
    </section>`
  );
  bindActions(root, ctx);
  const chart = root.querySelector('.stage-chart');
  if (chart) mountStageChart(chart, r, { nowMs: ctx.now, open });
  return { tickRerender: true };
}

function completionVsWindow(t, w) {
  if (t < w.startMs) return `${describeDelta(t - w.startMs).replace(' early', '')} before the window opened`;
  if (t > w.endMs) return `${describeDelta(t - w.endMs).replace(' late', '')} after the window closed`;
  return 'inside the estimated window';
}

const ANSWER_SHORT = { match: 'Matches', different: 'Different', unconfirmed: 'Not confirmed', baseline: 'At setup' };

function developmentSection(r, now, open) {
  const obs = observationsByTime(r);
  const active = obs.filter((o) => !retractionFor(r, o.id));
  const est = open && now >= Date.parse(r.placementAt) ? estimateStageAt(r, now) : null;
  const conflicts = findConflicts(r);
  const staged = active.filter((o) => o.observedStage !== null).length;
  return html`<section class="card development" aria-labelledby="dev-title">
    <div class="dev-head">
      <h2 id="dev-title">Development: estimated vs observed HH stage</h2>
      ${r.status !== 'cancelled' ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="observe" data-uid="${r.uid}">Record observation</button>` : ''}
    </div>
    ${est
      ? html`<p>Estimated stage now: <strong>${est.label}</strong> <span class="est-tag">estimate</span>
          <span class="muted">at ${formatAgeRange(est.ageRangeMinutes)} calculated incubation, from <a href="#/stages">HH reference ages</a> only.</span></p>`
      : ''}
    ${active.length === 0
      ? html`<div class="empty-inline dev-empty">
          <p><strong>No active stage observations.</strong> When you examine embryos from this batch, record the stage you see.
          The chart compares observations with the reference estimate once there is at least one.</p>
        </div>`
      : html`<div class="stage-chart">
          <ul class="sc-legend" aria-label="Chart legend">
            <li><span class="lg lg-band"></span>Reference estimate (shaded band)</li>
            <li><span class="lg lg-snap"></span>Estimate stored with each observation (bracket)</li>
            <li><span class="lg lg-match"></span>Observed — matches (●)</li>
            <li><span class="lg lg-diff"></span>Observed — different (◆)</li>
            <li><span class="lg lg-base"></span>Observed at setup (■)</li>
            <li><span class="lg lg-unconf"></span>Not confirmed (○, no stage)</li>
          </ul>
          <div class="sc-canvas"></div>
          <div class="sc-tooltip" role="tooltip" hidden></div>
        </div>
        <p class="hint">Horizontal axis: time since placement. Markers are individual observations and are not joined, because no progression between them was observed.
          Retracted observations are hidden from the chart but listed below. ${staged < 2 ? 'More observations will make comparisons more informative.' : ''}</p>
        ${conflicts.length
          ? html`<p class="alert alert-info">${conflicts.length === 1 ? 'Two observations' : `${conflicts.length} pairs of observations`} within an hour of each other record different stages
              (${conflicts.map(([a, b]) => `HH${a.observedStage} vs HH${b.observedStage}`).join('; ')}). Both are shown as recorded.</p>`
          : ''}`}
    ${obs.length
      ? html`<div class="table-wrap"><table class="table obs-table">
          <caption class="sr-only">All observations for this batch, including retracted ones</caption>
          <thead><tr><th scope="col">Observed at</th><th scope="col">Incubation (calc.)</th><th scope="col">Estimate then</th><th scope="col">Answer</th><th scope="col">Observed stage</th><th scope="col">Note</th><th scope="col">Status</th></tr></thead>
          <tbody>${obs.map((o) => {
            const x = retractionFor(r, o.id);
            return html`<tr class="${x ? 'is-retracted' : ''}">
              <td data-label="Observed at">${formatDateTime(Date.parse(o.observedAt), r.timeZone)}</td>
              <td data-label="Incubation (calc.)">${formatAgeRange(o.ageRangeMinutes ?? [o.ageMinutes, o.ageMinutes])}</td>
              <td data-label="Estimate then"><span title="Reference version ${o.estimate.referenceVersion}">${o.estimate.label}</span> <span class="est-tag">estimate</span></td>
              <td data-label="Answer" title="${VERDICT_LABEL[o.verdict]}">${ANSWER_SHORT[o.verdict]}</td>
              <td data-label="Observed stage">${o.observedStage === null ? '—' : html`<strong>HH${o.observedStage}</strong>`}${o.temperature ? html`<div class="muted small">${formatTemperature(o.temperature)}</div>` : ''}</td>
              <td data-label="Note" class="pre">${o.note || '—'}</td>
              <td data-label="Status">${x
                ? html`<span class="badge badge-cancelled">Retracted</span><div class="small muted">${formatDateTime(Date.parse(x.at), r.timeZone)}: ${x.reason}</div>`
                : html`<span class="small">Active</span> <button type="button" class="link small" data-action="retract" data-uid="${r.uid}" data-obs="${o.id}" aria-label="Retract observation from ${formatDateTime(Date.parse(o.observedAt), r.timeZone)}">Retract…</button>`}</td>
            </tr>`;
          })}</tbody>
        </table></div>`
      : ''}
  </section>`;
}

function stagePlanBlock(r) {
  const p = r.stagePlan;
  const w = windowOf(r);
  return html`<div class="stage-plan">
    <p><strong>${p.start === 'fresh' ? 'Freshly set eggs (0 h)' : p.currentStage ? `HH${p.currentStage}` : formatHoursRange(p.baselineAgeHours)}</strong> → <strong>HH${p.targetStage}</strong>
      <span class="est-tag">estimate</span></p>
    <dl class="kv">
      <dt>Starting point</dt><dd>${BASIS_LABEL[p.currentStageBasis] ?? p.currentStageBasis}</dd>
      <dt>Starting age</dt><dd>${formatHoursRange(p.baselineAgeHours)}</dd>
      <dt>Target reference age</dt><dd>HH${p.targetStage}: ${formatHoursRange(p.targetAgeHours)}</dd>
      <dt>Estimated wait</dt><dd>${formatHoursRange(p.windowHours)}${p.rangesOverlap ? ' (ranges overlap)' : ''}</dd>
      <dt>Estimated window</dt><dd>${formatWindow(w, r.timeZone)}</dd>
      <dt>Planned return</dt><dd>${PLANNED_RETURN[p.plannedReturn]}</dd>
      ${p.convertedFrom
        ? html`<dt>Converted</dt><dd>${formatDateTime(Date.parse(p.convertedFrom.at), r.timeZone)} from an entered wait (target was ${formatDateTime(Date.parse(p.convertedFrom.targetAt), r.timeZone)})</dd>`
        : ''}
    </dl>
  </div>`;
}
