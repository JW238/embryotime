// Stage-based timing: explicit choices, uncertainty carried as ranges, estimated windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateStageForRange, getStage, planStages } from '../src/hh-stages.js';
import {
  ageRangeAt,
  convertToStagePlan,
  createExperiment,
  defaultBatchName,
  duplicateToInput,
  emptyInput,
  estimateStageAt,
  isDueToday,
  isOverdue,
  normalizeRecord,
  plannedReturnOf,
  recordToInput,
  updateExperiment,
  validateExperimentInput,
  windowOf,
  windowPhase,
} from '../src/experiment.js';
import { buildIcs } from '../src/ics.js';
import { experimentsToCsv } from '../src/csv.js';

const TZ = 'America/Toronto';
const NOW = Date.parse('2026-10-27T00:15:00Z'); // Oct 26, 8:15 PM EDT
const H = 3600_000;

const stageInput = (o = {}) => ({
  experimentId: 'EXP-1',
  name: 'Batch',
  eggCount: '24',
  timingMode: 'stage',
  start: 'stage',
  currentStage: '10',
  targetStage: '12',
  plannedReturn: 'none',
  stageObserved: false,
  placementDate: '2026-10-26',
  placementTime: '20:15',
  timeZone: TZ,
  reminderOffsets: [],
  ...o,
});
const make = (o, uid = 'u1', nowMs = NOW) => {
  const v = validateExperimentInput(stageInput(o), { nowMs });
  assert.ok(v.ok, JSON.stringify(v.errors));
  return createExperiment(v.value, { nowMs, uid });
};

// ---------- interval arithmetic ----------

test('window = [max(0, targetMin − baselineMax), targetMax − baselineMin] from listed ranges', () => {
  const p = planStages({ start: 'stage', currentStage: 10, targetStage: 12, plannedReturn: 'none' }).plan;
  assert.deepEqual(p.baselineAgeHours, [33, 38]); // HH10 reference range, not a midpoint
  assert.deepEqual(p.targetAgeHours, [45, 49]);
  assert.deepEqual(p.windowHours, [7, 16]);
  assert.equal(p.plannedReturnMinutes, null);
  assert.equal(p.version, 2);
  assert.equal(p.referenceVersion, 'HH1951/UNSW-2026-10-26');
});

test('overlapping reference ranges: window starts at placement and is flagged', () => {
  const p = planStages({ start: 'stage', currentStage: 13, targetStage: 14, plannedReturn: 'middle' }).plan;
  assert.deepEqual(p.windowHours, [0, 5]); // 50−52 → 0; 53−48 = 5
  assert.equal(p.rangesOverlap, true);
  assert.equal(p.plannedReturnMinutes, 150);
  assert.equal(planStages({ start: 'stage', currentStage: 13, targetStage: 14, plannedReturn: 'start' }).code, 'zero-start');
});

test('point ages and day-based ranges', () => {
  assert.deepEqual(planStages({ start: 'stage', currentStage: 18, targetStage: 24, plannedReturn: 'none' }).plan.windowHours, [36, 36]);
  assert.deepEqual(planStages({ start: 'stage', currentStage: 17, targetStage: 19, plannedReturn: 'none' }).plan.windowHours, [8, 32]);
});

test('freshly set eggs: known age 0 h (not an HH1 observation) → target reference range', () => {
  const p = planStages({ start: 'fresh', targetStage: 12, plannedReturn: 'none' }).plan;
  assert.deepEqual(p.baselineAgeHours, [0, 0]);
  assert.equal(p.currentStage, null);
  assert.equal(p.currentStageBasis, 'known-age');
  assert.deepEqual(p.windowHours, [45, 49]);
  assert.equal(planStages({ start: 'fresh', targetStage: 1, plannedReturn: 'none' }).code, 'no-reference-age');
});

test('nothing is assumed: start, stages and planned return must be chosen explicitly', () => {
  assert.equal(planStages({ targetStage: 12, plannedReturn: 'none' }).code, 'start');
  assert.equal(planStages({ start: 'stage', targetStage: 12, plannedReturn: 'none' }).code, 'missing');
  assert.equal(planStages({ start: 'stage', currentStage: 10, plannedReturn: 'none' }).field, 'target');
  assert.equal(planStages({ start: 'stage', currentStage: 10, targetStage: 12 }).field, 'plannedReturn');
  const blank = emptyInput({ experimentId: 'X', timeZone: TZ, nowMs: NOW });
  assert.deepEqual([blank.start, blank.currentStage, blank.targetStage, blank.plannedReturn], ['', '', '', '']);
  assert.deepEqual(blank.reminderOffsets, []); // calendar alerts are opt-in
  const v = validateExperimentInput({ ...blank }, { nowMs: NOW });
  assert.match(v.errors.stages, /starting point/);
  assert.equal(validateExperimentInput(stageInput({ targetStage: '' }), { nowMs: NOW }).errors.stages, 'Choose the target HH stage.');
  assert.match(validateExperimentInput(stageInput({ plannedReturn: '' }), { nowMs: NOW }).errors.plannedReturn, /planned return|specific return/);
});

