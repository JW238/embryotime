// Create / edit / duplicate experiment form with a live target calculation.

import { html, mount, toast } from '../dom.js';
import { celebrateSaved } from '../celebrate.js';
import { countdown, emptyState, targetDisplay } from '../components.js';
import {
  EGG_COUNT_MAX,
  EGG_COUNT_MIN,
  EGG_COUNT_PRESETS,
  REMINDER_PRESETS,
  calendarState,
  createExperiment,
  duplicateToInput,
  eggsAccountedFor,
  emptyInput,
  formatReminder,
  nextExperimentId,
  recordToInput,
  updateExperiment,
  validateExperimentInput,
} from '../../experiment.js';
import {
  calculateTargetMs,
  clockShiftMinutes,
  formatDateTime,
  formatDuration,
  formatDurationDays,
  formatUtcOffset,
  getTimeZoneOffsetMinutes,
  instantToWallInputs,
  listTimeZones,
  parseDuration,
  projectedTotalIncubationMinutes,
  zoneAbbreviation,
  zonedWallTimeToInstant,
} from '../../time.js';

const WAIT_PRESETS = [6, 12, 24, 36, 48];

// Which error key each input belongs to.
const ERROR_KEY = {
  experimentId: 'experimentId',
  name: 'name',
  batchId: 'batchId',
  eggCount: 'eggCount',
  currentHours: 'currentIncubation',
  currentMinutes: 'currentIncubation',
  placementDate: 'placement',
  placementTime: 'placement',
  timeZone: 'timeZone',
  waitHours: 'wait',
  waitMinutes: 'wait',
  reminder: 'reminders',
  customReminders: 'reminders',
  notes: 'notes',
  conditions: 'conditions',
};
// First focusable input for each error key (for the error summary links).
const FOCUS_FOR = {
  experimentId: 'f-experimentId',
  name: 'f-name',
  batchId: 'f-batchId',
  eggCount: 'f-eggCount',
  currentIncubation: 'f-currentHours',
  placement: 'f-placementDate',
  timeZone: 'f-timeZone',
  wait: 'f-waitHours',
  reminders: 'f-customReminders',
  notes: 'f-notes',
  conditions: 'f-conditions',
};

const err = (key) => html`<p class="field-error" id="err-${key}" hidden></p>`;

