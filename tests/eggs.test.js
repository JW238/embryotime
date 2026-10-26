import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustEggCount,
  batchTotals,
  cancelExperiment,
  completeExperiment,
  createExperiment,
  eggCounts,
  eggsAccountedFor,
  emptyInput,
  normalizeRecord,
  parseEggCount,
  recordToInput,
  reopenExperiment,
  updateExperiment,
  validateExperimentInput,
} from '../src/experiment.js';
import { experimentsToCsv } from '../src/csv.js';
import { buildIcs } from '../src/ics.js';
import { createLocalRepository, validateImportedRecords } from '../src/storage.js';

const TZ = 'America/Toronto';
const NOW = Date.parse('2026-10-26T17:30:00Z'); // 13:30 EDT
const H = 3600_000;

const base = {
  experimentId: 'B-1',
  name: 'Batch',
  batchId: 'S1',
  eggCount: '24',
  currentHours: '48',
  placementDate: '2026-10-26',
  placementTime: '13:20',
  timeZone: TZ,
  waitHours: '36',
  reminderOffsets: [30],
};

function make(overrides = {}, uid = 'u1') {
  const v = validateExperimentInput({ ...base, ...overrides }, { nowMs: NOW });
  assert.ok(v.ok, JSON.stringify(v.errors));
  return createExperiment(v.value, { nowMs: NOW, uid });
}

const sumsToInitial = (c) => c.active + c.completed + c.removed + c.cancelled === c.initial;

test('egg count parsing: range 10–50, whole numbers only', () => {
  assert.deepEqual(parseEggCount('24'), { ok: true, count: 24 });
  assert.deepEqual(parseEggCount(' 10 '), { ok: true, count: 10 });
  assert.deepEqual(parseEggCount('50'), { ok: true, count: 50 });
  for (const bad of ['', '9', '51', '0', '-12', '12.5', '2e1', 'abc', '1 2']) {
    assert.equal(parseEggCount(bad).ok, false, bad);
  }
  assert.match(parseEggCount('9').error, /between 10 and 50/);
  assert.match(parseEggCount('12.5').error, /whole number/);
  assert.match(parseEggCount('').error, /required/);
});

test('form defaults to 24 eggs; count is validated and saved on the batch', () => {
  assert.equal(emptyInput({ experimentId: 'X', timeZone: TZ, nowMs: NOW }).eggCount, '24');
  assert.ok(validateExperimentInput({ ...base, eggCount: '60' }, { nowMs: NOW }).errors.eggCount);
  const r = make();
  assert.equal(r.initialEggCount, 24);
  assert.deepEqual(r.eggAdjustments, []);
  assert.match(r.history[0].summary, /24 eggs/);
  assert.deepEqual(eggCounts(r), { known: true, initial: 24, active: 24, completed: 0, removed: 0, cancelled: 0 });
});

test('legacy records without a count stay valid and are never given an invented count', () => {
  const legacy = { ...make() };
  delete legacy.initialEggCount;
  delete legacy.eggAdjustments;
  const n = normalizeRecord(legacy);
  assert.equal(n.initialEggCount, null);
  assert.deepEqual(n.eggAdjustments, []);
  assert.equal(eggCounts(n).known, false);
  assert.equal(recordToInput(n).eggCount, ''); // editing asks for the real number
  assert.throws(() => adjustEggCount(n, { kind: 'removed', count: 1, nowMs: NOW }), /Record the number of eggs/);
  // Setting the count later is an audited edit.
  const v = validateExperimentInput({ ...recordToInput(n), eggCount: '30' }, { nowMs: NOW });
  const u = updateExperiment(n, v.value, { nowMs: NOW });
  const change = u.history.at(-1).changes.find((c) => c.field === 'initialEggCount');
  assert.deepEqual([change.from, change.to], ['not recorded', '30']);
});

test('removing and early-completing eggs is explicit, timestamped and auditable', () => {
  let r = make();
  r = adjustEggCount(r, { kind: 'removed', count: 2, reason: 'cracked', nowMs: NOW + H });
  r = adjustEggCount(r, { kind: 'completed', count: 3, nowMs: NOW + 2 * H });
  assert.equal(r.initialEggCount, 24); // initial count preserved
  assert.deepEqual(eggCounts(r), { known: true, initial: 24, active: 19, completed: 3, removed: 2, cancelled: 0 });
  assert.equal(r.eggAdjustments.length, 2);
  assert.deepEqual(
    { ...r.eggAdjustments[0] },
    { at: new Date(NOW + H).toISOString(), kind: 'removed', count: 2, reason: 'cracked', activeBefore: 24, activeAfter: 22 }
  );
  assert.equal(r.history.at(-2).action, 'eggs-removed');
  assert.match(r.history.at(-1).summary, /Completed 3 eggs — active eggs 22 → 19/);
  assert.equal(eggsAccountedFor(r), 5);
});

