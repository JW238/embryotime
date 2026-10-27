// Audit trail (retractions), observation CSV, strict backup validation, backup health.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeObservations,
  addObservation,
  createExperiment,
  isRetracted,
  parseTemperature,
  retractObservation,
  temperatureNotice,
  validateExperimentInput,
} from '../src/experiment.js';
import { countObservations } from '../src/badges.js';
import { observationsToCsv } from '../src/csv.js';
import { findConflicts } from '../src/ui/stage-chart.js';
import {
  backupStatus,
  buildBackup,
  createBackupMetaStore,
  savePreRestoreCopy,
  validateBackup,
} from '../src/storage.js';

const TZ = 'America/Toronto';
const NOW = Date.parse('2026-10-27T00:15:00Z');
const H = 3600_000;

function batch(o = {}, uid = 'u1') {
  const v = validateExperimentInput(
    {
      experimentId: o.experimentId ?? 'EXP-1',
      name: o.name ?? 'Batch "A", series 1',
      eggCount: '24',
      timingMode: 'stage',
      start: 'stage',
      currentStage: '10',
      targetStage: '12',
      plannedReturn: 'none',
      placementDate: '2026-10-26',
      placementTime: '10:00',
      timeZone: TZ,
      reminderOffsets: [],
      temperatureValue: o.temperatureValue ?? '',
      temperatureUnit: 'C',
    },
    { nowMs: NOW }
  );
  assert.ok(v.ok, JSON.stringify(v.errors));
  return createExperiment(v.value, { nowMs: NOW, uid });
}
const at = (r, h) => Date.parse(r.placementAt) + h * H;

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, embedded newlines). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------- retractions ----------

test('retraction needs a reason, keeps the original, and is append-only', () => {
  let r = batch();
  r = addObservation(r, { observedAtMs: at(r, 2), verdict: 'different', observedStage: 13, note: 'typo' }, { nowMs: NOW, id: 'o1' });
  const original = r.observations[0];
  assert.throws(() => retractObservation(r, 'o1', { reason: '  ', nowMs: NOW }), /reason is required/);
  assert.throws(() => retractObservation(r, 'nope', { reason: 'x', nowMs: NOW }), /does not exist/);
  const x = retractObservation(r, 'o1', { reason: 'Entered the wrong stage', nowMs: NOW + H });
  assert.equal(x.observations[0], original); // untouched
  assert.equal(isRetracted(x, 'o1'), true);
  assert.deepEqual(x.retractions, [{ observationId: 'o1', at: new Date(NOW + H).toISOString(), reason: 'Entered the wrong stage' }]);
  assert.equal(x.history.at(-1).action, 'observation-retracted');
  assert.throws(() => retractObservation(x, 'o1', { reason: 'again', nowMs: NOW }), /already been retracted/);
});

test('retracted observations leave badges, conflicts and duplicate checks but stay in the audit trail', () => {
  let r = batch();
  r = addObservation(r, { observedAtMs: at(r, 2), verdict: 'different', observedStage: 13 }, { nowMs: NOW, id: 'o1' });
  r = addObservation(r, { observedAtMs: at(r, 2.5), verdict: 'different', observedStage: 14 }, { nowMs: NOW, id: 'o2' });
  assert.equal(countObservations([r]), 2);
  assert.equal(findConflicts(r).length, 1);
  r = retractObservation(r, 'o1', { reason: 'wrong batch', nowMs: NOW });
  assert.equal(countObservations([r]), 1);
  assert.deepEqual(activeObservations(r).map((o) => o.id), ['o2']);
  assert.equal(findConflicts(r).length, 0);
  assert.equal(r.observations.length, 2);
  // The corrected observation can be recorded again at the same minute after a retraction.
  assert.doesNotThrow(() => addObservation(r, { observedAtMs: at(r, 2), verdict: 'different', observedStage: 13 }, { nowMs: NOW, id: 'o3' }));
});

// ---------- temperature ----------

