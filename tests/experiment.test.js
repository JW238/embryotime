import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS,
  calendarState,
  cancelExperiment,
  completeExperiment,
  createExperiment,
  duplicateToInput,
  effectiveStatus,
  incubationTimeline,
  isDueToday,
  isOverdue,
  markCalendarExported,
  nextExperimentId,
  recordToInput,
  recordWarnings,
  reopenExperiment,
  targetShiftMs,
  updateExperiment,
  validateExperimentInput,
} from '../src/experiment.js';

const TZ = 'America/Toronto';
const NOW = Date.parse('2026-10-26T17:30:00Z'); // 13:30 EDT
const H = 3600_000;

const baseInput = {
  experimentId: 'EXP-1',
  name: 'Core scenario',
  batchId: 'B1',
  eggCount: '24',
  currentHours: '48',
  currentMinutes: '',
  placementDate: '2026-10-26',
  placementTime: '13:20',
  timeZone: TZ,
  waitHours: '36',
  waitMinutes: '',
  reminderOffsets: [30, 120],
  notes: 'n',
  conditions: '',
};

function make(overrides = {}, nowMs = NOW) {
  const v = validateExperimentInput({ ...baseInput, ...overrides }, { nowMs });
  assert.ok(v.ok, JSON.stringify(v.errors));
  return createExperiment(v.value, { nowMs, uid: 'uid-1' });
}

test('valid input produces target and original target', () => {
  const r = make();
  assert.equal(r.targetAt, '2026-10-28T05:20:00.000Z');
  assert.equal(r.originalTargetAt, r.targetAt);
  assert.equal(r.currentIncubationMinutes, 48 * 60);
  assert.equal(r.waitMinutes, 36 * 60);
  assert.equal(r.status, STATUS.ACTIVE);
  assert.equal(r.history[0].action, 'created');
  assert.equal(incubationTimeline(r, NOW).projectedAtTargetMinutes, 84 * 60);
});

test('missing and invalid inputs are reported per field', () => {
  const v = validateExperimentInput(
    { ...baseInput, experimentId: '', name: '  ', currentHours: '-1', waitHours: '', placementDate: '2026-02-30' },
    { nowMs: NOW }
  );
  assert.equal(v.ok, false);
  assert.ok(v.errors.experimentId);
  assert.ok(v.errors.name);
  assert.ok(v.errors.currentIncubation);
  assert.ok(v.errors.wait);
  assert.ok(v.errors.placement);
});

test('missing placement time and bad reminders are errors', () => {
  const v = validateExperimentInput({ ...baseInput, placementTime: '', reminderOffsets: [0] }, { nowMs: NOW });
  assert.ok(v.errors.placement);
  assert.ok(v.errors.reminders);
});

test('duplicate experiment ID is rejected', () => {
  const v = validateExperimentInput(baseInput, { existingIds: ['EXP-1'], nowMs: NOW });
  assert.match(v.errors.experimentId, /already used/);
});

test('warnings for missing reminders and batch ID, and a past target', () => {
  const v = validateExperimentInput({ ...baseInput, batchId: '', reminderOffsets: [], placementDate: '2026-10-20' }, { nowMs: NOW });
  assert.ok(v.ok);
  assert.equal(v.warnings.length, 3);
});

test('ambiguous placement uses the chosen occurrence', () => {
  const first = validateExperimentInput({ ...baseInput, placementDate: '2026-11-01', placementTime: '01:30' }, { nowMs: NOW });
  const second = validateExperimentInput(
    { ...baseInput, placementDate: '2026-11-01', placementTime: '01:30', placementOccurrence: 'second' },
    { nowMs: NOW }
  );
  assert.equal(first.value.placementAt, '2026-11-01T05:30:00.000Z');
  assert.equal(second.value.placementAt, '2026-11-01T06:30:00.000Z');
  assert.ok(first.ambiguousPlacement);
  assert.equal(recordToInput(createExperiment(second.value, { nowMs: NOW })).placementOccurrence, 'second');
});