test('invalid stage order, out-of-range stages and HH1 are refused with explanations', () => {
  assert.equal(planStages({ start: 'stage', currentStage: 12, targetStage: 12, plannedReturn: 'none' }).code, 'order');
  assert.equal(planStages({ start: 'stage', currentStage: 14, targetStage: 10, plannedReturn: 'none' }).code, 'order');
  assert.equal(planStages({ start: 'stage', currentStage: 0, targetStage: 10, plannedReturn: 'none' }).code, 'invalid');
  assert.equal(planStages({ start: 'stage', currentStage: 10, targetStage: 47, plannedReturn: 'none' }).code, 'invalid');
  const hh1 = planStages({ start: 'stage', currentStage: 1, targetStage: 5, plannedReturn: 'none' });
  assert.equal(hh1.code, 'no-reference-age');
  assert.match(hh1.error, /Freshly set eggs/);
  assert.equal(getStage(1).minHours, null);
});

// ---------- uncertainty carried through ----------

test('age at any time is the baseline range plus elapsed time — no midpoint', () => {
  const r = make();
  const t = Date.parse(r.placementAt) + 10 * H;
  assert.deepEqual(ageRangeAt(r, t), [43 * 60, 48 * 60]);
  const est = estimateStageAt(r, t);
  assert.deepEqual(est.ageRangeMinutes, [43 * 60, 48 * 60]);
  assert.equal(est.ageMinutes, null); // only a range is known
  assert.deepEqual(est.stages, [11, 13]); // HH11 40–45, HH12 45–49, HH13 48–52 overlap 43–48 h
  assert.deepEqual(estimateStageForRange(36 * 60, 36 * 60).stages, [10, 10]); // exact ages unchanged
});

test('stage-based record: window, phases, overdue = window passed, due today = window overlaps today', () => {
  const r = make();
  const w = windowOf(r);
  const placement = Date.parse(r.placementAt);
  assert.equal(w.startMs, placement + 7 * H);
  assert.equal(w.endMs, placement + 16 * H);
  assert.equal(plannedReturnOf(r), null);
  assert.equal(r.targetAt, new Date(w.startMs).toISOString()); // ordering only
  assert.equal(windowPhase(r, w.startMs - 1), 'before');
  assert.equal(windowPhase(r, w.startMs), 'in');
  assert.equal(windowPhase(r, w.endMs), 'in');
  assert.equal(windowPhase(r, w.endMs + 1), 'after');
  assert.equal(isOverdue(r, w.startMs + H), false); // inside the window is not "overdue"
  assert.equal(isOverdue(r, w.endMs + 1), true);
  assert.equal(isDueToday(r, w.startMs), true);
});

test('planned return is separate from the biological estimate', () => {
  const r = make({ plannedReturn: 'middle' });
  assert.equal(plannedReturnOf(r) - Date.parse(r.placementAt), 11.5 * H);
  assert.equal(Date.parse(r.targetAt), plannedReturnOf(r));
  assert.deepEqual(r.stagePlan.windowHours, [7, 16]);
});

// ---------- observed vs selected ----------

test('a selected stage is never an observation; "observed" creates a real setup observation', () => {
  assert.deepEqual(make().observations, []);
  const obs = make({ stageObserved: true }, 'u2');
  assert.equal(obs.stagePlan.currentStageBasis, 'observed');
  assert.equal(obs.observations.length, 1);
  const o = obs.observations[0];
  assert.deepEqual([o.verdict, o.observedStage, o.source, o.observedAt], ['baseline', 10, 'setup', obs.placementAt]);
  assert.deepEqual(o.ageRangeMinutes, [33 * 60, 38 * 60]);
  // Cannot "observe" a placement that has not happened yet.
  const future = validateExperimentInput(stageInput({ stageObserved: true, placementDate: '2026-10-28' }), { nowMs: NOW });
  assert.match(future.errors.stages, /already happened/);
});

// ---------- names ----------

test('default name comes from the placement time; custom names are kept', () => {
  assert.equal(defaultBatchName(NOW, TZ), 'October 26, 2026 — 8:15 PM');
  const blank = emptyInput({ experimentId: 'X', timeZone: TZ, nowMs: NOW });
  assert.equal(blank.name, 'October 26, 2026 — 8:15 PM');
  assert.equal(blank.nameIsDefault, true);
  const auto = make({ name: blank.name, nameIsDefault: true, defaultName: blank.name });
  assert.equal(auto.nameIsDefault, true);
  const custom = make({ name: 'Somite series A', nameIsDefault: true, defaultName: blank.name }, 'u3');
  assert.equal(custom.nameIsDefault, false); // edited away from the default → treated as custom
  assert.equal(duplicateToInput(custom, { experimentId: 'EXP-2', nowMs: NOW }).name, 'Somite series A (copy)');
  assert.equal(duplicateToInput(auto, { experimentId: 'EXP-3', nowMs: NOW + H }).name, 'October 26, 2026 — 9:15 PM');
});

// ---------- legacy records ----------