test('temperature is optional, keeps its unit, rejects typos, and never changes estimates', () => {
  assert.deepEqual(parseTemperature('', 'C'), { ok: true, temperature: null });
  assert.deepEqual(parseTemperature('37.5', 'C'), { ok: true, temperature: { value: 37.5, unit: 'C' } });
  assert.deepEqual(parseTemperature('99.5', 'F'), { ok: true, temperature: { value: 99.5, unit: 'F' } });
  assert.equal(parseTemperature('375', 'C').ok, false);
  assert.equal(parseTemperature('abc', 'C').ok, false);
  const warm = batch({ temperatureValue: '39' }, 'w');
  const plain = batch({}, 'p');
  assert.deepEqual(warm.temperature, { value: 39, unit: 'C' });
  assert.deepEqual(warm.stagePlan.windowHours, plain.stagePlan.windowHours);
  assert.match(temperatureNotice(warm.temperature), /not adjusted/);
  assert.equal(temperatureNotice(null), null);
});

// ---------- observation CSV ----------

test('observation CSV: one row per observation, retracted rows marked, estimate never in the observed column', () => {
  let r = batch();
  r = addObservation(r, { observedAtMs: at(r, 2), verdict: 'unconfirmed', observedStage: null, note: 'line1\nline2, "quoted"' }, { nowMs: NOW, id: 'o1' });
  r = addObservation(r, { observedAtMs: at(r, 3), verdict: 'different', observedStage: 14, note: '=HYPERLINK("x")', temperature: { value: 37.8, unit: 'C' } }, { nowMs: NOW, id: 'o2' });
  r = retractObservation(r, 'o2', { reason: 'wrong egg tray', nowMs: NOW });
  const csv = observationsToCsv([r]);
  assert.ok(csv.startsWith('\uFEFFBatch record ID,Batch name,Observation ID,'));
  const [header, ...rows] = parseCsv(csv.replace('\uFEFF', ''));
  assert.equal(rows.length, 2);
  const get = (row, n) => row[header.indexOf(n)];
  const [r1, r2] = rows;
  assert.equal(get(r1, 'Batch name'), 'Batch "A", series 1');
  assert.equal(get(r1, 'Note'), 'line1\nline2, "quoted"');
  assert.equal(get(r1, 'Observed stage'), '');
  assert.equal(get(r1, 'Answer'), 'unable to confirm');
  assert.equal(get(r1, 'Observation status'), 'active');
  assert.equal(get(r2, 'Observation ID'), 'o2');
  assert.equal(get(r2, 'Note'), "'=HYPERLINK(\"x\")");
  assert.equal(get(r2, 'Observed stage'), '14');
  assert.equal(get(r2, 'Observation status'), 'retracted');
  assert.equal(get(r2, 'Retracted'), 'yes');
  assert.equal(get(r2, 'Retraction reason'), 'wrong egg tray');
  assert.equal(get(r2, 'Temperature'), '37.8 °C');
  assert.match(get(r2, 'Estimated stage (estimate)'), /^HH1[0-3]/);
});

// ---------- backup validation ----------

const good = () => buildBackup([batch()], NOW);

test('a backup written by this version validates and round-trips', () => {
  const v = validateBackup(JSON.parse(JSON.stringify(good())));
  assert.equal(v.ok, true, v.errors.join('\n'));
  assert.equal(v.format, 'v2');
  assert.equal(v.records.length, 1);
});

test('older formats are migrated explicitly without inventing scientific data', () => {
  const legacy = { ...batch() };
  delete legacy.initialEggCount;
  delete legacy.observations;
  delete legacy.retractions;
  delete legacy.stagePlan;
  delete legacy.temperature;
  for (const data of [[legacy], { schemaVersion: 1, experiments: [legacy] }, { app: 'EmbryoTime', exportedAt: '2026-10-26T00:00:00Z', experiments: [legacy] }]) {
    const v = validateBackup(JSON.parse(JSON.stringify(data)));
    assert.equal(v.ok, true, v.errors.join('\n'));
    assert.equal(v.records[0].initialEggCount, null);
    assert.deepEqual(v.records[0].observations, []);
    assert.equal(v.records[0].temperature, null);
  }
});