test('editing the schedule keeps the original target and logs the change', () => {
  const r = make();
  const v = validateExperimentInput({ ...baseInput, waitHours: '40' }, { nowMs: NOW, existingIds: [] });
  const u = updateExperiment(r, v.value, { nowMs: NOW + H, reason: 'Incubator delay' });
  assert.equal(u.originalTargetAt, '2026-10-28T05:20:00.000Z');
  assert.equal(u.targetAt, '2026-10-28T09:20:00.000Z');
  assert.equal(targetShiftMs(u), 4 * H);
  const last = u.history.at(-1);
  assert.equal(last.action, 'schedule-changed');
  assert.equal(last.reason, 'Incubator delay');
  assert.ok(last.changes.some((c) => c.field === 'waitMinutes'));
  assert.ok(last.changes.some((c) => c.field === 'targetAt'));
});

test('editing with no changes returns the same record', () => {
  const r = make();
  const v = validateExperimentInput(recordToInput(r), { nowMs: NOW });
  assert.equal(updateExperiment(r, v.value, { nowMs: NOW }), r);
});

test('non-schedule edits are logged as details-edited', () => {
  const r = make();
  const v = validateExperimentInput({ ...baseInput, notes: 'changed' }, { nowMs: NOW });
  assert.equal(updateExperiment(r, v.value, { nowMs: NOW }).history.at(-1).action, 'details-edited');
});

test('overdue detection and status derivation', () => {
  const r = make();
  const target = Date.parse(r.targetAt);
  assert.equal(isOverdue(r, target - 1), false);
  assert.equal(isOverdue(r, target), true);
  assert.equal(effectiveStatus(r, target + H), STATUS.ACTIVE);
  const planned = make({ placementDate: '2026-10-27' });
  assert.equal(planned.status, STATUS.PLANNED);
  assert.equal(effectiveStatus(planned, Date.parse(planned.placementAt) + 1), STATUS.ACTIVE);
});

test('completed experiments are never overdue and record actual vs planned', () => {
  const r = make();
  const target = Date.parse(r.targetAt);
  const c = completeExperiment(r, { nowMs: target + 2 * H, completedAtMs: target + 15 * 60_000, note: 'done' });
  assert.equal(c.status, STATUS.COMPLETED);
  assert.equal(c.completedAt, '2026-10-28T05:35:00.000Z');
  assert.equal(isOverdue(c, target + 10 * H), false);
  assert.match(c.history.at(-1).summary, /15 min late/);
  assert.throws(() => completeExperiment(r, { nowMs: NOW, completedAtMs: NOW + H }), /future/);
  assert.throws(() => completeExperiment(r, { nowMs: NOW, completedAtMs: Date.parse(r.placementAt) - 60_000 }), /before the placement/);
  assert.equal(reopenExperiment(c, { nowMs: target + 3 * H }).status, STATUS.ACTIVE);
});

test('cancelled experiments keep their reason and are not overdue', () => {
  const c = cancelExperiment(make(), { nowMs: NOW, reason: 'Egg cracked' });
  assert.equal(c.status, STATUS.CANCELLED);
  assert.equal(c.cancelReason, 'Egg cracked');
  assert.equal(isOverdue(c, NOW + 100 * H), false);
  assert.deepEqual(recordWarnings(c), []);
});

test('due today uses the experiment time zone', () => {
  const r = make({ waitHours: '2' }); // 15:20 EDT today
  assert.equal(isDueToday(r, NOW), true);
  assert.equal(isDueToday(make(), NOW), false);
});

test('calendar state goes stale after a schedule change', () => {
  const r = markCalendarExported(make(), { nowMs: NOW });
  assert.equal(calendarState(r), 'current');
  assert.equal(r.calendar.sequence, 1);
  const v = validateExperimentInput({ ...baseInput, waitHours: '30' }, { nowMs: NOW });
  const u = updateExperiment(r, v.value, { nowMs: NOW });
  assert.equal(calendarState(u), 'outdated');
  assert.ok(recordWarnings(u).some((w) => /download it again/.test(w)));
});

test('experiment IDs are generated per day without collisions', () => {
  assert.equal(nextExperimentId([], NOW, TZ), 'EXP-20261026-001');
  assert.equal(nextExperimentId(['EXP-20261026-001', 'EXP-20261026-002'], NOW, TZ), 'EXP-20261026-003');
});

test('duplicate creates a template with a new ID and placement = now', () => {
  const d = duplicateToInput(make(), { experimentId: 'EXP-2', nowMs: NOW + 2 * H });
  assert.equal(d.experimentId, 'EXP-2');
  assert.equal(d.waitHours, '36');
  assert.equal(d.currentHours, '48');
  assert.equal(d.placementTime, '15:30');
});
