// Create / edit / duplicate a batch.
// New batches are timed from HH stages (or freshly set eggs) and produce an ESTIMATED window;
// older duration-based batches keep their entered durations when edited.

import { html, mount, toast } from '../dom.js';
import { celebrateSaved } from '../celebrate.js';
import { attachWheels, durationWheels, getWheelValue, stageReference, stageWheel } from '../wheel.js';
import { ESTIMATE_METHOD_TEXT, PLANNED_RETURN, PLANNED_RETURN_HELP, estimateStage, formatHoursRange, planStages } from '../../hh-stages.js';
import { countdown, emptyState, targetDisplay, windowDisplay } from '../components.js';
import {
  EGG_COUNT_MAX,
  EGG_COUNT_MIN,
  EGG_COUNT_PRESETS,
  REMINDER_PRESETS,
  calendarState,
  createExperiment,
  defaultBatchName,
  displayName,
  duplicateToInput,
  eggsAccountedFor,
  emptyInput,
  formatReminder,
  nextExperimentId,
  recordToInput,
  temperatureNotice,
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
  parseDuration,
  projectedTotalIncubationMinutes,
  zoneAbbreviation,
  zonedWallTimeToInstant,
} from '../../time.js';

const WAIT_PRESETS = [6, 12, 24, 36, 48];

// Which error key each named input belongs to.
const ERROR_KEY = {
  experimentId: 'experimentId',
  name: 'name',
  eggCount: 'eggCount',
  currentHours: 'currentIncubation',
  currentMinutes: 'currentIncubation',
  placementDate: 'placement',
  placementTime: 'placement',
  waitHours: 'wait',
  waitMinutes: 'wait',
  reminder: 'reminders',
  customReminders: 'reminders',
  start: 'stages',
  currentStage: 'stages',
  targetStage: 'stages',
  plannedReturn: 'plannedReturn',
  temperatureValue: 'temperature',
  notes: 'notes',
  conditions: 'conditions',
};
// First focusable control for each error key (error-summary links).
const FOCUS_FOR = {
  experimentId: 'f-name',
  name: 'f-name',
  eggCount: 'f-eggCount',
  currentIncubation: 'f-current-d',
  placement: 'f-placementDate',
  stages: 'f-start-fresh',
  plannedReturn: 'f-return-none',
  wait: 'f-wait-d',
  temperature: 'f-temperature',
  reminders: 'f-customReminders',
  notes: 'f-notes',
  conditions: 'f-conditions',
};

const toMinutes = (h, m) => (Number(h) || 0) * 60 + (Number(m) || 0);
const err = (key) => html`<p class="field-error" id="err-${key}" hidden></p>`;

/** Estimated HH stage at placement and at target, for exactly known (entered) durations. */
function stageEstimates(atPlacementMinutes, atTargetMinutes) {
  const a = estimateStage(atPlacementMinutes);
  const b = estimateStage(atTargetMinutes);
  return html`<dl class="kv stage-estimates">
    <dt>Estimated HH stage at placement</dt><dd><strong>${a.label}</strong> <span class="est-tag">estimate</span></dd>
    <dt>Estimated HH stage at target</dt><dd><strong>${b.label}</strong> <span class="est-tag">estimate</span>
      <span class="hint block">${ESTIMATE_METHOD_TEXT[b.method]}</span></dd>
  </dl>`;
}