test('malformed or inconsistent backups are rejected as a whole with actionable messages', () => {
  const mutate = (fn) => {
    const d = JSON.parse(JSON.stringify(good()));
    fn(d, d.experiments[0]);
    return validateBackup(d);
  };
  const cases = [
    [(d) => (d.version = 9), /Unsupported backup version 9/],
    [(d) => (d.experiments = []), /no experiments/],
    [(d, r) => delete r.uid, /missing "uid"/],
    [(d, r) => d.experiments.push({ ...r }), /duplicate uid/],
    [(d, r) => d.experiments.push({ ...r, uid: 'other' }), /duplicate experiment ID/],
    [(d, r) => (r.placementAt = 'yesterday'), /"placementAt" is not a valid timestamp/],
    [(d, r) => (r.timeZone = 'Mars/Base'), /time zone "Mars\/Base"/],
    [(d, r) => (r.status = 'paused'), /status "paused"/],
    [(d, r) => (r.initialEggCount = 500), /egg count/],
    [(d, r) => (r.eggAdjustments = [{ kind: 'removed', count: 30, at: r.createdAt }]), /exceed the number of eggs/],
    [(d, r) => (r.currentIncubationMinutes = -5), /currentIncubationMinutes/],
    [(d, r) => (r.stagePlan.targetStage = 99), /invalid target stage/],
    [(d, r) => (r.stagePlan.targetStage = 9), /not later than the current stage/],
    [(d, r) => (r.stagePlan.windowHours = [16, 7]), /invalid window/],
    [(d, r) => (r.stagePlan.baselineAgeHours = [38, 33]), /starting-age range/],
    [(d, r) => (r.stagePlan.plannedReturn = 'whenever'), /planned-return/],
    [(d, r) => (r.observations = [{ id: 'a', observedAt: r.placementAt, verdict: 'different', observedStage: 60, estimate: { stages: [10, 12], referenceVersion: 'x' } }]), /invalid observed stage/],
    [(d, r) => (r.observations = [{ id: 'a', observedAt: r.placementAt, verdict: 'unconfirmed', observedStage: null, estimate: { stages: [12, 10], referenceVersion: 'x' } }]), /estimate snapshot/],
    [(d, r) => (r.retractions = [{ observationId: 'ghost', at: r.createdAt, reason: 'x' }]), /does not exist/],
    [(d, r) => (r.temperature = { value: 'hot', unit: 'C' }), /temperature/],
  ];
  for (const [fn, re] of cases) {
    const v = mutate(fn);
    assert.equal(v.ok, false, `expected failure for ${re}`);
    assert.deepEqual(v.records, []); // nothing partial
    assert.ok(v.errors.some((e) => re.test(e)), `${re} not in: ${v.errors.join(' | ')}`);
  }
  assert.equal(validateBackup('just text').ok, false);
  assert.equal(validateBackup({ nothing: true }).ok, false);
});

test('a backup ID that clashes with a different local batch is rejected', () => {
  const local = { ...batch(), uid: 'someone-else' };
  const v = validateBackup(JSON.parse(JSON.stringify(good())), { existing: [local] });
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /already used by a different batch/);
  // Same uid = restoring the same batch: allowed.
  assert.equal(validateBackup(JSON.parse(JSON.stringify(good())), { existing: [batch()] }).ok, true);
});

test('a copy of current data is kept before a restore', () => {
  const data = new Map();
  const storage = { setItem: (k, v) => data.set(k, v) };
  const key = savePreRestoreCopy([batch()], NOW, storage);
  assert.match(key, /^embryotime\.experiments\.v1\.pre-restore-2026-10-27T00:15:00\.000Z$/);
  assert.equal(JSON.parse(data.get(key)).experiments.length, 1);
});

// ---------- backup health ----------

test('backup status: none, recent, changed since, stale — never claims a saved file', () => {
  const r = batch();
  assert.equal(backupStatus(null, [], NOW).state, 'empty');
  assert.equal(backupStatus(null, [r], NOW).state, 'none');
  const meta = { lastDownloadStartedAt: new Date(NOW + H).toISOString() };
  assert.equal(backupStatus(meta, [r], NOW + 2 * H).state, 'recent');
  assert.equal(backupStatus(meta, [{ ...r, updatedAt: new Date(NOW + 3 * H).toISOString() }], NOW + 4 * H).state, 'changed');
  assert.equal(backupStatus(meta, [r], NOW + 9 * 86_400_000).state, 'stale');
  assert.equal(backupStatus(meta, [r], NOW + 2 * 86_400_000, 1).state, 'stale');
  const data = new Map();
  const store = createBackupMetaStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) });
  assert.equal(store.load(), null);
  store.recordDownload(NOW, 3);
  assert.equal(store.load().recordCount, 3);
});
