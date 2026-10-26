// Experiment actions shared by every view (calendar export, complete, cancel, ...).

import { html, downloadFile, toast } from './dom.js';
import {
  VERDICTS,
  addObservation,
  adjustEggCount,
  estimateStageAt,
  cancelExperiment,
  completeExperiment,
  eggCounts,
  validateObservation,
  markCalendarExported,
  reopenExperiment,
} from '../experiment.js';
import { buildIcs, icsFileName } from '../ics.js';
import { buildDemoExperiments } from '../demo.js';
import { celebrateBadge, celebrateHatch } from './celebrate.js';
import { attachWheels, getWheelValue, stageReference, stageWheel } from './wheel.js';
import { ESTIMATE_METHOD_TEXT, HH_MAX, HH_MIN } from '../hh-stages.js';
import { countObservations, createBadgeStore, syncUnlocks } from '../badges.js';
import { formatDateTime, formatDuration, instantToWallInputs, zonedWallTimeToInstant } from '../time.js';

const ACTIONS = new Set(['ics', 'complete', 'cancel', 'reopen', 'duplicate', 'delete', 'eggs-remove', 'eggs-complete', 'observe']);

export function bindActions(root, ctx) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el) || !ACTIONS.has(el.dataset.action)) return;
    e.preventDefault();
    handleAction(el.dataset.action, el.dataset.uid, ctx);
  });
}

export async function handleAction(action, uid, ctx) {
  const record = ctx.find(uid);
  if (!record) {
    toast('That experiment no longer exists.', 'error');
    return;
  }
  try {
    switch (action) {
      case 'ics': {
        const nowMs = ctx.now();
        const updated = markCalendarExported(record, { nowMs });
        downloadFile(icsFileName(record), buildIcs(updated, { nowMs }), 'text/calendar;charset=utf-8');
        await ctx.save(updated);
        toast('Calendar file downloaded. Open it to add the event to your calendar app — EmbryoTime cannot confirm the import.');
        ctx.rerender();
        break;
      }
      case 'complete':
        openCompleteDialog(record, ctx);
        break;
      case 'cancel':
        openCancelDialog(record, ctx);
        break;
      case 'observe':
        openObservationDialog(record, ctx);
        break;
      case 'eggs-remove':
        openEggCountDialog(record, 'removed', ctx);
        break;
      case 'eggs-complete':
        openEggCountDialog(record, 'completed', ctx);
        break;
      case 'reopen':
        await ctx.save(reopenExperiment(record, { nowMs: ctx.now() }));
        toast(`${record.experimentId} reopened.`);
        ctx.rerender();
        break;
      case 'duplicate':
        ctx.navigate(`#/new?from=${encodeURIComponent(uid)}`);
        break;
      case 'delete':
        if (!window.confirm(`Permanently delete ${record.experimentId} and its history from this browser? This cannot be undone.`)) return;
        await ctx.remove(uid);
        toast(`${record.experimentId} deleted.`);
        ctx.navigate('#/');
        break;
    }
  } catch (err) {
    toast(err.message || 'Something went wrong.', 'error');
  }
}

/** Show the shared <dialog>. onSubmit(formData) returns an error string to keep it open. */
export function openDialog(content, onSubmit) {
  const dialog = document.getElementById('dialog');
  dialog.innerHTML = String(content);
  const form = dialog.querySelector('form');
  const errorEl = dialog.querySelector('.dialog-error');
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return; // ignore double submits while saving
    busy = true;
    form.querySelectorAll('[type=submit]').forEach((b) => (b.disabled = true));
    let error;
    try {
      error = await onSubmit(new FormData(form), form);
    } catch (err) {
      error = err.message || 'Something went wrong.';
    }
    busy = false;
    form.querySelectorAll('[type=submit]').forEach((b) => (b.disabled = false));
    if (error) {
      errorEl.textContent = error;
      errorEl.hidden = false;
      return;
    }
    dialog.close();
  });
  dialog.showModal();
  return dialog;
}

