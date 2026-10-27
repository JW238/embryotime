// Experiment domain model: validation, creation, schedule changes, status.
// Pure functions — every function that depends on "now" takes it as a parameter.

import {
  MS_PER_DAY,
  calculateTargetMs,
  formatDateTime,
  formatDuration,
  instantToWallInputs,
  isValidTimeZone,
  parseDuration,
  projectedTotalIncubationMinutes,
  splitMinutes,
  timeRemaining,
  zonedDateKey,
  zonedWallTimeToInstant,
} from './time.js';
import {
  BASIS_LABEL,
  PLANNED_RETURN,
  estimateStageForRange,
  formatHoursRange,
  getStage,
  isValidStage,
  planStages,
  stageInRange,
  stageRangeLabel,
  windowPlan,
} from './hh-stages.js';

export const SCHEMA_VERSION = 1;

/** Every researcher has one personal coop; records without coopId belong to it. */
export const DEFAULT_COOP_ID = 'personal';

/** One experiment record is a batch of eggs sharing one schedule. */
export const EGG_COUNT_MIN = 10;
export const EGG_COUNT_MAX = 50;
export const DEFAULT_EGG_COUNT = 24;
export const EGG_COUNT_PRESETS = [10, 20, 30, 40, 50];

export const STATUS = Object.freeze({
  PLANNED: 'planned', // placement time is still in the future
  ACTIVE: 'active', // placed, waiting for target time
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

export const STATUS_LABEL = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Reminder offsets offered as checkboxes, in minutes before the target. */
export const REMINDER_PRESETS = [15, 30, 60, 120, 1440];
// Calendar alerts are opt-in: nothing is pre-selected.
export const DEFAULT_REMINDERS = [];
export const MAX_REMINDER_MINUTES = 7 * 1440;

export function formatReminder(minutes) {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'} before`;
  if (minutes % 60 === 0) return `${minutes / 60} h before`;
  return `${minutes} min before`;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

/** Next free ID of the form EXP-YYYYMMDD-NNN (date in the given zone). */
export function nextExperimentId(existingIds, nowMs, timeZone) {
  const prefix = `EXP-${zonedDateKey(nowMs, timeZone).replaceAll('-', '')}-`;
  const taken = new Set(existingIds);
  for (let n = 1; n < 10_000; n++) {
    const id = `${prefix}${String(n).padStart(3, '0')}`;
    if (!taken.has(id)) return id;
  }
  throw new Error('Could not generate a free experiment ID');
}

export function newUid() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Default batch name from the local date and time, e.g. "October 26, 2026 — 8:15 PM". */
export function defaultBatchName(nowMs, timeZone) {
  const date = new Intl.DateTimeFormat('en-US', { timeZone, month: 'long', day: 'numeric', year: 'numeric' }).format(nowMs);
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(nowMs);
  return `${date} — ${time}`;
}

/** Visible title of a batch: its name, or the record ID for older records without one. */
export function displayName(record) {
  return String(record?.name ?? '').trim() || record?.experimentId || 'Unnamed batch';
}

// ---------- temperature ----------
// Recorded for context only. EmbryoTime never adjusts stage estimates for temperature:
// there is no validated correction model in this app. The UNSW reference page does not state
// the incubation conditions behind its ages, so no numeric "outside reference" threshold is
// applied unless one is configured here from a reliable source.
export const REFERENCE_TEMPERATURE_C = null; // e.g. { min: …, max: …, source: '…' } — leave null unless sourced
const TEMP_SANITY_C = [0, 60]; // rejects obvious typos only

export function toCelsius({ value, unit }) {
  return unit === 'F' ? ((value - 32) * 5) / 9 : value;
}

/** Parse optional temperature input. Returns { ok, temperature: {value, unit}|null } or { ok:false, error }. */
export function parseTemperature(valueStr, unit) {
  const raw = String(valueStr ?? '').trim();
  if (!raw) return { ok: true, temperature: null };
  if (unit !== 'C' && unit !== 'F') return { ok: false, error: 'Choose °C or °F.' };
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return { ok: false, error: 'Temperature must be a number, e.g. 37.5.' };
  const value = Number(raw);
  const c = toCelsius({ value, unit });
  if (c < TEMP_SANITY_C[0] || c > TEMP_SANITY_C[1]) {
    return { ok: false, error: `That temperature (${raw} °${unit}) looks like a typo. Enter the incubator setting.` };
  }
  return { ok: true, temperature: { value, unit } };
}

export function formatTemperature(t) {
  return t ? `${t.value} °${t.unit}` : '—';
}

/** Note shown wherever a temperature is displayed. Never alters an estimate. */
export function temperatureNotice(t) {
  if (!t) return null;
  const ref = REFERENCE_TEMPERATURE_C;
  if (ref && (toCelsius(t) < ref.min || toCelsius(t) > ref.max)) {
    return `Recorded temperature is outside the configured reference conditions (${ref.min}–${ref.max} °C, ${ref.source}). Stage estimates are not adjusted.`;
  }
  return 'Stage estimates are not adjusted for temperature; the reference ages assume the conditions of the original study.';
}

// ---------- validation ----------

export function parseEggCount(value) {
  const s = String(value ?? '').trim();
  if (!s) return { ok: false, error: 'Number of eggs is required.' };
  if (!/^\d+$/.test(s)) return { ok: false, error: 'Number of eggs must be a whole number, e.g. 24.' };
  const count = Number(s);
  if (count < EGG_COUNT_MIN || count > EGG_COUNT_MAX) {
    return { ok: false, error: `Enter between ${EGG_COUNT_MIN} and ${EGG_COUNT_MAX} eggs.` };
  }
  return { ok: true, count };
}

/**
 * Validate raw form input.
 * input: { experimentId, name, batchId, currentHours, currentMinutes, placementDate, placementTime,
 *          timeZone, placementOccurrence ('first'|'second'), waitHours, waitMinutes,
 *          reminderOffsets: number[], notes, conditions }
 * Timing: by default from entered durations (currentHours/Minutes, waitHours/Minutes). With
 *   input.timingMode === 'stage', from { currentStage, targetStage, schedulePoint, stageObserved }:
 *   the durations are derived from the HH reference ranges and value.stagePlan records how.
 * options: { existingIds: string[] (other experiments), nowMs,
 *            minEggCount: eggs already removed/completed from this batch (editing only) }
 * Returns { ok, errors: {field: message}, warnings: string[], value, ambiguousPlacement }
 */
export function validateExperimentInput(input, { existingIds = [], nowMs, minEggCount = 0 } = {}) {
  const errors = {};
  const warnings = [];
  const str = (v) => String(v ?? '').trim();

  const experimentId = str(input.experimentId);
  if (!experimentId) errors.experimentId = 'Experiment ID is required.';
  else if (!ID_PATTERN.test(experimentId)) {
    errors.experimentId = 'Use 1–40 letters, digits, dots, dashes or underscores, starting with a letter or digit.';
  } else if (existingIds.includes(experimentId)) errors.experimentId = `ID "${experimentId}" is already used by another experiment.`;

  const name = str(input.name);
  if (!name) errors.name = 'Batch name is required.';
  else if (name.length > 120) errors.name = 'Name must be 120 characters or fewer.';

  const batchId = str(input.batchId);
  if (batchId.length > 60) errors.batchId = 'Batch/sample ID must be 60 characters or fewer.';

  const eggs = parseEggCount(input.eggCount);
  if (!eggs.ok) errors.eggCount = eggs.error;
  else if (eggs.count < minEggCount) {
    errors.eggCount = `${minEggCount} eggs have already been removed or completed in this batch; the batch cannot have fewer.`;
  }

  let current;
  let wait;
  let stagePlan = null;
  if (input.timingMode === 'stage') {
    const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
    const p = planStages({
      start: input.start,
      currentStage: num(input.currentStage),
      targetStage: num(input.targetStage),
      plannedReturn: input.plannedReturn,
      observed: Boolean(input.stageObserved),
    });
    current = { ok: true, minutes: 0 };
    wait = { ok: true, minutes: 0 };
    if (!p.ok) {
      errors[p.field === 'plannedReturn' ? 'plannedReturn' : 'stages'] = p.error;
      // Report every missing step at once, not only the first.
      if (p.field !== 'plannedReturn' && !Object.hasOwn(PLANNED_RETURN, input.plannedReturn ?? '')) {
        errors.plannedReturn = 'Choose whether to plan a specific return time.';
      }
    } else {
      stagePlan = p.plan;
      // Lower bound of the baseline range; the full range lives in stagePlan.baselineAgeHours.
      current = { ok: true, minutes: Math.round(p.plan.baselineAgeHours[0] * 60) };
      // targetAt = planned return if chosen, otherwise the window start (used for ordering only).
      wait = { ok: true, minutes: p.plan.plannedReturnMinutes ?? Math.round(p.plan.windowHours[0] * 60) };
    }
  } else {
    current = parseDuration(input.currentHours, input.currentMinutes, {
      allowZero: true,
      label: 'Incubation at placement',
    });
    if (!current.ok) errors.currentIncubation = current.error;

    wait = parseDuration(input.waitHours, input.waitMinutes, { label: 'Waiting duration' });
    if (!wait.ok) errors.wait = wait.error;
  }

  const timeZone = str(input.timeZone);
  if (!isValidTimeZone(timeZone)) errors.timeZone = 'Choose a valid time zone.';

  let placementMs = null;
  let ambiguousPlacement = null;
  if (!str(input.placementDate) || !str(input.placementTime)) {
    errors.placement = 'Placement date and time are required.';
  } else if (!errors.timeZone) {
    const r = zonedWallTimeToInstant(input.placementDate, input.placementTime, timeZone);
    if (!r.ok) errors.placement = r.error;
    else {
      placementMs = r.instantMs;
      if (r.ambiguous) {
        ambiguousPlacement = r.alternatives;
        if (input.placementOccurrence === 'second') placementMs = r.alternatives[1];
        warnings.push(
          'The placement time occurs twice on this date because clocks fall back. Confirm which occurrence you mean.'
        );
      }
    }
  }

  const reminderOffsets = [...new Set((input.reminderOffsets ?? []).map(Number))].sort((a, b) => b - a);
  if (reminderOffsets.some((m) => !Number.isInteger(m) || m <= 0 || m > MAX_REMINDER_MINUTES)) {
    errors.reminders = `Reminder offsets must be whole minutes between 1 and ${MAX_REMINDER_MINUTES} (7 days).`;
  }

  const temp = parseTemperature(input.temperatureValue, input.temperatureUnit ?? 'C');
  if (!temp.ok) errors.temperature = temp.error;

  const notes = String(input.notes ?? '').trim();
  const conditions = String(input.conditions ?? '').trim();
  if (notes.length > 5000) errors.notes = 'Notes must be 5000 characters or fewer.';
  if (conditions.length > 2000) errors.conditions = 'Conditions must be 2000 characters or fewer.';

  if (stagePlan?.currentStageBasis === 'observed' && Number.isFinite(nowMs) && placementMs > nowMs + 60_000) {
    errors.stages = 'A stage can only be marked as observed for a placement time that has already happened.';
  }
  if (Object.keys(errors).length) return { ok: false, errors, warnings, ambiguousPlacement };

  const targetMs = calculateTargetMs(placementMs, wait.minutes);
  if (stagePlan?.rangesOverlap) warnings.push('The current and target reference ranges overlap, so the estimated window starts at placement.');
  if (Number.isFinite(nowMs)) {
    if (stagePlan) {
      if (placementMs + stagePlan.windowHours[1] * 3_600_000 <= nowMs) warnings.push('The whole estimated window is already in the past.');
    } else if (targetMs <= nowMs) warnings.push('The calculated target time is already in the past; the experiment will show as overdue.');
    if (placementMs > nowMs + 30 * MS_PER_DAY) warnings.push('Placement time is more than 30 days in the future — check the date.');
    if (placementMs < nowMs - 30 * MS_PER_DAY) warnings.push('Placement time is more than 30 days in the past — check the date.');
  }

  return {
    ok: true,
    errors,
    warnings,
    ambiguousPlacement,
    value: {
      experimentId,
      name,
      batchId,
      initialEggCount: eggs.count,
      currentIncubationMinutes: current.minutes,
      placementAt: new Date(placementMs).toISOString(),
      timeZone,
      waitMinutes: wait.minutes,
      targetAt: new Date(targetMs).toISOString(),
      reminderOffsets,
      notes,
      conditions,
      temperature: temp.temperature,
      nameIsDefault: Boolean(input.nameIsDefault) && name === str(input.defaultName),
      ...(stagePlan ? { stagePlan } : {}),
    },
  };
}

// ---------- records ----------

const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const iso = (n) => new Date(n).toISOString();

export function createExperiment(value, { nowMs, uid = newUid(), demo = false }) {
  const now = iso(nowMs);
  const record = {
    schemaVersion: SCHEMA_VERSION,
    uid,
    coopId: DEFAULT_COOP_ID,
    ...value,
    eggAdjustments: [],
    observations: [],
    retractions: [],
    originalTargetAt: value.targetAt,
    status: ms(value.placementAt) > nowMs ? STATUS.PLANNED : STATUS.ACTIVE,
    completedAt: null,
    completionNote: '',
    cancelledAt: null,
    cancelReason: '',
    calendar: { exportedAt: null, exportedTargetAt: null, sequence: 0 },
    demo,
    createdAt: now,
    updatedAt: now,
    history: [],
  };
  record.history.push({
    at: now,
    action: 'created',
    summary: value.stagePlan
      ? `Created with ${value.initialEggCount} eggs: ${planSummary(value.stagePlan)}, estimated window ${formatWindow(windowOf(value), value.timeZone)}`
      : `Created with ${value.initialEggCount} eggs, target ${formatDateTime(ms(value.targetAt), value.timeZone)}`,
  });
  // A stage the researcher says they observed at setup becomes a real observation record.
  if (value.stagePlan?.currentStageBasis === 'observed') {
    return addObservation(
      record,
      { observedAtMs: ms(value.placementAt), verdict: VERDICTS.BASELINE, observedStage: value.stagePlan.currentStage, note: 'Observed when the batch was set up', source: 'setup' },
      { nowMs, id: `${uid}-setup` }
    );
  }
  return record;
}

const TRACKED_FIELDS = [
  ['experimentId', 'Experiment ID'],
  ['name', 'Name'],
  ['batchId', 'Batch/sample ID'],
  ['initialEggCount', 'Number of eggs'],
  ['currentIncubationMinutes', 'Incubation at placement'],
  ['placementAt', 'Placement time'],
  ['timeZone', 'Time zone'],
  ['waitMinutes', 'Waiting duration'],
  ['targetAt', 'Target time'],
  ['stagePlan', 'Stage plan'],
  ['temperature', 'Incubation temperature'],
  ['reminderOffsets', 'Reminders'],
  ['notes', 'Notes'],
  ['conditions', 'Conditions'],
];

function describeValue(field, value, timeZone) {
  if (value == null || value === '') return field === 'initialEggCount' ? 'not recorded' : '—';
  if (field === 'placementAt' || field === 'targetAt') return formatDateTime(ms(value), timeZone);
  if (field === 'currentIncubationMinutes' || field === 'waitMinutes') return formatDuration(value);
  if (field === 'stagePlan') return `${planSummary(value)}; planned return: ${PLANNED_RETURN[value.plannedReturn].toLowerCase()}`;
  if (field === 'temperature') return formatTemperature(value);
  if (field === 'reminderOffsets') return value.length ? value.map(formatReminder).join(', ') : 'none';
  const s = String(value);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

/** Apply validated form values to an existing record. Keeps originalTargetAt; logs a diff. */
export function updateExperiment(record, value, { nowMs, reason = '' }) {
  const changes = [];
  for (const [field, label] of TRACKED_FIELDS) {
    if (JSON.stringify(record[field]) !== JSON.stringify(value[field])) {
      changes.push({
        field,
        label,
        from: describeValue(field, record[field], record.timeZone),
        to: describeValue(field, value[field], value.timeZone),
      });
    }
  }
  if (changes.length === 0) return record;

  const now = iso(nowMs);
  const scheduleChanged = changes.some((c) => c.field === 'targetAt');
  const next = { ...record, ...value, updatedAt: now };
  if (next.status === STATUS.PLANNED || next.status === STATUS.ACTIVE) {
    next.status = ms(next.placementAt) > nowMs ? STATUS.PLANNED : STATUS.ACTIVE;
  }
  next.history = [
    ...record.history,
    {
      at: now,
      action: scheduleChanged ? 'schedule-changed' : 'details-edited',
      summary: scheduleChanged
        ? `Target moved from ${describeValue('targetAt', record.targetAt, record.timeZone)} to ${describeValue('targetAt', value.targetAt, value.timeZone)}`
        : `Edited ${changes.map((c) => c.label.toLowerCase()).join(', ')}`,
      reason: String(reason).trim(),
      changes,
    },
  ];
  return next;
}

export function completeExperiment(record, { nowMs, completedAtMs = nowMs, note = '' }) {
  if (!Number.isFinite(completedAtMs)) throw new RangeError('Invalid completion time');
  if (completedAtMs > nowMs + 60_000) throw new RangeError('Completion time cannot be in the future.');
  if (completedAtMs < ms(record.placementAt)) throw new RangeError('Completion time cannot be before the placement time.');
  const now = iso(nowMs);
  const delta = completedAtMs - ms(record.targetAt);
  const eggs = eggCounts(record);
  const eggNote = eggs.known ? `; ${eggs.active} remaining egg${eggs.active === 1 ? '' : 's'} counted as completed` : '';
  return {
    ...record,
    status: STATUS.COMPLETED,
    completedAt: iso(completedAtMs),
    completionNote: String(note).trim(),
    updatedAt: now,
    history: [
      ...record.history,
      {
        at: now,
        action: 'completed',
        summary: `Completed at ${formatDateTime(completedAtMs, record.timeZone)} (${describeDelta(delta)})${eggNote}`,
        reason: String(note).trim(),
      },
    ],
  };
}

export function cancelExperiment(record, { nowMs, reason = '' }) {
  const now = iso(nowMs);
  return {
    ...record,
    status: STATUS.CANCELLED,
    cancelledAt: now,
    cancelReason: String(reason).trim(),
    updatedAt: now,
    history: [...record.history, { at: now, action: 'cancelled', summary: 'Cancelled', reason: String(reason).trim() }],
  };
}

export function reopenExperiment(record, { nowMs }) {
  const now = iso(nowMs);
  return {
    ...record,
    status: ms(record.placementAt) > nowMs ? STATUS.PLANNED : STATUS.ACTIVE,
    completedAt: null,
    completionNote: '',
    cancelledAt: null,
    cancelReason: '',
    updatedAt: now,
    history: [...record.history, { at: now, action: 'reopened', summary: `Reopened (was ${STATUS_LABEL[record.status]})` }],
  };
}

export function markCalendarExported(record, { nowMs }) {
  const now = iso(nowMs);
  return {
    ...record,
    calendar: {
      exportedAt: now,
      exportedTargetAt: record.targetAt,
      exportedSignature: scheduleSignature(record),
      sequence: (record.calendar?.sequence ?? 0) + 1,
    },
    updatedAt: now,
    history: [
      ...record.history,
      { at: now, action: 'calendar-exported', summary: 'Calendar file (.ics) downloaded — import not confirmed' },
    ],
  };
}

// ---------- eggs within a batch ----------

/**
 * Bring older records up to the current shape. Records saved before egg counts existed get
 * initialEggCount: null ("not recorded") — never an invented number.
 */
export function normalizeRecord(r) {
  return {
    ...r,
    initialEggCount: Number.isInteger(r.initialEggCount) ? r.initialEggCount : null,
    eggAdjustments: Array.isArray(r.eggAdjustments) ? r.eggAdjustments : [],
    observations: Array.isArray(r.observations) ? r.observations : [],
    retractions: Array.isArray(r.retractions) ? r.retractions : [],
    temperature: r.temperature ?? null,
    ...(r.stagePlan ? { stagePlan: normalizeStagePlan(r.stagePlan) } : {}),
  };
}

/** Plans saved by the unreleased first stage-based form (v1) are mapped onto v2 fields. */
function normalizeStagePlan(p) {
  if (p.version === 2) return p;
  return {
    version: 2,
    start: 'stage',
    currentStage: p.currentStage,
    currentStageBasis: p.currentStageBasis ?? 'selected',
    baselineAgeHours: p.baselineAgeHours ?? p.currentAgeHours,
    targetStage: p.targetStage,
    targetAgeHours: p.targetAgeHours,
    windowHours: p.windowHours ?? p.waitHours,
    rangesOverlap: Boolean(p.rangesOverlap),
    plannedReturn: p.plannedReturn ?? p.schedulePoint ?? 'none',
    plannedReturnMinutes: p.plannedReturnMinutes ?? p.scheduledWaitMinutes ?? null,
    referenceVersion: p.referenceVersion,
  };
}

/** "Freshly set eggs → HH12" / "HH10 (selected) → HH12". */
export function planSummary(p) {
  const from = p.start === 'fresh' ? 'freshly set eggs (0 h)' : p.currentStage ? `HH${p.currentStage} (${p.currentStageBasis})` : `${formatHoursRange(p.baselineAgeHours)} incubation (${p.currentStageBasis})`;
  return `${from} → HH${p.targetStage}`;
}

/**
 * Egg counts derived from the initial count, explicit adjustments and the batch status.
 * Eggs are counted, not tracked individually: every egg shares the batch's schedule.
 * Invariant (when known): active + completed + removed + cancelled === initial.
 */
export function eggCounts(record) {
  const initial = Number.isInteger(record.initialEggCount) ? record.initialEggCount : null;
  if (initial === null) return { known: false, initial: null, active: null, completed: null, removed: null, cancelled: null };
  const sum = (kind) => (record.eggAdjustments ?? []).filter((a) => a.kind === kind).reduce((n, a) => n + a.count, 0);
  const removed = sum('removed');
  const separatelyCompleted = sum('completed');
  const remaining = Math.max(0, initial - removed - separatelyCompleted);
  if (record.status === STATUS.COMPLETED) {
    return { known: true, initial, active: 0, completed: separatelyCompleted + remaining, removed, cancelled: 0 };
  }
  if (record.status === STATUS.CANCELLED) {
    return { known: true, initial, active: 0, completed: separatelyCompleted, removed, cancelled: remaining };
  }
  return { known: true, initial, active: remaining, completed: separatelyCompleted, removed, cancelled: 0 };
}

/** Eggs already taken out of the active count (minimum allowed initial count when editing). */
export function eggsAccountedFor(record) {
  const c = eggCounts(record);
  return c.known ? c.removed + c.completed : 0;
}

export const EGG_ADJUSTMENT_LABEL = { removed: 'Removed', completed: 'Completed early' };

/** Explicit, audited change to the active egg count: kind is 'removed' or 'completed'. */
export function adjustEggCount(record, { kind, count, reason = '', nowMs }) {
  if (!isOpen(record)) throw new Error('Egg counts can only change while the batch is open.');
  if (kind !== 'removed' && kind !== 'completed') throw new Error(`Unknown egg change "${kind}".`);
  const c = eggCounts(record);
  if (!c.known) throw new Error('Record the number of eggs for this batch first (Edit schedule).');
  if (!Number.isInteger(count) || count < 1 || count > c.active) {
    throw new RangeError(c.active ? `Enter a whole number between 1 and ${c.active}.` : 'No active eggs remain in this batch.');
  }
  const now = iso(nowMs);
  const after = c.active - count;
  const noun = `egg${count === 1 ? '' : 's'}`;
  const entry = { at: now, kind, count, reason: String(reason).trim(), activeBefore: c.active, activeAfter: after };
  return {
    ...record,
    eggAdjustments: [...(record.eggAdjustments ?? []), entry],
    updatedAt: now,
    history: [
      ...record.history,
      {
        at: now,
        action: kind === 'removed' ? 'eggs-removed' : 'eggs-completed',
        summary: `${kind === 'removed' ? 'Removed' : 'Completed'} ${count} ${noun} — active eggs ${c.active} → ${after}`,
        reason: entry.reason,
      },
    ],
  };
}

/**
 * Totals across batches. Each batch is counted exactly once; batches without a recorded
 * egg count are excluded from egg totals and reported in unknownEggBatches.
 */
export function batchTotals(records, nowMs) {
  const t = {
    batches: records.length,
    plannedBatches: 0,
    activeBatches: 0,
    completedBatches: 0,
    cancelledBatches: 0,
    overdueBatches: 0,
    eggsInitial: 0,
    eggsActive: 0, // in placed (Active) batches
    eggsPlanned: 0, // in batches not yet placed
    eggsCompleted: 0,
    eggsRemoved: 0,
    eggsCancelled: 0,
    eggsDueToday: 0,
    unknownEggBatches: 0,
  };
  for (const r of records) {
    const status = effectiveStatus(r, nowMs);
    t[`${status}Batches`] += 1;
    if (isOverdue(r, nowMs)) t.overdueBatches += 1;
    const c = eggCounts(r);
    if (!c.known) {
      t.unknownEggBatches += 1;
      continue;
    }
    t.eggsInitial += c.initial;
    if (status === STATUS.PLANNED) t.eggsPlanned += c.active;
    else t.eggsActive += c.active;
    t.eggsCompleted += c.completed;
    t.eggsRemoved += c.removed;
    t.eggsCancelled += c.cancelled;
    if (isDueToday(r, nowMs)) t.eggsDueToday += c.active;
  }
  return t;
}

export function formatEggs(n) {
  return `${n} egg${n === 1 ? '' : 's'}`;
}

// ---------- HH stage observations ----------
//
// Observations are append-only and belong to the whole batch (eggs share one schedule).
// Each one stores a frozen snapshot of the stage estimate at observation time, so a later
// change to the reference table never rewrites past records. The observed stage is kept
// separately from the estimate and is null when the stage could not be confirmed.

export const VERDICTS = Object.freeze({ MATCH: 'match', DIFFERENT: 'different', UNCONFIRMED: 'unconfirmed', BASELINE: 'baseline' });
export const VERDICT_LABEL = {
  match: 'Matches the estimate',
  different: 'Observed stage differs from the estimate',
  unconfirmed: 'Stage not confirmed',
  baseline: 'Observed when the batch was set up',
};

/** Incubation age at placement as [lo, hi] minutes: a stage's reference range, or exact. */
export function baselineAgeMinutes(record) {
  const b = record.stagePlan?.baselineAgeHours;
  return b ? [Math.round(b[0] * 60), Math.round(b[1] * 60)] : [record.currentIncubationMinutes, record.currentIncubationMinutes];
}

export function elapsedMinutes(record, atMs) {
  return Math.max(0, Math.floor((atMs - ms(record.placementAt)) / 60_000));
}

/** Calculated incubation-age range [lo, hi] (minutes) at an instant: baseline range + elapsed time. */
export function ageRangeAt(record, atMs) {
  const [lo, hi] = baselineAgeMinutes(record);
  const e = elapsedMinutes(record, atMs);
  return [lo + e, hi + e];
}

/** Lower bound of the age range (exact for duration-based batches). */
export function incubationAgeAt(record, atMs) {
  return ageRangeAt(record, atMs)[0];
}

/** Estimated stage snapshot for this batch at an instant, carrying the age uncertainty through. */
export function estimateStageAt(record, atMs) {
  const [lo, hi] = ageRangeAt(record, atMs);
  return estimateStageForRange(lo, hi);
}

/** "48 h" or "≈ 33–38 h" for an age range in minutes. */
export function formatAgeRange([lo, hi]) {
  return lo === hi ? formatDuration(lo) : `≈ ${formatHoursRange([lo / 60, hi / 60])}`;
}

// ---------- retractions (append-only) ----------

export function retractionFor(record, observationId) {
  return (record.retractions ?? []).find((x) => x.observationId === observationId) ?? null;
}

export function isRetracted(record, observationId) {
  return retractionFor(record, observationId) !== null;
}

/** Observations that count: everything except retracted ones. */
export function activeObservations(record) {
  return (record.observations ?? []).filter((o) => !isRetracted(record, o.id));
}

/** Retract an observation with a required reason. The original observation is never altered. */
export function retractObservation(record, observationId, { reason, nowMs }) {
  const o = (record.observations ?? []).find((x) => x.id === observationId);
  if (!o) throw new Error('That observation does not exist.');
  if (isRetracted(record, observationId)) throw new Error('This observation has already been retracted.');
  const why = String(reason ?? '').trim();
  if (!why) throw new RangeError('A reason is required to retract an observation.');
  if (why.length > 1000) throw new RangeError('Reason must be 1000 characters or fewer.');
  const at = iso(nowMs);
  return {
    ...record,
    retractions: [...(record.retractions ?? []), { observationId, at, reason: why }],
    updatedAt: at,
    history: [
      ...record.history,
      {
        at,
        action: 'observation-retracted',
        summary: `Retracted observation from ${formatDateTime(ms(o.observedAt), record.timeZone)} (${o.observedStage ? `HH${o.observedStage}` : 'no stage'})`,
        reason: why,
      },
    ],
  };
}

const minuteKey = (iso) => Math.floor(Date.parse(iso) / 60_000);

/** Two observations are accidental duplicates if they agree on minute, verdict and stage. */
export function observationKey(o) {
  return `${minuteKey(o.observedAt)}|${o.verdict}|${o.observedStage ?? '-'}`;
}

/**
 * Validate an observation for a batch.
 * input: { observedAtMs, verdict, observedStage (number|null), note }
 * Returns { ok, errors, estimate } — estimate is the snapshot that would be stored.
 */
export function validateObservation(record, input, { nowMs }) {
  const errors = {};
  const at = input.observedAtMs;
  let estimate = null;
  if (!Number.isFinite(at)) errors.observedAt = 'Enter a valid observation date and time.';
  else if (at > nowMs + 60_000) errors.observedAt = 'Observation time cannot be in the future.';
  else if (at < ms(record.placementAt)) errors.observedAt = 'Observation time is before this batch was placed.';
  else estimate = estimateStageAt(record, at);

  const verdict = input.verdict;
  if (!Object.values(VERDICTS).includes(verdict)) errors.verdict = 'Choose one of the three answers.';
  const stage = input.observedStage ?? null;
  if (verdict === VERDICTS.BASELINE && !isValidStage(stage)) errors.observedStage = 'A setup observation needs a valid HH stage.';
  if (input.temperature && !parseTemperature(input.temperature.value, input.temperature.unit).ok) errors.temperature = 'Invalid temperature.';
  if (estimate && verdict === VERDICTS.MATCH) {
    if (stage === null) errors.observedStage = `Choose which stage within ${estimate.label} you observed.`;
    else if (!stageInRange(stage, estimate.stages)) errors.observedStage = `HH${stage} is outside the estimate (${estimate.label}). Choose “No, the observed stage is different”.`;
  }
  if (estimate && verdict === VERDICTS.DIFFERENT) {
    if (!isValidStage(stage)) errors.observedStage = 'Choose the observed HH stage (1–46).';
    else if (stageInRange(stage, estimate.stages)) errors.observedStage = `HH${stage} is within the estimate (${estimate.label}). Choose “Yes, it matches”.`;
  }
  if (verdict === VERDICTS.UNCONFIRMED && stage !== null) errors.observedStage = 'No stage is recorded when the stage could not be confirmed.';
  if (String(input.note ?? '').length > 2000) errors.note = 'Note must be 2000 characters or fewer.';
  return { ok: Object.keys(errors).length === 0, errors, estimate };
}

export class DuplicateObservationError extends Error {}

/** Append a validated observation (and a history line). Never modifies earlier observations. */
export function addObservation(record, input, { nowMs, id = newUid() }) {
  const v = validateObservation(record, input, { nowMs });
  if (!v.ok) throw new RangeError(Object.values(v.errors)[0]);
  const observation = {
    id,
    recordedAt: iso(nowMs),
    observedAt: iso(input.observedAtMs),
    elapsedMinutes: elapsedMinutes(record, input.observedAtMs),
    ageRangeMinutes: v.estimate.ageRangeMinutes,
    ageMinutes: v.estimate.ageMinutes, // exact age, or null when only a range is known
    estimate: v.estimate,
    verdict: input.verdict,
    observedStage: input.verdict === VERDICTS.UNCONFIRMED ? null : input.observedStage,
    note: String(input.note ?? '').trim(),
    temperature: input.temperature ?? null,
    source: input.source ?? 'manual',
  };
  const existing = record.observations ?? [];
  if (activeObservations(record).some((o) => observationKey(o) === observationKey(observation))) {
    throw new DuplicateObservationError('This observation was already recorded for this batch.');
  }
  const outcome =
    observation.verdict === VERDICTS.UNCONFIRMED
      ? 'stage not confirmed'
      : observation.verdict === VERDICTS.BASELINE
        ? `observed HH${observation.observedStage} at setup`
        : `observed HH${observation.observedStage}${observation.verdict === VERDICTS.MATCH ? ' (matches estimate)' : ' (differs from estimate)'}`;
  return {
    ...record,
    observations: [...existing, observation],
    updatedAt: iso(nowMs),
    history: [
      ...record.history,
      {
        at: iso(nowMs),
        action: 'observation',
        summary: `Stage observation at ${formatAgeRange(observation.ageRangeMinutes)} incubation: estimate ${observation.estimate.label}, ${outcome}`,
        reason: observation.note,
      },
    ],
  };
}

/** Observations sorted by observation time (records keep insertion order). */
export function observationsByTime(record) {
  return [...(record.observations ?? [])].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
}

export { stageRangeLabel };

// ---------- derived state ----------

/** Planned/Active is derived from the clock; Completed/Cancelled are final until reopened. */
export function effectiveStatus(record, nowMs) {
  if (record.status === STATUS.COMPLETED || record.status === STATUS.CANCELLED) return record.status;
  return ms(record.placementAt) > nowMs ? STATUS.PLANNED : STATUS.ACTIVE;
}

export function isOpen(record) {
  return record.status !== STATUS.COMPLETED && record.status !== STATUS.CANCELLED;
}

/** Estimated target window for stage-based batches: { startMs, endMs }, else null. */
export function windowOf(record) {
  const p = record.stagePlan;
  if (!p) return null;
  const placement = ms(record.placementAt);
  return { startMs: placement + p.windowHours[0] * 3_600_000, endMs: placement + p.windowHours[1] * 3_600_000 };
}

/** Planned return instant for stage-based batches (null when none chosen). */
export function plannedReturnOf(record) {
  const p = record.stagePlan;
  if (!p || p.plannedReturnMinutes === null || p.plannedReturnMinutes === undefined) return null;
  return ms(record.placementAt) + p.plannedReturnMinutes * 60_000;
}

/** 'before' | 'in' | 'after' relative to the estimated window. */
export function windowPhase(record, nowMs) {
  const w = windowOf(record);
  if (!w) return null;
  if (nowMs < w.startMs) return 'before';
  return nowMs <= w.endMs ? 'in' : 'after';
}

export function formatWindow(w, timeZone) {
  if (!w) return '—';
  return `${formatDateTime(w.startMs, timeZone)} – ${formatDateTime(w.endMs, timeZone)}`;
}

/**
 * Open batch past its schedule: a duration-based batch past its target time, or a stage-based
 * batch whose whole estimated window has passed ("Window passed" — not a missed deadline).
 */
export function isOverdue(record, nowMs) {
  if (!isOpen(record)) return false;
  const w = windowOf(record);
  return w ? nowMs > w.endMs : ms(record.targetAt) <= nowMs;
}

export function isDueToday(record, nowMs) {
  if (!isOpen(record)) return false;
  const today = zonedDateKey(nowMs, record.timeZone);
  const w = windowOf(record);
  if (w) return zonedDateKey(w.startMs, record.timeZone) <= today && today <= zonedDateKey(w.endMs, record.timeZone);
  return zonedDateKey(ms(record.targetAt), record.timeZone) === today;
}

/** Key that changes whenever anything shown in the calendar file changes. */
export function scheduleSignature(record) {
  const w = windowOf(record);
  return w ? `${record.targetAt}|${iso(w.startMs)}|${iso(w.endMs)}|${record.stagePlan.plannedReturn}` : record.targetAt;
}

export function remainingFor(record, nowMs) {
  return timeRemaining(ms(record.targetAt), nowMs);
}

/** 'none' | 'current' | 'outdated' (schedule changed after the last .ics download). */
export function calendarState(record) {
  if (!record.calendar?.exportedAt) return 'none';
  const exported = record.calendar.exportedSignature ?? record.calendar.exportedTargetAt;
  return exported === scheduleSignature(record) ? 'current' : 'outdated';
}

/**
 * Calculated incubation timeline. Assumes incubation is continuous from placement onward;
 * this is arithmetic only, not a statement about developmental stage.
 */
export function incubationTimeline(record, nowMs) {
  const placementMs = ms(record.placementAt);
  const sincePlacementMin = Math.max(0, Math.floor((nowMs - placementMs) / 60_000));
  const base = baselineAgeMinutes(record);
  return {
    atPlacementMinutes: record.currentIncubationMinutes,
    atPlacementRange: base,
    sincePlacementMinutes: sincePlacementMin,
    nowMinutes: nowMs >= placementMs ? record.currentIncubationMinutes + sincePlacementMin : null,
    nowRange: nowMs >= placementMs ? [base[0] + sincePlacementMin, base[1] + sincePlacementMin] : null,
    projectedAtTargetMinutes: projectedTotalIncubationMinutes(record.currentIncubationMinutes, record.waitMinutes),
  };
}

export function targetShiftMs(record) {
  return ms(record.targetAt) - ms(record.originalTargetAt);
}

/** Positive delta = late. */
export function describeDelta(deltaMs) {
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes === 0) return 'on time';
  return `${formatDuration(Math.abs(minutes))} ${minutes > 0 ? 'late' : 'early'}`;
}

export function recordWarnings(record) {
  const w = [];
  if (!isOpen(record)) return w;
  const cal = calendarState(record);
  if (cal === 'none') w.push('Calendar event not downloaded yet.');
  if (cal === 'outdated') w.push('Schedule changed after the calendar file was downloaded — download it again.');
  return w;
}

/** Sort open experiments by target, earliest first. */
export function byTarget(a, b) {
  return sortKey(a) - sortKey(b);
}

/** Ordering instant: the window start for stage-based batches, else the target time. */
export function sortKey(record) {
  return windowOf(record)?.startMs ?? ms(record.targetAt);
}

// ---------- form helpers ----------

export function emptyInput({ experimentId, timeZone, nowMs }) {
  const { date, time } = instantToWallInputs(nowMs, timeZone);
  const name = defaultBatchName(nowMs, timeZone); // placement defaults to now
  return {
    experimentId,
    name,
    nameIsDefault: true,
    defaultName: name,
    batchId: '',
    eggCount: String(DEFAULT_EGG_COUNT),
    timingMode: 'stage',
    // Nothing is pre-selected: the researcher must choose the start, stages and return option.
    start: '',
    currentStage: '',
    targetStage: '',
    plannedReturn: '',
    stageObserved: false,
    temperatureValue: '',
    temperatureUnit: 'C',
    currentHours: '',
    currentMinutes: '',
    placementDate: date,
    placementTime: time,
    placementOccurrence: 'first',
    timeZone,
    waitHours: '',
    waitMinutes: '',
    reminderOffsets: [...DEFAULT_REMINDERS],
    notes: '',
    conditions: '',
  };
}

export function recordToInput(record) {
  const placementMs = ms(record.placementAt);
  const { date, time } = instantToWallInputs(placementMs, record.timeZone);
  const r = zonedWallTimeToInstant(date, time, record.timeZone);
  const cur = splitMinutes(record.currentIncubationMinutes);
  const wait = splitMinutes(record.waitMinutes);
  return {
    experimentId: record.experimentId,
    name: record.name,
    batchId: record.batchId,
    eggCount: Number.isInteger(record.initialEggCount) ? String(record.initialEggCount) : '',
    // Records without a stage plan keep their entered durations (never recalculated).
    timingMode: record.stagePlan ? 'stage' : 'duration',
    start: record.stagePlan?.start ?? '',
    currentStage: record.stagePlan?.currentStage ?? '',
    targetStage: record.stagePlan?.targetStage ?? '',
    plannedReturn: record.stagePlan?.plannedReturn ?? '',
    stageObserved: record.stagePlan?.currentStageBasis === 'observed',
    temperatureValue: record.temperature ? String(record.temperature.value) : '',
    temperatureUnit: record.temperature?.unit ?? 'C',
    nameIsDefault: Boolean(record.nameIsDefault),
    defaultName: record.nameIsDefault ? record.name : '',
    currentHours: String(cur.hours),
    currentMinutes: cur.minutes ? String(cur.minutes) : '',
    placementDate: date,
    placementTime: time,
    placementOccurrence: r.ok && r.ambiguous && r.alternatives[1] === placementMs ? 'second' : 'first',
    timeZone: record.timeZone,
    waitHours: String(wait.hours),
    waitMinutes: wait.minutes ? String(wait.minutes) : '',
    reminderOffsets: [...record.reminderOffsets],
    notes: record.notes,
    conditions: record.conditions,
  };
}

/** Template for a new experiment based on an existing one; placement defaults to now. */
export function duplicateToInput(record, { experimentId, nowMs }) {
  const input = recordToInput(record);
  const { date, time } = instantToWallInputs(nowMs, record.timeZone);
  const fresh = defaultBatchName(nowMs, record.timeZone);
  return {
    ...input,
    experimentId,
    name: record.nameIsDefault ? fresh : `${record.name} (copy)`,
    nameIsDefault: Boolean(record.nameIsDefault),
    defaultName: record.nameIsDefault ? fresh : '',
    // An observation belongs to the original batch only.
    stageObserved: false,
    eggCount: input.eggCount || String(DEFAULT_EGG_COUNT),
    placementDate: date,
    placementTime: time,
    placementOccurrence: 'first',
  };
}

// ---------- converting older duration-based batches ----------

/**
 * Explicitly convert a duration-based batch to stage-based timing. The entered incubation age at
 * placement is used as an exact baseline (it was entered, not estimated); the original wait and
 * target are kept in the history and in stagePlan.convertedFrom. Observations are untouched.
 */
export function convertToStagePlan(record, { targetStage, plannedReturn, nowMs, reason = '' }) {
  if (record.stagePlan) throw new Error('This batch already uses stage-based timing.');
  if (!isOpen(record)) throw new Error('Only open batches can be converted.');
  if (!Number.isFinite(record.currentIncubationMinutes)) {
    throw new Error('This batch has no recorded incubation age at placement, so a stage window cannot be calculated.');
  }
  if (!isValidStage(targetStage)) throw new RangeError('Choose a target HH stage from 2 to 46.');
  if (getStage(targetStage).minHours === null) throw new RangeError(`HH${targetStage} has no reference age. Choose HH2 or later.`);
  if (!Object.hasOwn(PLANNED_RETURN, plannedReturn ?? '')) throw new RangeError('Choose whether to plan a specific return time.');
  const age = record.currentIncubationMinutes / 60;
  const p = windowPlan({ baseline: [age, age], basis: 'entered-duration', start: 'entered', targetStage, plannedReturn });
  if (!p.ok) throw new RangeError(p.error);
  const now = iso(nowMs);
  const plan = { ...p.plan, convertedFrom: { at: now, waitMinutes: record.waitMinutes, targetAt: record.targetAt } };
  const placement = ms(record.placementAt);
  const newWait = plan.plannedReturnMinutes ?? Math.round(plan.windowHours[0] * 60);
  const next = { ...record, stagePlan: plan, waitMinutes: newWait, targetAt: iso(placement + newWait * 60_000), updatedAt: now };
  next.history = [
    ...record.history,
    {
      at: now,
      action: 'converted-to-stage',
      summary: `Converted to stage-based timing: ${planSummary(plan)}, estimated window ${formatWindow(windowOf(next), record.timeZone)}`,
      reason: String(reason).trim(),
      changes: [
        { field: 'waitMinutes', label: 'Waiting duration', from: formatDuration(record.waitMinutes), to: plan.plannedReturnMinutes === null ? 'window only' : formatDuration(newWait) },
        { field: 'targetAt', label: 'Target time', from: formatDateTime(ms(record.targetAt), record.timeZone), to: formatWindow(windowOf(next), record.timeZone) },
      ],
    },
  ];
  return next;
}
