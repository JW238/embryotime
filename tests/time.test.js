import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTargetMs,
  clockShiftMinutes,
  formatCountdown,
  formatDateTime,
  formatDuration,
  formatIsoLocal,
  parseDateInput,
  parseDuration,
  projectedTotalIncubationMinutes,
  timeRemaining,
  zonedWallTimeToInstant,
} from '../src/time.js';

const TORONTO = 'America/Toronto';

function target(date, time, tz, waitMinutes) {
  const r = zonedWallTimeToInstant(date, time, tz);
  assert.ok(r.ok, r.error);
  return calculateTargetMs(r.instantMs, waitMinutes);
}

test('core scenario: 48 h embryo placed, return 36 h later; projected total 84 h', () => {
  const t = target('2026-10-26', '13:20', TORONTO, 36 * 60);
  assert.equal(new Date(t).toISOString(), '2026-10-28T05:20:00.000Z');
  assert.equal(formatIsoLocal(t, TORONTO), '2026-10-28 01:20');
  assert.equal(projectedTotalIncubationMinutes(48 * 60, 36 * 60), 84 * 60);
});

test('36 h crossing midnight (twice)', () => {
  const t = target('2026-05-10', '22:00', 'UTC', 36 * 60);
  assert.equal(new Date(t).toISOString(), '2026-05-12T10:00:00.000Z');
});

test('durations longer than 24 h, with minutes', () => {
  const t = target('2026-05-10', '08:15', 'UTC', 100 * 60 + 45);
  assert.equal(new Date(t).toISOString(), '2026-05-14T13:00:00.000Z');
});

test('month boundary, including leap day', () => {
  assert.equal(new Date(target('2026-01-31', '20:00', 'UTC', 36 * 60)).toISOString(), '2026-02-02T08:00:00.000Z');
  assert.equal(new Date(target('2026-02-28', '12:00', 'UTC', 36 * 60)).toISOString(), '2026-03-02T00:00:00.000Z');
  assert.equal(new Date(target('2028-02-28', '12:00', 'UTC', 36 * 60)).toISOString(), '2028-03-01T00:00:00.000Z');
});

test('year boundary in a non-UTC zone', () => {
  const t = target('2026-12-31', '18:00', 'Asia/Shanghai', 36 * 60);
  assert.equal(formatIsoLocal(t, 'Asia/Shanghai'), '2027-01-02 06:00');
  assert.equal(new Date(t).toISOString(), '2027-01-01T22:00:00.000Z');
});

test('DST fall-back: elapsed 36 h is exact; wall clock shows 35 h', () => {
  const placed = zonedWallTimeToInstant('2026-10-31', '12:00', TORONTO);
  const t = calculateTargetMs(placed.instantMs, 36 * 60);
  assert.equal(t - placed.instantMs, 36 * 3600_000);
  assert.equal(formatIsoLocal(t, TORONTO), '2026-11-01 23:00');
  assert.match(formatDateTime(t, TORONTO), /EST/);
  assert.equal(clockShiftMinutes(placed.instantMs, t, TORONTO), -60);
});

test('DST spring-forward: wall clock shows 37 h', () => {
  const placed = zonedWallTimeToInstant('2026-03-07', '12:00', TORONTO);
  const t = calculateTargetMs(placed.instantMs, 36 * 60);
  assert.equal(formatIsoLocal(t, TORONTO), '2026-03-09 01:00');
  assert.equal(clockShiftMinutes(placed.instantMs, t, TORONTO), 60);
});

test('nonexistent local time (spring-forward gap) is rejected', () => {
  const r = zonedWallTimeToInstant('2026-03-08', '02:30', TORONTO);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'nonexistent');
});

test('ambiguous local time (fall-back overlap) returns both occurrences', () => {
  const r = zonedWallTimeToInstant('2026-11-01', '01:30', TORONTO);
  assert.ok(r.ok);
  assert.equal(r.ambiguous, true);
  assert.deepEqual(r.alternatives.map((ms) => new Date(ms).toISOString()), ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']);
  assert.equal(r.instantMs, r.alternatives[0]);
});

test('normal local time is not ambiguous', () => {
  const r = zonedWallTimeToInstant('2026-07-01', '09:00', TORONTO);
  assert.equal(r.ambiguous, false);
  assert.equal(new Date(r.instantMs).toISOString(), '2026-07-01T13:00:00.000Z');
});

test('invalid dates, times and zones are rejected', () => {
  assert.equal(parseDateInput('2026-02-30'), null);
  assert.equal(parseDateInput('2027-02-29'), null);
  assert.equal(parseDateInput('26-1-1'), null);
  assert.equal(parseDateInput(''), null);
  assert.equal(zonedWallTimeToInstant('2026-01-01', '24:00', 'UTC').code, 'invalid-time');
  assert.equal(zonedWallTimeToInstant('2026-13-01', '10:00', 'UTC').code, 'invalid-date');
  assert.equal(zonedWallTimeToInstant('2026-01-01', '10:00', 'Mars/Olympus').code, 'invalid-zone');
});

test('duration parsing: missing, negative, non-numeric, out of range', () => {
  assert.equal(parseDuration('', '').ok, false);
  assert.equal(parseDuration('-5', '').ok, false);
  assert.equal(parseDuration('1.5', '').ok, false);
  assert.equal(parseDuration('abc', '').ok, false);
  assert.equal(parseDuration('3', '60').ok, false);
  assert.equal(parseDuration('0', '0').ok, false); // zero not allowed by default
  assert.deepEqual(parseDuration('0', '', { allowZero: true }), { ok: true, minutes: 0 });
  assert.deepEqual(parseDuration('36', ''), { ok: true, minutes: 2160 });
  assert.deepEqual(parseDuration('', '45'), { ok: true, minutes: 45 });
  assert.equal(parseDuration('20000', '').ok, false);
});

test('calculateTargetMs rejects invalid arguments', () => {
  assert.throws(() => calculateTargetMs(NaN, 60));
  assert.throws(() => calculateTargetMs(0, -1));
  assert.throws(() => calculateTargetMs(0, 1.5));
});

test('countdown never goes negative; overdue reported separately', () => {
  assert.deepEqual(timeRemaining(1000, 500), { overdue: false, remainingMs: 500, overdueMs: 0 });
  assert.deepEqual(timeRemaining(1000, 1000), { overdue: true, remainingMs: 0, overdueMs: 0 });
  assert.deepEqual(timeRemaining(1000, 4000), { overdue: true, remainingMs: 0, overdueMs: 3000 });
  assert.equal(formatCountdown(-5000), '00:00:00');
  assert.equal(formatCountdown((26 * 3600 + 3 * 60 + 4) * 1000), '1 d 02:03:04');
});

test('formatDuration', () => {
  assert.equal(formatDuration(2160), '36 h');
  assert.equal(formatDuration(2190), '36 h 30 min');
  assert.equal(formatDuration(45), '45 min');
});
