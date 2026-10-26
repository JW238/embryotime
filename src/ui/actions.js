// Experiment actions shared by every view (calendar export, complete, cancel, ...).

import { html, downloadFile, toast } from './dom.js';
import {
  adjustEggCount,
  cancelExperiment,
  completeExperiment,
  eggCounts,
  markCalendarExported,
  reopenExperiment,
} from '../experiment.js';
import { buildIcs, icsFileName } from '../ics.js';
import { buildDemoExperiments } from '../demo.js';
import { celebrateHatch } from './celebrate.js';
import { formatDateTime, instantToWallInputs, zonedWallTimeToInstant } from '../time.js';

const ACTIONS = new Set(['ics', 'complete', 'cancel', 'reopen', 'duplicate', 'delete', 'eggs-remove', 'eggs-complete']);

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
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let error;
    try {
      error = await onSubmit(new FormData(form), form);
    } catch (err) {
      error = err.message || 'Something went wrong.';
    }
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