function openCompleteDialog(record, ctx) {
  const tz = record.timeZone;
  const now = instantToWallInputs(ctx.now(), tz);
  const dialog = openDialog(
    html`<form class="dialog-form" novalidate>
      <h2>Mark ${record.experimentId} as completed</h2>
      <p class="muted">Planned target: ${formatDateTime(Date.parse(record.targetAt), tz)}</p>
      <fieldset>
        <legend>Actual completion time <span class="muted">(${tz})</span></legend>
        <div class="row">
          <label class="field">Date <input type="date" name="date" value="${now.date}" required></label>
          <label class="field">Time <input type="time" name="time" value="${now.time}" required></label>
          <button type="button" class="btn btn-ghost btn-sm" data-now>Now</button>
        </div>
      </fieldset>
      ${eggCounts(record).known
        ? html`<p class="hint">All ${eggCounts(record).active} remaining active eggs will be counted as completed. To record removed eggs first, use “Remove eggs”.</p>`
        : ''}
      <label class="field">Note (optional)<textarea name="note" rows="2"></textarea></label>
      <p class="dialog-error field-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">Mark completed</button>
      </div>
    </form>`,
    async (data) => {
      const r = zonedWallTimeToInstant(data.get('date'), data.get('time'), tz);
      if (!r.ok) return r.error;
      try {
        const updated = completeExperiment(record, { nowMs: ctx.now(), completedAtMs: r.instantMs, note: data.get('note') });
        await ctx.save(updated);
      } catch (err) {
        return err.message;
      }
      toast(`${record.experimentId} marked as completed.`);
      celebrateHatch(`${record.experimentId} completed`);
      ctx.rerender();
      setTimeout(() => {
        const done = ctx.find(record.uid);
        if (done) openObservationDialog(done, ctx, { afterCompletion: true });
      }, 400);
      return null;
    }
  );
  dialog.querySelector('[data-now]').addEventListener('click', () => {
    const n = instantToWallInputs(ctx.now(), tz);
    dialog.querySelector('[name=date]').value = n.date;
    dialog.querySelector('[name=time]').value = n.time;
  });
}

function openCancelDialog(record, ctx) {
  openDialog(
    html`<form class="dialog-form" novalidate>
      <h2>Cancel ${record.experimentId}?</h2>
      <p class="muted">The record is kept in history with status Cancelled. If you imported a calendar event, delete it in your calendar app.</p>
      <label class="field">Reason (optional)<textarea name="reason" rows="2"></textarea></label>
      <p class="dialog-error field-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" data-close>Keep experiment</button>
        <button type="submit" class="btn btn-danger">Cancel experiment</button>
      </div>
    </form>`,
    async (data) => {
      await ctx.save(cancelExperiment(record, { nowMs: ctx.now(), reason: data.get('reason') }));
      toast(`${record.experimentId} cancelled.`);
      ctx.rerender();
      return null;
    }
  );
}

export async function loadDemoData(ctx) {
  try {
    await ctx.replaceAll([...ctx.experiments, ...buildDemoExperiments(ctx.now(), ctx.browserTimeZone)]);
    toast('Demo data loaded.');
    ctx.rerender();
  } catch (err) {
    toast(err.message, 'error');
  }
}