export function renderForm(container, ctx, { mode, uid, from }) {
  const nowMs = ctx.now();
  const record = mode === 'edit' ? ctx.find(uid) : null;
  if (mode === 'edit' && !record) {
    mount(container, emptyState('Batch not found', 'It may have been deleted.', html`<a class="btn btn-primary" href="#/">Back to hatchery</a>`));
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
  const stageMode = input.timingMode === 'stage';
  // A saved batch keeps its own time zone; new batches use this computer's zone.
  const zoneNote = input.timeZone === ctx.browserTimeZone ? 'Local time.' : `Times for this batch are in ${input.timeZone}, as originally saved.`;
  // Editing never re-creates the setup observation; the basis follows the original choice.
  const originalObserved = record?.stagePlan?.currentStageBasis === 'observed';
  let nameAuto = Boolean(input.nameIsDefault);

  const title = record ? `Edit “${displayName(record)}”` : source ? `New batch — copy of “${displayName(source)}”` : 'Add a batch of eggs';

  const root = mount(
    container,
    html`<div class="page-head">
      <div>
        <p class="crumbs"><a href="${record ? `#/exp/${record.uid}` : '#/'}">← ${record ? 'Back to batch' : 'Hatchery'}</a></p>
        <h1>${title}</h1>
      </div>
    </div>
    <div class="alert alert-error" id="error-summary" tabindex="-1" role="alert" hidden></div>
    <form id="exp-form" class="form-layout" novalidate>
      <div class="form-main">
        <section class="card">
          <h2>Batch</h2>
          <input type="hidden" name="experimentId" value="${input.experimentId}">
          <input type="hidden" name="batchId" value="${input.batchId}">
          <input type="hidden" name="timeZone" value="${input.timeZone}">
          <input type="hidden" name="timingMode" value="${input.timingMode}">
          <div class="field">
            <label for="f-name">Batch name <span class="req" aria-hidden="true">*</span></label>
            <input id="f-name" name="name" value="${input.name}" required autocomplete="off" aria-describedby="hint-name err-name">
            <p class="hint" id="hint-name"></p>
            <button type="button" class="link small" data-reset-name hidden>Use the name generated from the placement time</button>
            ${err('name')}
            ${err('experimentId')}
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
            <p class="hint" id="hint-eggCount">All eggs in this batch share one placement time and schedule. ${EGG_COUNT_MIN}–${EGG_COUNT_MAX} eggs.${
              record && record.initialEggCount === null ? ' This older batch has no recorded count — enter the actual number.' : ''
            }${minEggCount ? ` ${minEggCount} eggs have already been removed or completed, so the count cannot go below that.` : ''}</p>
            ${err('eggCount')}
          </fieldset>
        </section>

        <section class="card">
          <h2>Timing</h2>
          <fieldset class="field">
            <legend>Incubator placement date and time <span class="req" aria-hidden="true">*</span></legend>
            <div class="row">
              <label class="sr-only" for="f-placementDate">Placement date</label>
              <input type="date" id="f-placementDate" name="placementDate" value="${input.placementDate}" aria-describedby="hint-placement err-placement">
              <label class="sr-only" for="f-placementTime">Placement time (24-hour)</label>
              <input type="time" id="f-placementTime" name="placementTime" value="${input.placementTime}" step="60" aria-describedby="hint-placement err-placement">
              <button type="button" class="btn btn-ghost btn-sm" data-set-now>Use current time</button>
            </div>
            <p class="hint" id="hint-placement">${zoneNote}${stageMode ? ' The starting point below describes the embryos at this time.' : ''}</p>
            ${err('placement')}
            <div id="occurrence" class="occurrence" hidden></div>
          </fieldset>

          ${stageMode ? stageFields(input, record, originalObserved) : durationFields(input)}
        </section>

        <section class="card">
          <h2>Conditions and notes</h2>
          <div class="field">
            <label for="f-temperature">Incubation temperature <span class="muted">(optional)</span></label>
            <div class="row">
              <input id="f-temperature" name="temperatureValue" class="temp-input" inputmode="decimal" value="${input.temperatureValue}" placeholder="e.g. 37.5"
                aria-describedby="hint-temperature err-temperature">
              <label class="sr-only" for="f-temperatureUnit">Unit</label>
              <select id="f-temperatureUnit" name="temperatureUnit">
                <option value="C" ${input.temperatureUnit !== 'F' ? 'selected' : ''}>°C</option>
                <option value="F" ${input.temperatureUnit === 'F' ? 'selected' : ''}>°F</option>
              </select>
            </div>
            <p class="hint" id="hint-temperature">Recorded for context only. Stage estimates are never adjusted for temperature: the reference ages come from the original study's conditions, which the UNSW table does not state.</p>
            ${err('temperature')}
          </div>
          <div class="field">
            <label for="f-conditions">Other experimental conditions <span class="muted">(optional)</span></label>
            <textarea id="f-conditions" name="conditions" rows="2" placeholder="e.g. incubator unit, humidity, treatment group" aria-describedby="err-conditions">${input.conditions}</textarea>
            ${err('conditions')}
          </div>
          <div class="field">
            <label for="f-notes">Notes <span class="muted">(optional)</span></label>
            <textarea id="f-notes" name="notes" rows="3" aria-describedby="err-notes">${input.notes}</textarea>
            ${err('notes')}
          </div>
          ${record
            ? html`<div class="field">
                <label for="f-reason">Reason for change <span class="muted">(optional, saved in history)</span></label>
                <input id="f-reason" name="reason">
              </div>`
            : ''}
        </section>

        <section class="card">
          <h2>Calendar alerts <span class="muted small">(optional — off unless you choose)</span></h2>
          <fieldset class="field">
            <legend>Alerts inside the downloaded calendar (.ics) file</legend>
            <p class="hint" id="hint-reminders">Alerts are stored in the .ics file you download. Whether and how they appear depends on your calendar app.
              EmbryoTime itself does not send notifications or emails. ${stageMode ? 'For stage-based batches, alerts are relative to the planned return, or to the window opening if there is no planned return.' : ''}</p>
            <div class="checks">
              ${REMINDER_PRESETS.map(
                (m) => html`<label class="check"><input type="checkbox" name="reminder" value="${m}" ${input.reminderOffsets.includes(m) ? 'checked' : ''}> ${formatReminder(m)}</label>`
              )}
            </div>
            <label for="f-customReminders" class="sub-label">Other offsets (minutes, comma-separated)</label>
            <input id="f-customReminders" name="customReminders" value="${customReminders}" inputmode="numeric" placeholder="e.g. 45, 90" aria-describedby="hint-reminders err-reminders">
            <p class="hint" id="reminder-summary" aria-live="polite"></p>
            ${err('reminders')}
          </fieldset>
        </section>
      </div>

      <aside class="form-side" aria-label="Estimate preview">
        <div class="card preview">
          <h2 class="label">${stageMode ? 'Estimated window' : 'Calculated target'}</h2>
          <div id="preview-body" aria-live="polite" aria-atomic="true"></div>
          <div id="preview-countdown"></div>
          <ul id="preview-warnings" class="warnings" hidden></ul>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-block">${record ? 'Save changes' : 'Save batch'}</button>
            <a class="btn btn-ghost btn-block" href="${record ? `#/exp/${record.uid}` : '#/'}">Cancel</a>
          </div>
        </div>
      </aside>
    </form>`
  );

  const form = root.querySelector('#exp-form');
  attachWheels(root);
  const touched = new Set();
  let showAll = false;

  // ---------- stage wheels ⇄ hidden inputs ----------
  for (const [wheelId, field, refId] of [
    ['f-current-stage', 'currentStage', 'ref-current'],
    ['f-target-stage', 'targetStage', 'ref-target'],
  ]) {
    const w = root.querySelector(`#${wheelId}`);
    if (!w) continue;
    w.addEventListener('wheelchange', () => {
      form[field].value = String(getWheelValue(w));
      root.querySelector(`#${refId}`).innerHTML = String(stageReference(getWheelValue(w)));
      touched.add('stages');
      update();
    });
  }

  // ---------- batch name: generated from placement time until the user edits it ----------
  function generatedName() {
    const r = zonedWallTimeToInstant(form.placementDate.value, form.placementTime.value, input.timeZone);
    return r.ok ? defaultBatchName(r.instantMs, input.timeZone) : null;
  }
  function renderNameHint() {
    root.querySelector('#hint-name').textContent = nameAuto
      ? 'Generated from the placement date and time. It follows the placement time until you edit it.'
      : `Custom name — it will not be changed automatically.${record ? ` Record ID ${record.experimentId}.` : ''}`;
    root.querySelector('[data-reset-name]').hidden = nameAuto || !generatedName();
  }
  form.name.addEventListener('input', () => {
    nameAuto = form.name.value.trim() === generatedName();
    renderNameHint();
  });
  const syncNameToPlacement = () => {
    if (!nameAuto) return;
    const g = generatedName();
    if (g) form.name.value = g;
  };
  form.placementDate.addEventListener('input', syncNameToPlacement);
  form.placementTime.addEventListener('input', syncNameToPlacement);

  function readForm() {
    const f = new FormData(form);
    const custom = String(f.get('customReminders') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number);
    const currentStage = f.get('currentStage') ?? '';
    return {
      experimentId: f.get('experimentId'),
      name: f.get('name'),
      nameIsDefault: nameAuto,
      defaultName: generatedName() ?? '',
      batchId: f.get('batchId'),
      eggCount: f.get('eggCount'),
      currentHours: f.get('currentHours'),
      currentMinutes: f.get('currentMinutes'),
      placementDate: f.get('placementDate'),
      placementTime: f.get('placementTime'),
      placementOccurrence: f.get('placementOccurrence') || 'first',
      timeZone: f.get('timeZone'),
      timingMode: f.get('timingMode'),
      start: f.get('start') ?? '',
      currentStage,
      targetStage: f.get('targetStage') ?? '',
      plannedReturn: f.get('plannedReturn') ?? '',
      stageObserved: record
        ? originalObserved && String(currentStage) === String(record.stagePlan?.currentStage) && f.get('start') === 'stage'
        : f.get('stageObserved') === 'on',
      temperatureValue: f.get('temperatureValue'),
      temperatureUnit: f.get('temperatureUnit'),
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
      if (!el) continue;
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

  function renderStageControls(data) {
    const currentBox = root.querySelector('#current-picker');
    if (!currentBox) return;
    const isStage = data.start === 'stage';
    currentBox.hidden = !isStage;
    root.querySelector('#fresh-note').hidden = data.start !== 'fresh';
    root.querySelector('.stage-arrow').hidden = !isStage;
    for (const k of Object.keys(PLANNED_RETURN)) {
      root.querySelector(`#help-return-${k}`).hidden = data.plannedReturn !== k;
    }
  }

  function renderPreview(data) {
    const body = root.querySelector('#preview-body');
    const cd = root.querySelector('#preview-countdown');
    const tz = data.timeZone;
    const placed = zonedWallTimeToInstant(data.placementDate, data.placementTime, tz);
    if (data.timingMode === 'stage') return renderStagePreview(data, placed, body, cd);

    const wait = parseDuration(data.waitHours, data.waitMinutes);
    const current = parseDuration(data.currentHours, data.currentMinutes, { allowZero: true });
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
      <dl class="kv">
        <dt>Projected total incubation at target</dt>
        <dd>${total === null
          ? html`<span class="muted">Enter incubation at placement</span>`
          : html`${formatDuration(current.minutes)} + ${formatDuration(wait.minutes)} = <strong>${formatDuration(total)}</strong>${total >= 1440 ? ` (${formatDurationDays(total)})` : ''}`}</dd>
      </dl>
      ${total === null ? '' : stageEstimates(current.minutes, total)}
      <p class="hint">Assumes incubation continues uninterrupted from placement. Stage estimates use the HH reference ages only — they are not observations.</p>
      ${record && record.originalTargetAt !== targetIso
        ? html`<p class="hint">Original planned target: ${formatDateTime(Date.parse(record.originalTargetAt), record.timeZone)}</p>`
        : ''}`);
    cd.innerHTML = String(html`<div class="label">Time remaining</div>${countdown({ status: 'active', targetAt: targetIso }, ctx.now())}`);
  }

  function renderStagePreview(data, placed, body, cd) {
    const tz = data.timeZone;
    const p = planStages({
      start: data.start,
      currentStage: data.currentStage === '' ? null : Number(data.currentStage),
      targetStage: data.targetStage === '' ? null : Number(data.targetStage),
      plannedReturn: data.plannedReturn,
      observed: data.stageObserved,
    });
    if (!p.ok) {
      const firstVisit = !showAll && !touched.has('stages') && !touched.has('plannedReturn');
      body.innerHTML = String(
        p.code === 'missing' || p.code === 'start' || firstVisit
          ? html`<div class="preview-empty"><p><strong>No estimate yet.</strong></p>
              <ol class="steps">
                <li class="${data.start ? 'done' : ''}">Choose a starting point</li>
                ${data.start !== 'fresh' ? html`<li class="${data.currentStage !== '' ? 'done' : ''}">Choose the current HH stage</li>` : ''}
                <li class="${data.targetStage !== '' ? 'done' : ''}">Choose the target HH stage</li>
                <li class="${data.plannedReturn ? 'done' : ''}">Decide whether to plan a return time</li>
              </ol>
              ${data.start && p.code !== 'missing' && p.code !== 'start' ? html`<p class="alert alert-warn">${p.error}</p>` : ''}</div>`
          : html`<p class="alert alert-warn"><strong>No estimate.</strong> ${p.error}</p>`
      );
      cd.innerHTML = '';
      return;
    }
    if (!placed.ok) {
      body.innerHTML = String(
        placed.code === 'nonexistent'
          ? html`<p class="alert alert-warn">${placed.error}</p>`
          : html`<p class="muted">Enter a valid placement date and time to see the estimated window.</p>`
      );
      cd.innerHTML = '';
      return;
    }
    const plan = p.plan;
    const placementMs = placed.ambiguous && data.placementOccurrence === 'second' ? placed.alternatives[1] : placed.instantMs;
    const fake = {
      status: 'active',
      timeZone: tz,
      placementAt: new Date(placementMs).toISOString(),
      targetAt: new Date(placementMs).toISOString(),
      stagePlan: plan,
    };
    const base = plan.start === 'fresh' ? 'freshly set eggs (exactly 0 h)' : `HH${plan.currentStage} reference ${formatHoursRange(plan.baselineAgeHours)}`;
    body.innerHTML = String(html`
      ${windowDisplay(fake, { large: true })}
      <dl class="kv est-window">
        <dt>Estimated wait</dt>
        <dd><strong>${formatHoursRange(plan.windowHours)}</strong> after placement</dd>
      </dl>
      <p class="calc-line">HH${plan.targetStage} reference ${formatHoursRange(plan.targetAgeHours)} − starting age (${base})<br>
        earliest ${+(plan.targetAgeHours[0] - plan.baselineAgeHours[1]).toFixed(2)} h${plan.rangesOverlap ? ' → 0 (ranges overlap)' : ''} · latest ${+(plan.targetAgeHours[1] - plan.baselineAgeHours[0]).toFixed(2)} h</p>
      ${plan.rangesOverlap ? html`<p class="alert alert-info">The starting range and the target range overlap, so the target stage could already be present at placement.</p>` : ''}
      <p class="hint">HH stages are defined by morphology and embryos develop at different rates. This window only combines the reference table's listed ranges; it does not capture all biological variation, and the target stage is not guaranteed at any exact time.
        Starting point: <strong>${plan.start === 'fresh' ? 'known age 0 h' : plan.currentStageBasis === 'observed' ? 'stage marked as observed' : 'stage selected, not observed'}</strong>.</p>
      ${record && record.stagePlan && record.originalTargetAt !== fake.targetAt
        ? html`<p class="hint">Original plan created ${formatDateTime(Date.parse(record.createdAt), record.timeZone)}; changes are logged in the batch history.</p>`
        : ''}`);
    cd.innerHTML = String(html`<div class="label">Window status</div>${countdown(fake, ctx.now())}`);
  }

  function renderReminderSummary(data) {
    const offsets = [...new Set(data.reminderOffsets.filter((m) => Number.isInteger(m) && m > 0))].sort((a, b) => b - a);
    root.querySelector('#reminder-summary').textContent = offsets.length
      ? `Chosen: ${offsets.map(formatReminder).join(', ')}.`
      : 'No alerts chosen — the calendar file will contain events without alerts.';
  }

  function update() {
    const data = readForm();
    const v = validateExperimentInput(data, { existingIds: otherIds, nowMs: ctx.now(), minEggCount });
    root.querySelectorAll('[data-eggs]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.eggs === String(data.eggCount).trim())));
    renderOccurrence(v, data);
    renderStageControls(data);
    showErrors(v.errors);
    renderPreview(data);
    renderReminderSummary(data);
    const notice = root.querySelector('#temp-notice');
    if (notice) notice.textContent = '';
    const warnEl = root.querySelector('#preview-warnings');
    const warnings = v.ok ? [...v.warnings] : [];
    if (v.ok && v.value.temperature) warnings.push(temperatureNotice(v.value.temperature));
    warnEl.innerHTML = warnings.map((w) => String(html`<li>${w}</li>`)).join('');
    warnEl.hidden = !warnings.length;
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
  form.addEventListener('change', (e) => {
    if (e.target.name === 'start' || e.target.name === 'plannedReturn') touched.add(ERROR_KEY[e.target.name]);
    update();
  });
  form.addEventListener('focusout', (e) => {
    const key = ERROR_KEY[e.target.name] ?? e.target.dataset?.errorKey;
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
      root.querySelector('[data-duration="wait"]')._setTotalMinutes(Number(waitBtn.dataset.wait) * 60);
      touched.add('wait');
      update();
    }
    if (e.target.closest('[data-set-now]')) {
      const n = instantToWallInputs(ctx.now(), input.timeZone);
      form.placementDate.value = n.date;
      form.placementTime.value = n.time;
      touched.add('placement');
      syncNameToPlacement();
      update();
    }
    if (e.target.closest('[data-reset-name]')) {
      const g = generatedName();
      if (g) {
        form.name.value = g;
        nameAuto = true;
        renderNameHint();
        update();
      }
    }
  });

  let saving = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return;
    showAll = true;
    const { v, data } = update();
    if (!v.ok) {
      showSummary(v.errors);
      return;
    }
    root.querySelector('#error-summary').hidden = true;
    saving = true;
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
              ? 'Saved. The schedule changed — download the updated calendar file and remove the old event.'
              : 'Changes saved.',
            calendarState(updated) === 'outdated' ? 'warn' : 'info'
          );
        }
        ctx.navigate(`#/exp/${record.uid}`);
      } else {
        const created = createExperiment(v.value, { nowMs: now });
        await ctx.save(created);
        toast(`“${displayName(created)}” saved.`);
        celebrateSaved(`${displayName(created)}: ${created.initialEggCount} eggs added`);
        ctx.navigate(`#/?laid=${encodeURIComponent(created.uid)}`);
      }
    } catch (error) {
      toast(error.message || 'Could not save the batch.', 'error');
    } finally {
      saving = false;
    }
  });

  renderNameHint();
  update();
  return { tickRerender: false };
}