test('count changes are bounded by the active count and need an open batch', () => {
  const r = make();
  assert.throws(() => adjustEggCount(r, { kind: 'removed', count: 0, nowMs: NOW }), RangeError);
  assert.throws(() => adjustEggCount(r, { kind: 'removed', count: 25, nowMs: NOW }), /between 1 and 24/);
  assert.throws(() => adjustEggCount(r, { kind: 'removed', count: 1.5, nowMs: NOW }), RangeError);
  assert.throws(() => adjustEggCount(r, { kind: 'lost', count: 1, nowMs: NOW }), /Unknown/);
  const empty = adjustEggCount(r, { kind: 'removed', count: 24, nowMs: NOW });
  assert.equal(eggCounts(empty).active, 0);
  assert.throws(() => adjustEggCount(empty, { kind: 'removed', count: 1, nowMs: NOW }), /No active eggs/);
  const closed = cancelExperiment(r, { nowMs: NOW });
  assert.throws(() => adjustEggCount(closed, { kind: 'removed', count: 1, nowMs: NOW }), /open/);
});

test('editing cannot shrink the batch below eggs already accounted for', () => {
  const r = adjustEggCount(make(), { kind: 'removed', count: 12, nowMs: NOW });
  const v = validateExperimentInput({ ...recordToInput(r), eggCount: '11' }, { nowMs: NOW, minEggCount: eggsAccountedFor(r) });
  assert.match(v.errors.eggCount, /12 eggs have already been removed/);
  assert.ok(validateExperimentInput({ ...recordToInput(r), eggCount: '12' }, { nowMs: NOW, minEggCount: 12 }).ok);
});

test('batch completion, cancellation and reopening keep counts consistent', () => {
  const r = adjustEggCount(make(), { kind: 'removed', count: 4, nowMs: NOW });
  const target = Date.parse(r.targetAt);
  const done = completeExperiment(r, { nowMs: target, completedAtMs: target });
  assert.deepEqual(eggCounts(done), { known: true, initial: 24, active: 0, completed: 20, removed: 4, cancelled: 0 });
  assert.match(done.history.at(-1).summary, /20 remaining eggs counted as completed/);
  const cancelled = cancelExperiment(r, { nowMs: NOW });
  assert.deepEqual(eggCounts(cancelled), { known: true, initial: 24, active: 0, completed: 0, removed: 4, cancelled: 20 });
  const reopened = reopenExperiment(done, { nowMs: target + H });
  assert.equal(eggCounts(reopened).active, 20);
  for (const x of [r, done, cancelled, reopened]) assert.ok(sumsToInitial(eggCounts(x)));
});

test('totals count each batch once and exclude batches with unknown counts', () => {
  const a = adjustEggCount(make({}, 'a'), { kind: 'removed', count: 1, nowMs: NOW }); // 23 active
  const b = make({ experimentId: 'B-2', eggCount: '10', waitHours: '2' }, 'b'); // due today
  const planned = make({ experimentId: 'B-3', eggCount: '40', placementDate: '2026-10-27' }, 'p');
  const doneSrc = make({ experimentId: 'B-4', eggCount: '30', waitHours: '1' }, 'd');
  const done = completeExperiment(doneSrc, { nowMs: NOW + 2 * H, completedAtMs: NOW + H });
  const legacy = normalizeRecord({ ...make({ experimentId: 'B-5' }, 'l'), initialEggCount: undefined });
  const t = batchTotals([a, b, planned, done, legacy], NOW + 30 * 60_000);
  assert.equal(t.batches, 5);
  assert.equal(t.activeBatches, 3); // a, b, legacy
  assert.equal(t.plannedBatches, 1);
  assert.equal(t.completedBatches, 1);
  assert.equal(t.eggsActive, 33);
  assert.equal(t.eggsPlanned, 40);
  assert.equal(t.eggsCompleted, 30);
  assert.equal(t.eggsRemoved, 1);
  assert.equal(t.eggsInitial, 24 + 10 + 40 + 30);
  assert.equal(t.eggsDueToday, 10);
  assert.equal(t.unknownEggBatches, 1);
  assert.equal(t.eggsInitial, t.eggsActive + t.eggsPlanned + t.eggsCompleted + t.eggsRemoved + t.eggsCancelled);
});

test('storage and backup import migrate legacy records', async () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  const legacy = { ...make() };
  delete legacy.initialEggCount;
  delete legacy.eggAdjustments;
  data.set('embryotime.experiments.v1', JSON.stringify({ schemaVersion: 1, experiments: [legacy] }));
  const [loaded] = await createLocalRepository(storage).list();
  assert.equal(loaded.initialEggCount, null);
  assert.deepEqual(loaded.eggAdjustments, []);
  assert.equal(validateImportedRecords([legacy])[0].initialEggCount, null);
});

test('CSV and calendar export include egg counts', () => {
  const r = adjustEggCount(make(), { kind: 'removed', count: 2, nowMs: NOW });
  const csv = experimentsToCsv([r], NOW);
  const [header, row] = csv.replace('﻿', '').split('\r\n');
  const cols = header.split(',');
  const cells = row.split(',');
  const at = (name) => cells[cols.indexOf(name)];
  assert.equal(at('Initial eggs'), '24');
  assert.equal(at('Active eggs'), '22');
  assert.equal(at('Removed eggs'), '2');
  assert.equal(at('Completed eggs'), '0');
  assert.match(buildIcs(r, { nowMs: NOW }).replace(/\r\n /g, ''), /Eggs: 22 active of 24/);
});