export async function removeDemoData(ctx) {
  try {
    await ctx.replaceAll(ctx.experiments.filter((r) => !r.demo));
    toast('Demo data removed.');
    ctx.rerender();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** Explicit, audited change to a batch's active egg count. */
function openEggCountDialog(record, kind, ctx) {
  const c = eggCounts(record);
  if (!c.known) {
    toast('Record the number of eggs for this batch first (Edit schedule).', 'warn');
    return;
  }
  const removing = kind === 'removed';
  const dialog = openDialog(
    html`<form class="dialog-form" novalidate>
      <h2>${removing ? 'Remove eggs from' : 'Complete eggs early in'} ${record.experimentId}</h2>
      <p class="muted">${c.active} of ${c.initial} eggs are active. ${removing
        ? 'Removed eggs leave the active count and are kept in the record as removed.'
        : 'Use this when some eggs are taken for their procedure before the batch target. The rest keep the batch schedule.'}</p>
      <label class="field">Number of eggs
        <input name="count" type="number" inputmode="numeric" min="1" max="${c.active}" step="1" value="1" required></label>
      <p class="hint" data-preview></p>
      <label class="field">Reason or note ${removing ? '' : html`<span class="muted">(optional)</span>`}<textarea name="reason" rows="2"></textarea></label>
      <p class="hint">The change is saved with the current time in the batch history.</p>
      <p class="dialog-error field-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">${removing ? 'Remove eggs' : 'Record completed eggs'}</button>
      </div>
    </form>`,
    async (data) => {
      const raw = String(data.get('count') ?? '').trim();
      if (!/^\d+$/.test(raw)) return 'Enter a whole number of eggs.';
      if (removing && !String(data.get('reason') ?? '').trim()) return 'Please give a reason for removing eggs (kept in the audit history).';
      const updated = adjustEggCount(record, { kind, count: Number(raw), reason: data.get('reason'), nowMs: ctx.now() });
      await ctx.save(updated);
      const after = eggCounts(updated).active;
      toast(`${record.experimentId}: ${raw} ${removing ? 'removed' : 'completed'} — ${after} active ${after === 1 ? 'egg' : 'eggs'} left.`);
      ctx.rerender();
      return null;
    }
  );
  const input = dialog.querySelector('[name=count]');
  const preview = dialog.querySelector('[data-preview]');
  const show = () => {
    const n = Number(input.value);
    preview.textContent = Number.isInteger(n) && n >= 1 && n <= c.active ? `Active eggs: ${c.active} → ${c.active - n}` : `Enter 1–${c.active}.`;
  };
  input.addEventListener('input', show);
  show();
}

/** Unlock any earned badges (stored separately from experiment data). */
export function checkBadges(ctx, { announce = true } = {}) {
  const store = createBadgeStore();
  const { state, newly } = syncUnlocks(store.load(), countObservations(ctx.experiments), ctx.now());
  if (!newly.length) return [];
  store.save(state);
  if (announce) newly.forEach((b, i) => setTimeout(() => celebrateBadge(b), 600 + i * 1900));
  return newly;
}

const VERDICT_CHOICES = [
  [VERDICTS.MATCH, 'Yes, it matches.'],
  [VERDICTS.DIFFERENT, 'No, the observed stage is different.'],
  [VERDICTS.UNCONFIRMED, 'Unable to confirm the actual stage yet.'],
];

/** Record an HH stage observation; the predicted stage is snapshotted alongside it. */
export function openObservationDialog(record, ctx, { afterCompletion = false } = {}) {
  const tz = record.timeZone;
  const now = instantToWallInputs(ctx.now(), tz);
  const dialog = openDialog(
    html`<form class="dialog-form obs-form" novalidate>
      <h2>${afterCompletion ? 'Final stage check (optional)' : 'Record a stage observation'}</h2>
      <p class="muted">${record.experimentId} · ${record.name}. One observation describes the batch as a whole.</p>
      <fieldset>
        <legend>Observation time <span class="muted">(${tz})</span></legend>
        <div class="row">
          <label class="field">Date <input type="date" name="date" value="${now.date}" required></label>
          <label class="field">Time <input type="time" name="time" value="${now.time}" required></label>
          <button type="button" class="btn btn-ghost btn-sm" data-now>Now</button>
        </div>
      </fieldset>
      <div class="obs-estimate" data-estimate aria-live="polite"></div>
      <fieldset class="obs-question">
        <legend>Does the observed HH stage match the estimated stage?</legend>
        ${VERDICT_CHOICES.map(([v, label]) => html`<label class="check"><input type="radio" name="verdict" value="${v}" required> ${label}</label>`)}
      </fieldset>
      <div class="obs-stage" data-stage-pick hidden></div>
      <label class="field">Observation note <span class="muted">(optional)</span><textarea name="note" rows="2" maxlength="2000"></textarea></label>
      <p class="hint">Observed stages are saved separately from the estimate. A difference is useful data, not an error.</p>
      <p class="dialog-error field-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" data-close>${afterCompletion ? 'Skip' : 'Cancel'}</button>
        <button type="submit" class="btn btn-primary">Save observation</button>
      </div>
    </form>`,
    async (data) => {
      const at = zonedWallTimeToInstant(data.get('date'), data.get('time'), tz);
      if (!at.ok) return at.error;
      const verdict = data.get('verdict');
      if (!verdict) return 'Choose one of the three answers.';
      const input = { observedAtMs: at.instantMs, verdict, observedStage: pickedStage(verdict, at.instantMs), note: data.get('note') };
      const v = validateObservation(ctx.find(record.uid) ?? record, input, { nowMs: ctx.now() });
      if (!v.ok) return Object.values(v.errors)[0];
      const updated = addObservation(ctx.find(record.uid) ?? record, input, { nowMs: ctx.now() });
      await ctx.save(updated);
      toast('Observation saved.');
      checkBadges(ctx);
      ctx.rerender();
      return null;
    }
  );

  const form = dialog.querySelector('form');
  const estimateEl = dialog.querySelector('[data-estimate]');
  const pick = dialog.querySelector('[data-stage-pick]');
  let estimate = null;

  function observedAt() {
    const r = zonedWallTimeToInstant(form.date.value, form.time.value, tz);
    return r.ok ? r.instantMs : NaN;
  }

  function pickedStage(verdict, atMs) {
    if (verdict === VERDICTS.UNCONFIRMED) return null;
    const est = estimateStageAt(record, atMs);
    if (verdict === VERDICTS.MATCH && est.stages[0] === est.stages[1]) return est.stages[0];
    const w = pick.querySelector('[data-wheel]');
    return w ? getWheelValue(w) : null;
  }

  function renderEstimate() {
    const at = observedAt();
    if (!Number.isFinite(at) || at < Date.parse(record.placementAt)) {
      estimate = null;
      estimateEl.innerHTML = String(html`<p class="muted">Enter an observation time after placement to see the estimate.</p>`);
      return;
    }
    estimate = estimateStageAt(record, at);
    estimateEl.innerHTML = String(html`<div class="label">Estimated stage <span class="est-tag">estimate</span></div>
      <p><strong>${estimate.label}</strong> at ${formatDuration(estimate.ageMinutes)} calculated incubation.
      <span class="hint block">${ESTIMATE_METHOD_TEXT[estimate.method]} Uses the HH reference ages only.</span></p>`);
  }

  function renderPick() {
    const verdict = form.verdict.value;
    const prev = pick.querySelector('[data-wheel]');
    const prevValue = prev ? getWheelValue(prev) : null;
    if (!verdict || verdict === VERDICTS.UNCONFIRMED || !estimate) {
      pick.hidden = true;
      pick.innerHTML = '';
      return;
    }
    const [lo, hi] = estimate.stages;
    let content;
    if (verdict === VERDICTS.MATCH && lo === hi) {
      content = html`<div class="label">Observed stage</div>${stageReference(lo)}`;
    } else if (verdict === VERDICTS.MATCH) {
      const value = prevValue >= lo && prevValue <= hi ? prevValue : lo;
      content = html`<div class="obs-pick"><div><div class="label" id="pick-label">Which stage within ${estimate.label}?</div>
        ${stageWheel({ id: 'obs-stage', from: lo, to: hi, value, describedBy: 'pick-label' })}</div>
        <div data-ref>${stageReference(value)}</div></div>`;
    } else {
      const outside = hi < HH_MAX ? hi + 1 : lo - 1;
      const value = prevValue !== null && (prevValue < lo || prevValue > hi) ? prevValue : outside;
      content = html`<div class="obs-pick"><div><div class="label" id="pick-label">Observed HH stage</div>
        ${stageWheel({ id: 'obs-stage', from: HH_MIN, to: HH_MAX, value, describedBy: 'pick-label' })}</div>
        <div data-ref>${stageReference(value)}</div></div>`;
    }
    pick.innerHTML = String(content);
    pick.hidden = false;
    attachWheels(pick);
    const w = pick.querySelector('[data-wheel]');
    w?.addEventListener('wheelchange', () => {
      pick.querySelector('[data-ref]').innerHTML = String(stageReference(getWheelValue(w)));
    });
  }

  form.addEventListener('change', (e) => {
    if (e.target.name === 'date' || e.target.name === 'time') renderEstimate();
    if (['date', 'time', 'verdict'].includes(e.target.name)) renderPick();
  });
  dialog.querySelector('[data-now]').addEventListener('click', () => {
    const n = instantToWallInputs(ctx.now(), tz);
    form.date.value = n.date;
    form.time.value = n.time;
    renderEstimate();
    renderPick();
  });
  renderEstimate();
}