function stageFields(input, record, originalObserved) {
  return html`<fieldset class="field start-options">
      <legend>Starting point <span class="req" aria-hidden="true">*</span></legend>
      <label class="check option-card"><input type="radio" id="f-start-fresh" name="start" value="fresh" ${input.start === 'fresh' ? 'checked' : ''}>
        <span><strong>Freshly set eggs — incubation age 0 h</strong>
        <span class="hint block">A known elapsed time, not an observed HH1 stage.</span></span></label>
      <label class="check option-card"><input type="radio" id="f-start-stage" name="start" value="stage" ${input.start === 'stage' ? 'checked' : ''}>
        <span><strong>Embryos at a current HH stage</strong>
        <span class="hint block">Their age is taken as that stage's reference age range.</span></span></label>
    </fieldset>
    <div class="stage-pickers">
      <fieldset class="stage-picker" id="current-picker" ${input.start === 'stage' ? '' : 'hidden'}>
        <legend>Current HH stage</legend>
        ${stageWheel({ id: 'f-current-stage', label: 'Current HH stage', value: input.currentStage, describedBy: 'err-stages', numberInput: true, errorKey: 'stages' })}
        <div class="stage-picker-ref" id="ref-current" aria-live="polite">${stageReference(input.currentStage)}</div>
        ${record
          ? html`<p class="hint">${originalObserved ? 'This stage was recorded as observed at setup (see the observation table).' : 'Selected stage, not an observation. Record observations from the batch page.'}</p>`
          : html`<label class="check observed-check"><input type="checkbox" name="stageObserved" ${input.stageObserved ? 'checked' : ''}>
              I observed this stage (morphologically confirmed) — saves an observation record</label>`}
      </fieldset>
      <p class="fresh-note" id="fresh-note" ${input.start === 'fresh' ? '' : 'hidden'}>Starting from <strong>incubation age 0 h</strong>.</p>
      <div class="stage-arrow" aria-hidden="true" ${input.start === 'stage' ? '' : 'hidden'}>→</div>
      <fieldset class="stage-picker" id="target-picker">
        <legend>Target HH stage</legend>
        ${stageWheel({ id: 'f-target-stage', label: 'Target HH stage', value: input.targetStage, describedBy: 'err-stages', numberInput: true, errorKey: 'stages' })}
        <div class="stage-picker-ref" id="ref-target" aria-live="polite">${stageReference(input.targetStage)}</div>
      </fieldset>
      <input type="hidden" name="currentStage" value="${input.currentStage}">
      <input type="hidden" name="targetStage" value="${input.targetStage}">
    </div>
    ${err('stages')}
    <fieldset class="field planned-return">
      <legend>Planned lab return <span class="req" aria-hidden="true">*</span></legend>
      <p class="hint">The biological estimate is the whole window. Optionally pick one point in it to plan your return — there is no universally best choice.</p>
      ${Object.entries(PLANNED_RETURN).map(
        ([k, label]) => html`<label class="check option-card"><input type="radio" id="f-return-${k}" name="plannedReturn" value="${k}" ${input.plannedReturn === k ? 'checked' : ''}>
          <span><strong>${label}</strong><span class="hint block" id="help-return-${k}" ${input.plannedReturn === k ? '' : 'hidden'}>${PLANNED_RETURN_HELP[k]}</span></span></label>`
      )}
      ${err('plannedReturn')}
    </fieldset>
    <p class="hint source">Reference ages and features: <a href="#/stages">HH stage reference</a> (UNSW Embryology table of Hamburger &amp; Hamilton, 1951).</p>`;
}