test('legacy duration-based records keep their semantics and edit in duration mode', () => {
  const v = validateExperimentInput(
    { ...stageInput(), timingMode: undefined, batchId: 'S-9', currentHours: '48', waitHours: '36' },
    { nowMs: NOW }
  );
  const legacy = normalizeRecord(createExperiment(v.value, { nowMs: NOW, uid: 'old' }));
  assert.equal(legacy.stagePlan, undefined);
  assert.equal(windowOf(legacy), null);
  assert.equal(isOverdue(legacy, Date.parse(legacy.targetAt)), true); // point target semantics
  const input = recordToInput(legacy);
  assert.deepEqual([input.timingMode, input.currentHours, input.waitHours, input.batchId], ['duration', '48', '36', 'S-9']);
  assert.equal(updateExperiment(legacy, validateExperimentInput(input, { nowMs: NOW }).value, { nowMs: NOW + H }), legacy);
});

test('explicit conversion of a legacy batch keeps the old values in history', () => {
  const v = validateExperimentInput({ ...stageInput(), timingMode: undefined, currentHours: '36', waitHours: '12' }, { nowMs: NOW });
  const legacy = createExperiment(v.value, { nowMs: NOW, uid: 'old2' });
  const c = convertToStagePlan(legacy, { targetStage: 12, plannedReturn: 'none', nowMs: NOW + H, reason: 'switch' });
  assert.deepEqual(c.stagePlan.baselineAgeHours, [36, 36]); // entered value, exact
  assert.equal(c.stagePlan.currentStageBasis, 'entered-duration');
  assert.deepEqual(c.stagePlan.windowHours, [9, 13]); // HH12 45–49 h − 36 h
  assert.equal(c.stagePlan.convertedFrom.waitMinutes, 720);
  assert.equal(c.stagePlan.convertedFrom.targetAt, legacy.targetAt);
  assert.equal(c.originalTargetAt, legacy.originalTargetAt);
  assert.equal(c.history.at(-1).action, 'converted-to-stage');
  assert.equal(c.history.at(-1).reason, 'switch');
  assert.throws(() => convertToStagePlan(c, { targetStage: 13, plannedReturn: 'none', nowMs: NOW }), /already uses/);
  // Target already passed by the entered age → explained, not fabricated.
  assert.throws(() => convertToStagePlan(legacy, { targetStage: 8, plannedReturn: 'none', nowMs: NOW }), /already at or past/);
});

test('editing a stage-based batch round-trips its plan and logs plan changes', () => {
  const r = make();
  const input = recordToInput(r);
  assert.deepEqual([input.timingMode, input.start, input.currentStage, input.targetStage, input.plannedReturn], ['stage', 'stage', 10, 12, 'none']);
  assert.equal(updateExperiment(r, validateExperimentInput(input, { nowMs: NOW }).value, { nowMs: NOW }), r);
  const changed = updateExperiment(r, validateExperimentInput({ ...input, targetStage: 13 }, { nowMs: NOW }).value, { nowMs: NOW + H });
  assert.ok(changed.history.at(-1).changes.some((c) => c.field === 'stagePlan'));
  assert.equal(changed.originalTargetAt, r.originalTargetAt);
});

// ---------- calendar and CSV agree with the window ----------

test('ICS: stage-based batch exports the whole estimated window; planned return is a separate event', () => {
  const r = make();
  const ics = buildIcs(r, { nowMs: NOW }).replace(/\r\n /g, '');
  const w = windowOf(r);
  const z = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1);
  assert.match(ics, new RegExp(`DTSTART:${z(w.startMs)}`));
  assert.match(ics, new RegExp(`DTEND:${z(w.endMs)}`));
  assert.match(ics, /estimated HH12 window \(estimate\)/);
  assert.match(ics, /not a guaranteed time/);
  assert.match(ics, /TRANSP:TRANSPARENT/);
  const withReturn = buildIcs(make({ plannedReturn: 'end', reminderOffsets: [60] }, 'u9'), { nowMs: NOW }).replace(/\r\n /g, '');
  assert.equal((withReturn.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.match(withReturn, /planned lab return/);
  assert.equal((withReturn.match(/BEGIN:VALARM/g) ?? []).length, 1); // alert on the planned return only
});

test('CSV columns describe the window and timing type', () => {
  const r = make();
  const [header, row] = experimentsToCsv([r], NOW).replace('﻿', '').split('\r\n');
  const cols = header.split(',');
  const cells = row.split(',');
  const at = (n) => cells[cols.indexOf(n)];
  assert.equal(at('Timing'), 'stage-based (estimate)');
  assert.equal(at('Current HH stage'), '10');
  assert.equal(at('Baseline age min (h)'), '33');
  assert.equal(at('Baseline age max (h)'), '38');
  assert.equal(at('Target HH stage'), '12');
  assert.equal(at('Estimated window start (local)'), '2026-10-27 03:15');
  assert.equal(at('Estimated window end (local)'), '2026-10-27 12:15');
  assert.equal(at('Window state'), 'not yet open');
});