export function renderForm(container, ctx, { mode, uid, from }) {
  const nowMs = ctx.now();
  const record = mode === 'edit' ? ctx.find(uid) : null;
  if (mode === 'edit' && !record) {
    mount(container, emptyState('Experiment not found', 'It may have been deleted.', html`<a class="btn btn-primary" href="#/">Back to hatchery</a>`));
    return;
  }
  const allIds = ctx.experiments.map((r) => r.experimentId);
  const otherIds = ctx.experiments.filter((r) => r.uid !== record?.uid).map((r) => r.experimentId);
  const minEggCount = record ? eggsAccountedFor(record) : 0;
  const newId = () => nextExperimentId(allIds, nowMs, ctx.browserTimeZone);
  const source = from ? ctx.find(from) : null;

  let input;
  if (record) input = recordToInput(record);
  else if (source) input = duplicateToInput(source, { experimentId: newId(), nowMs });
  else input = emptyInput({ experimentId: newId(), timeZone: ctx.browserTimeZone, nowMs });

  const customReminders = input.reminderOffsets.filter((m) => !REMINDER_PRESETS.includes(m)).join(', ');
  const zones = listTimeZones();
  if (!zones.includes(input.timeZone)) zones.unshift(input.timeZone);

  const title = record ? `Edit ${record.experimentId}` : source ? `New batch — copy of ${source.experimentId}` : 'Add a batch of eggs';

  const root = mount(
    container,
    html`<div class="page-head">
      <div>
        <p class="crumbs"><a href="${record ? `#/exp/${record.uid}` : '#/'}">← ${record ? 'Back to experiment' : 'Hatchery'}</a></p>
        <h1>${title}</h1>
      </div>
    </div>
    <div class="alert alert-error" id="error-summary" tabindex="-1" role="alert" hidden></div>
    <form id="exp-form" class="form-layout" novalidate>
      <div class="form-main">
        <section class="card">
          <h2>Identification</h2>
          <div class="grid-2">
            <div class="field">
              <label for="f-experimentId">Experiment ID <span class="req" aria-hidden="true">*</span></label>
              <input id="f-experimentId" name="experimentId" value="${input.experimentId}" required autocomplete="off" spellcheck="false" aria-describedby="err-experimentId hint-experimentId">
              <p class="hint" id="hint-experimentId">Generated automatically; you can change it.</p>
              ${err('experimentId')}
            </div>
            <div class="field">
              <label for="f-batchId">Batch / sample ID</label>
              <input id="f-batchId" name="batchId" value="${input.batchId}" autocomplete="off" aria-describedby="err-batchId">
              ${err('batchId')}
            </div>
          </div>
          <div class="field">
            <label for="f-name">Experiment name <span class="req" aria-hidden="true">*</span></label>
            <input id="f-name" name="name" value="${input.name}" required aria-describedby="err-name">
            ${err('name')}
          </div>
          <fieldset class="field">
            <legend><label for="f-eggCount">Number of eggs</label> <span class="req" aria-hidden="true">*</span></legend>
            <div class="row">
              <input id="f-eggCount" name="eggCount" class="egg-count-input" inputmode="numeric" pattern="[0-9]*" value="${input.eggCount}"
                aria-describedby="hint-eggCount err-eggCount">
              <span class="muted">eggs</span>
              <div class="chips" role="group" aria-label="Egg count presets">
                ${EGG_COUNT_PRESETS.map((n) => html`<button type="button" class="chip" data-eggs="${n}" aria-pressed="${String(String(n) === input.eggCount)}">${n}</button>`)}
              </div>
            </div>
            <p class="hint" id="hint-eggCount">All eggs in this batch share one placement and target time. ${EGG_COUNT_MIN}–${EGG_COUNT_MAX} eggs.${
              record && record.initialEggCount === null ? ' This older batch has no recorded count — enter the actual number.' : ''
            }${minEggCount ? ` ${minEggCount} eggs have already been removed or completed, so the count cannot go below that.` : ''}</p>
            ${err('eggCount')}
          </fieldset>
        </section>

        <section class="card">
          <h2>Timing</h2>
          <div class="field">
            <label for="f-timeZone">Time zone</label>
            <select id="f-timeZone" name="timeZone" aria-describedby="tz-info err-timeZone">
              ${zones.map((z) => html`<option value="${z}" ${z === input.timeZone ? 'selected' : ''}>${z}</option>`)}
            </select>
            <p class="hint tz-info" id="tz-info"></p>
            ${err('timeZone')}
          </div>

          <fieldset class="field">
            <legend>Incubation already completed at placement <span class="req" aria-hidden="true">*</span></legend>
            <p class="hint" id="hint-current">Elapsed incubation of the embryo at the moment it is placed in the incubator (e.g. 48 h). Used only for the projected total — it does not change the target time. Enter 0 if incubation starts at placement.</p>
            <div class="duration-inputs">
              <label><input id="f-currentHours" name="currentHours" inputmode="numeric" pattern="[0-9]*" value="${input.currentHours}" aria-describedby="hint-current err-currentIncubation"> <span>hours</span></label>
              <label><input id="f-currentMinutes" name="currentMinutes" inputmode="numeric" pattern="[0-9]*" value="${input.currentMinutes}" placeholder="0" aria-describedby="hint-current err-currentIncubation"> <span>minutes</span></label>
            </div>
            ${err('currentIncubation')}
          </fieldset>

          <fieldset class="field">
            <legend>Incubator placement date and time <span class="req" aria-hidden="true">*</span></legend>
            <div class="row">
              <label class="sr-only" for="f-placementDate">Placement date</label>
              <input type="date" id="f-placementDate" name="placementDate" value="${input.placementDate}" aria-describedby="err-placement">
              <label class="sr-only" for="f-placementTime">Placement time (24-hour)</label>
              <input type="time" id="f-placementTime" name="placementTime" value="${input.placementTime}" step="60" aria-describedby="err-placement">
              <button type="button" class="btn btn-ghost btn-sm" data-set-now>Use current time</button>
            </div>
            ${err('placement')}
            <div id="occurrence" class="occurrence" hidden></div>
          </fieldset>

          <fieldset class="field">
            <legend>Required waiting duration <span class="req" aria-hidden="true">*</span></legend>
            <p class="hint" id="hint-wait">Time from placement until you need to be back in the lab. May exceed 24 hours.</p>
            <div class="duration-inputs">
              <label><input id="f-waitHours" name="waitHours" inputmode="numeric" pattern="[0-9]*" value="${input.waitHours}" aria-describedby="hint-wait err-wait"> <span>hours</span></label>
              <label><input id="f-waitMinutes" name="waitMinutes" inputmode="numeric" pattern="[0-9]*" value="${input.waitMinutes}" placeholder="0" aria-describedby="hint-wait err-wait"> <span>minutes</span></label>
            </div>
            <div class="chips" role="group" aria-label="Waiting duration presets">
              ${WAIT_PRESETS.map((h) => html`<button type="button" class="chip" data-wait="${h}">${h} h</button>`)}
            </div>
            ${err('wait')}
          </fieldset>
        </section>

        <section class="card">
          <h2>Reminders</h2>
          <fieldset class="field">
            <legend>Calendar alerts before the target time</legend>
            <div class="checks">
              ${REMINDER_PRESETS.map(
                (m) => html`<label class="check"><input type="checkbox" name="reminder" value="${m}" ${input.reminderOffsets.includes(m) ? 'checked' : ''}> ${formatReminder(m)}</label>`
              )}
            </div>
            <label for="f-customReminders" class="sub-label">Other offsets (minutes, comma-separated)</label>
            <input id="f-customReminders" name="customReminders" value="${customReminders}" inputmode="numeric" placeholder="e.g. 45, 90" aria-describedby="hint-reminders err-reminders">
            <p class="hint" id="hint-reminders">Alerts are included in the downloaded .ics file. Whether they fire depends on your calendar app.</p>
            ${err('reminders')}
          </fieldset>
        </section>

        <section class="card">
          <h2>Notes and conditions</h2>
          <div class="field">
            <label for="f-conditions">Experimental conditions (optional)</label>
            <textarea id="f-conditions" name="conditions" rows="2" placeholder="e.g. incubator unit, treatment group, settings you want on record" aria-describedby="err-conditions">${input.conditions}</textarea>
            ${err('conditions')}
          </div>
          <div class="field">
            <label for="f-notes">Notes (optional)</label>
            <textarea id="f-notes" name="notes" rows="3" aria-describedby="err-notes">${input.notes}</textarea>
            ${err('notes')}
          </div>
          ${record
            ? html`<div class="field">
                <label for="f-reason">Reason for change (optional, saved in history)</label>
                <input id="f-reason" name="reason">
              </div>`
            : ''}
        </section>
      </div>

      <aside class="form-side">
        <div class="card preview">
          <h2 class="label">Calculated target</h2>
          <div id="preview-body" aria-live="polite" aria-atomic="true"></div>
          <div id="preview-countdown"></div>
          <ul id="preview-warnings" class="warnings" hidden></ul>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-block">${record ? 'Save changes' : 'Save experiment'}</button>
            <a class="btn btn-ghost btn-block" href="${record ? `#/exp/${record.uid}` : '#/'}">Cancel</a>
          </div>
        </div>
      </aside>
    </form>`
  );

  const form = root.querySelector('#exp-form');
  const touched = new Set();
  let showAll = false;

  function readForm() {
    const f = new FormData(form);
    const custom = String(f.get('customReminders') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number);
    return {
      experimentId: f.get('experimentId'),
      name: f.get('name'),
      batchId: f.get('batchId'),
      eggCount: f.get('eggCount'),
      currentHours: f.get('currentHours'),
      currentMinutes: f.get('currentMinutes'),
      placementDate: f.get('placementDate'),
      placementTime: f.get('placementTime'),
      placementOccurrence: f.get('placementOccurrence') || 'first',
      timeZone: f.get('timeZone'),
      waitHours: f.get('waitHours'),
      waitMinutes: f.get('waitMinutes'),
      reminderOffsets: [...f.getAll('reminder').map(Number), ...custom],
      notes: f.get('notes'),
      conditions: f.get('conditions'),
      reason: f.get('reason') ?? '',
    };
  }

  function showErrors(errors) {
    for (const key of Object.keys(FOCUS_FOR)) {
      const el = root.querySelector(`#err-${key}`);
      const msg = showAll || touched.has(key) ? errors[key] : null;
      el.textContent = msg ?? '';
      el.hidden = !msg;
      for (const [name, k] of Object.entries(ERROR_KEY)) {
        if (k !== key) continue;
        form.querySelectorAll(`[name="${name}"]`).forEach((i) => i.setAttribute('aria-invalid', msg ? 'true' : 'false'));
      }
    }
  }

  function renderOccurrence(v, data) {
    const box = root.querySelector('#occurrence');
    const key = v.ambiguousPlacement ? `${data.timeZone}|${v.ambiguousPlacement.join()}` : '';
    if (box.dataset.key === key) return; // unchanged: keep radios (and focus) as they are
    box.dataset.key = key;
    if (!v.ambiguousPlacement) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const [a, b] = v.ambiguousPlacement;
    const tz = data.timeZone;
    const opt = (value, ms) =>
      html`<label class="check"><input type="radio" name="placementOccurrence" value="${value}" ${data.placementOccurrence === value ? 'checked' : ''}>
        ${value === 'first' ? 'First' : 'Second'} occurrence — ${zoneAbbreviation(ms, tz)} (${formatUtcOffset(getTimeZoneOffsetMinutes(ms, tz))})</label>`;
    box.innerHTML = String(html`<p class="alert alert-warn">This local time occurs twice on this date because clocks fall back. Which one did you mean?</p>${opt('first', a)}${opt('second', b)}`);
    box.hidden = false;
  }

  function renderPreview(data) {
    const body = root.querySelector('#preview-body');
    const cd = root.querySelector('#preview-countdown');
    const tz = data.timeZone;
    const placed = zonedWallTimeToInstant(data.placementDate, data.placementTime, tz);
    const wait = parseDuration(data.waitHours, data.waitMinutes);
    const current = parseDuration(data.currentHours, data.currentMinutes, { allowZero: true });

    const offsetNow = getTimeZoneOffsetMinutes(ctx.now(), tz);
    root.querySelector('#tz-info').textContent = `All times on this form are interpreted in ${tz} (currently ${zoneAbbreviation(ctx.now(), tz)}, ${formatUtcOffset(offsetNow)}).${
      tz !== ctx.browserTimeZone ? ` Note: your computer is set to ${ctx.browserTimeZone}.` : ''
    }`;

    if (!placed.ok || !wait.ok) {
      body.innerHTML = String(
        placed.code === 'nonexistent'
          ? html`<p class="alert alert-warn">${placed.error}</p>`
          : html`<p class="muted">Enter a valid placement date/time and waiting duration to see the target time.</p>`
      );
      cd.innerHTML = '';
      return;
    }
    const placementMs = placed.ambiguous && data.placementOccurrence === 'second' ? placed.alternatives[1] : placed.instantMs;
    const targetMs = calculateTargetMs(placementMs, wait.minutes);
    const targetIso = new Date(targetMs).toISOString();
    const shift = clockShiftMinutes(placementMs, targetMs, tz);
    const total = current.ok ? projectedTotalIncubationMinutes(current.minutes, wait.minutes) : null;

    body.innerHTML = String(html`
      ${targetDisplay(targetIso, tz, { large: true })}
      <p class="calc-line">${formatDateTime(placementMs, tz)}<br>+ ${formatDuration(wait.minutes)} waiting${wait.minutes >= 1440 ? ` (${formatDurationDays(wait.minutes)})` : ''}</p>
      ${shift !== 0
        ? html`<p class="alert alert-info">Clocks change during this interval. Elapsed time is exactly ${formatDuration(wait.minutes)}; the wall clock will appear to move ${formatDuration(wait.minutes + shift)}.</p>`
        : ''}
      ${tz !== ctx.browserTimeZone ? html`<p class="hint">In your computer's zone: ${formatDateTime(targetMs, ctx.browserTimeZone)}</p>` : ''}
      <dl class="kv">
        <dt>Projected total incubation at target</dt>
        <dd>${total === null
          ? html`<span class="muted">Enter incubation at placement</span>`
          : html`${formatDuration(current.minutes)} + ${formatDuration(wait.minutes)} = <strong>${formatDuration(total)}</strong>${total >= 1440 ? ` (${formatDurationDays(total)})` : ''}`}</dd>
      </dl>
      <p class="hint">Assumes incubation continues uninterrupted from placement. Calculated time only; not a prediction of developmental stage.</p>
      ${record && record.originalTargetAt !== targetIso
        ? html`<p class="hint">Original planned target: ${formatDateTime(Date.parse(record.originalTargetAt), record.timeZone)}</p>`
        : ''}`);
    cd.innerHTML = String(html`<div class="label">Time remaining</div>${countdown({ status: 'active', targetAt: targetIso }, ctx.now())}`);
  }

  function update() {
    const data = readForm();
    const v = validateExperimentInput(data, { existingIds: otherIds, nowMs: ctx.now(), minEggCount });
    root.querySelectorAll('[data-eggs]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.eggs === String(data.eggCount).trim())));
    renderOccurrence(v, data);
    showErrors(v.errors);
    renderPreview(data);
    const warnEl = root.querySelector('#preview-warnings');
    warnEl.innerHTML = v.ok ? v.warnings.map((w) => String(html`<li>${w}</li>`)).join('') : '';
    warnEl.hidden = !(v.ok && v.warnings.length);
    return { v, data };
  }

  function showSummary(errors) {
    const summary = root.querySelector('#error-summary');
    const entries = Object.entries(errors);
    if (!entries.length) {
      summary.hidden = true;
      return;
    }
    summary.innerHTML = String(html`<strong>Please fix ${entries.length} ${entries.length === 1 ? 'problem' : 'problems'}:</strong>
      <ul>${entries.map(([k, m]) => html`<li><button type="button" class="link" data-focus="${FOCUS_FOR[k]}">${m}</button></li>`)}</ul>`);
    summary.hidden = false;
    summary.focus();
  }

  form.addEventListener('input', () => update());
  form.addEventListener('change', () => update());
  form.addEventListener('focusout', (e) => {
    const key = ERROR_KEY[e.target.name];
    if (key && !touched.has(key)) {
      touched.add(key);
      update();
    }
  });
  root.addEventListener('click', (e) => {
    const focusBtn = e.target.closest('[data-focus]');
    if (focusBtn) root.querySelector(`#${focusBtn.dataset.focus}`)?.focus();
    const eggBtn = e.target.closest('[data-eggs]');
    if (eggBtn) {
      form.eggCount.value = eggBtn.dataset.eggs;
      touched.add('eggCount');
      update();
    }
    const waitBtn = e.target.closest('[data-wait]');
    if (waitBtn) {
      form.waitHours.value = waitBtn.dataset.wait;
      form.waitMinutes.value = '';
      touched.add('wait');
      update();
    }
    if (e.target.closest('[data-set-now]')) {
      const n = instantToWallInputs(ctx.now(), form.timeZone.value);
      form.placementDate.value = n.date;
      form.placementTime.value = n.time;
      touched.add('placement');
      update();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showAll = true;
    const { v, data } = update();
    if (!v.ok) {
      showSummary(v.errors);
      return;
    }
    root.querySelector('#error-summary').hidden = true;
    const now = ctx.now();
    try {
      if (record) {
        const updated = updateExperiment(record, v.value, { nowMs: now, reason: data.reason });
        if (updated === record) {
          toast('No changes to save.');
        } else {
          await ctx.save(updated);
          toast(
            calendarState(updated) === 'outdated'
              ? 'Saved. The target changed — download the updated calendar file and remove the old event.'
              : 'Changes saved.',
            calendarState(updated) === 'outdated' ? 'warn' : 'info'
          );
        }
        ctx.navigate(`#/exp/${record.uid}`);
      } else {
        const created = createExperiment(v.value, { nowMs: now });
        await ctx.save(created);
        toast(`${created.experimentId} saved.`);
        celebrateSaved(`${created.experimentId}: ${created.initialEggCount} eggs added`);
        ctx.navigate(`#/?laid=${encodeURIComponent(created.uid)}`);
      }
    } catch (error) {
      toast(error.message || 'Could not save the experiment.', 'error');
    }
  });

  update();
  return { tickRerender: false };
}