function durationFields(input) {
  return html`<p class="alert alert-info">This batch was created with entered durations. They are kept exactly as entered.
      You can switch it to stage-based timing with “Convert to stage-based timing” on the batch page.</p>
    <fieldset class="field">
      <legend>Incubation already completed at placement <span class="req" aria-hidden="true">*</span></legend>
      <p class="hint" id="hint-current">Elapsed incubation at placement. Used only for the projected total.</p>
      ${durationWheels({
        name: 'current',
        label: 'Incubation at placement',
        totalMinutes: toMinutes(input.currentHours, input.currentMinutes),
        errorKey: 'currentIncubation',
        describedBy: 'hint-current err-currentIncubation',
      })}
      ${err('currentIncubation')}
    </fieldset>
    <fieldset class="field">
      <legend>Required waiting duration <span class="req" aria-hidden="true">*</span></legend>
      <p class="hint" id="hint-wait">Time from placement until you need to be back in the lab.</p>
      ${durationWheels({
        name: 'wait',
        label: 'Waiting duration',
        totalMinutes: toMinutes(input.waitHours, input.waitMinutes),
        errorKey: 'wait',
        describedBy: 'hint-wait err-wait',
      })}
      <div class="chips" role="group" aria-label="Waiting duration presets">
        ${WAIT_PRESETS.map((h) => html`<button type="button" class="chip" data-wait="${h}">${h} h</button>`)}
      </div>
      ${err('wait')}
    </fieldset>`;
}
