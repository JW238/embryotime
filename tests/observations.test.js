import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HH_STAGES, estimateStage, formatReferenceAge, getStage } from '../src/hh-stages.js';
import {
  DuplicateObservationError,
  addObservation,
  completeExperiment,
  createExperiment,
  estimateStageAt,
  incubationAgeAt,
  normalizeRecord,
  observationsByTime,
  validateExperimentInput,
  validateObservation,
} from '../src/experiment.js';
import { BADGES, badgeProgress, countObservations, createBadgeStore, syncUnlocks } from '../src/badges.js';
import { createLocalRepository } from '../src/storage.js';

const TZ = 'America/Toronto';
const NOW = Date.parse('2026-10-26T17:30:00Z'); // 13:30 EDT
const H = 3600_000;
const M = 60_000;

function make(overrides = {}, uid = 'u1') {
  const v = validateExperimentInput(
    {
      experimentId: overrides.experimentId ?? 'B-1',
      name: 'Batch',
      batchId: 'S1',
      eggCount: overrides.eggCount ?? '24',
      currentHours: overrides.currentHours ?? '48',
      placementDate: '2026-10-26',
      placementTime: '13:20',
      timeZone: TZ,
      waitHours: '36',
      reminderOffsets: [30],
    },
    { nowMs: NOW }
  );
  assert.ok(v.ok, JSON.stringify(v.errors));
  return { ...createExperiment(v.value, { nowMs: NOW, uid }), demo: Boolean(overrides.demo) };
}
const placed = (r) => Date.parse(r.placementAt);

// ---------- reference table ----------

test('reference table: stages 1–46, HH1 without an age, ages converted from the source', () => {
  assert.equal(HH_STAGES.length, 46);
  assert.deepEqual(HH_STAGES.map((s) => s.stage), Array.from({ length: 46 }, (_, i) => i + 1));
  assert.equal(getStage(1).minHours, null);
  assert.deepEqual([getStage(2).minHours, getStage(2).maxHours], [6, 7]);
  assert.deepEqual([getStage(17).minHours, getStage(17).maxHours], [52, 64]);
  assert.deepEqual([getStage(18).minHours, getStage(18).maxHours], [72, 72]); // 3 da
  assert.deepEqual([getStage(46).minHours, getStage(46).maxHours], [480, 504]); // 20–21 da
  assert.equal(formatReferenceAge(getStage(19)), '3–3.5 d');
  assert.equal(formatReferenceAge(getStage(10)), '33–38 h');
  assert.equal(formatReferenceAge(getStage(1)), 'no age listed');
  for (const s of HH_STAGES) if (s.minHours !== null) assert.ok(s.minHours <= s.maxHours, `HH${s.stage}`);
});

test('estimates use only listed ages: within, overlapping, gaps, before first, beyond last', () => {
  const at = (h) => estimateStage(h * 60);
  assert.deepEqual(at(36).stages, [10, 10]);
  assert.equal(at(36).method, 'within');
  assert.deepEqual(at(50).stages, [13, 15]); // overlapping reference ranges
  assert.deepEqual(at(52).stages, [13, 17]);
  assert.deepEqual(at(39).stages, [10, 11]); // gap 38–40 h
  assert.equal(at(39).method, 'between');
  assert.deepEqual(at(68).stages, [17, 18]); // gap 64–72 h
  assert.deepEqual(at(3).stages, [1, 2]);
  assert.equal(at(3).method, 'before-first');
  assert.deepEqual(at(84).stages, [19, 22]); // 3.5 d is listed for HH19, 20, 21 and 22
  assert.equal(at(600).method, 'beyond');
  assert.match(at(600).label, /beyond the reference ages/);
  assert.equal(at(36).referenceVersion, 'HH1951/UNSW-2026-10-26');
  assert.throws(() => estimateStage(-1));
});

// ---------- observations ----------

test('incubation age at observation = age at placement + time since placement', () => {
  const r = make(); // 48 h at placement
  assert.equal(incubationAgeAt(r, placed(r) + 2 * H), 50 * 60);
  assert.deepEqual(estimateStageAt(r, placed(r) + 2 * H).stages, [13, 15]);
});

test('three observation states; observed stage stored separately from the estimate', () => {
  let r = make();
  const t = placed(r) + 2 * H; // 50 h → HH13–HH15
  r = addObservation(r, { observedAtMs: t, verdict: 'match', observedStage: 14, note: 'clear' }, { nowMs: t + M, id: 'o1' });
  r = addObservation(r, { observedAtMs: t + H, verdict: 'different', observedStage: 12 }, { nowMs: t + H, id: 'o2' });
  r = addObservation(r, { observedAtMs: t + 2 * H, verdict: 'unconfirmed', observedStage: null, note: 'opaque shell' }, { nowMs: t + 2 * H, id: 'o3' });
  const [a, b, c] = r.observations;
  assert.deepEqual([a.verdict, a.observedStage, a.estimate.label], ['match', 14, 'HH13–HH15']);
  assert.deepEqual([b.verdict, b.observedStage, b.estimate.stages], ['different', 12, [13, 16]]);
  assert.deepEqual([c.verdict, c.observedStage], ['unconfirmed', null]); // no invented stage
  assert.equal(c.estimate.label.startsWith('HH'), true); // estimate kept as an estimate
  assert.equal(a.observedAt, new Date(t).toISOString());
  assert.equal(a.recordedAt, new Date(t + M).toISOString());
  assert.equal(a.ageMinutes, 50 * 60);
  assert.equal(r.history.filter((h) => h.action === 'observation').length, 3);
  assert.match(r.history.at(-3).summary, /observed HH14 \(matches estimate\)/);
});

test('observation validation: future, before placement, contradictory answers', () => {
  const r = make();
  const t = placed(r) + 2 * H;
  const v = (input) => validateObservation(r, { observedAtMs: t, note: '', ...input }, { nowMs: t });
  assert.ok(v({ observedAtMs: t + H, verdict: 'unconfirmed' }).errors.observedAt);
  assert.ok(v({ observedAtMs: placed(r) - M, verdict: 'unconfirmed' }).errors.observedAt);
  assert.ok(v({ verdict: 'maybe' }).errors.verdict);
  assert.ok(v({ verdict: 'match', observedStage: null }).errors.observedStage);
  assert.match(v({ verdict: 'match', observedStage: 20 }).errors.observedStage, /outside the estimate/);
  assert.match(v({ verdict: 'different', observedStage: 14 }).errors.observedStage, /within the estimate/);
  assert.ok(v({ verdict: 'different', observedStage: 47 }).errors.observedStage);
  assert.ok(v({ verdict: 'unconfirmed', observedStage: 14 }).errors.observedStage);
  assert.ok(v({ verdict: 'different', observedStage: 11 }).ok);
  assert.throws(() => addObservation(r, { observedAtMs: t, verdict: 'match', observedStage: 30 }, { nowMs: t }), RangeError);
});

test('multiple observations over a batch lifetime; history and earlier entries are preserved', () => {
  let r = make();
  const t0 = placed(r);
  r = addObservation(r, { observedAtMs: t0 + 10 * H, verdict: 'unconfirmed', observedStage: null }, { nowMs: t0 + 10 * H, id: 'late' });
  r = addObservation(r, { observedAtMs: t0 + H, verdict: 'unconfirmed', observedStage: null }, { nowMs: t0 + 11 * H, id: 'early' });
  const first = r.observations[0];
  const target = Date.parse(r.targetAt);
  r = completeExperiment(r, { nowMs: target, completedAtMs: target });
  r = addObservation(r, { observedAtMs: target, verdict: 'different', observedStage: 26 }, { nowMs: target, id: 'final' });
  assert.equal(r.observations.length, 3);
  assert.equal(r.observations[0], first); // never rewritten
  assert.deepEqual(observationsByTime(r).map((o) => o.id), ['early', 'late', 'final']);
});

test('stored estimate snapshots are not recomputed when the reference changes', () => {
  let r = make();
  const t = placed(r) + 2 * H;
  r = addObservation(r, { observedAtMs: t, verdict: 'match', observedStage: 13 }, { nowMs: t });
  // Simulate an observation saved under an older reference version.
  const old = { ...r.observations[0], estimate: { ...r.observations[0].estimate, stages: [12, 13], label: 'HH12–HH13', referenceVersion: 'OLD' } };
  const reloaded = normalizeRecord({ ...r, observations: [old] });
  assert.equal(reloaded.observations[0].estimate.referenceVersion, 'OLD');
  assert.equal(reloaded.observations[0].estimate.label, 'HH12–HH13');
});

test('accidental duplicate observations are rejected', () => {
  let r = make();
  const t = placed(r) + 2 * H;
  const input = { observedAtMs: t, verdict: 'match', observedStage: 14 };
  r = addObservation(r, input, { nowMs: t });
  assert.throws(() => addObservation(r, { ...input, observedAtMs: t + 20_000 }, { nowMs: t + M }), DuplicateObservationError);
  // Same minute but a different answer is a different observation.
  assert.doesNotThrow(() => addObservation(r, { observedAtMs: t, verdict: 'unconfirmed', observedStage: null }, { nowMs: t }));
});

test('legacy records load with an empty observation list', async () => {
  const legacy = { ...make() };
  delete legacy.observations;
  const data = new Map([['embryotime.experiments.v1', JSON.stringify({ schemaVersion: 1, experiments: [legacy] })]]);
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  const [loaded] = await createLocalRepository(storage).list();
  assert.deepEqual(loaded.observations, []);
});

// ---------- badges ----------

test('badge counting: once per observation (not per egg), all answers equal, duplicates and demo excluded', () => {
  const t = (r) => placed(r) + 2 * H;
  let big = make({ eggCount: '50' }, 'big');
  big = addObservation(big, { observedAtMs: t(big), verdict: 'match', observedStage: 14 }, { nowMs: t(big) });
  let small = make({ eggCount: '10', experimentId: 'B-2' }, 'small');
  small = addObservation(small, { observedAtMs: t(small), verdict: 'different', observedStage: 11 }, { nowMs: t(small) });
  small = addObservation(small, { observedAtMs: t(small) + H, verdict: 'unconfirmed', observedStage: null }, { nowMs: t(small) + H });
  // An accidental duplicate that slipped into storage (e.g. a restored backup) counts once.
  const dupe = { ...small, observations: [...small.observations, { ...small.observations[0], id: 'copy' }] };
  let demo = make({ demo: true, experimentId: 'D-1' }, 'demo');
  demo = addObservation(demo, { observedAtMs: t(demo), verdict: 'match', observedStage: 13 }, { nowMs: t(demo) });
  assert.equal(countObservations([big, dupe, demo]), 3); // 50 eggs still = 1 observation
});

test('badge thresholds, progress and never-revoked unlocks', () => {
  assert.deepEqual(BADGES.map((b) => b.threshold), [1, 5, 20, 50]);
  assert.deepEqual(badgeProgress(0).next.threshold, 1);
  const p3 = badgeProgress(3);
  assert.equal(p3.next.threshold, 5);
  assert.equal(p3.remaining, 2);
  assert.equal(p3.fraction, 0.5); // (3-1)/(5-1)
  assert.equal(badgeProgress(50).next, null);
  assert.equal(badgeProgress(50).fraction, 1);

  let { state, newly } = syncUnlocks({ unlocked: {} }, 5, NOW);
  assert.deepEqual(newly.map((b) => b.id), ['first-look', 'careful-observer']);
  ({ state, newly } = syncUnlocks(state, 5, NOW + H));
  assert.deepEqual(newly, []); // no repeat unlocks
  ({ state, newly } = syncUnlocks(state, 0, NOW + 2 * H));
  assert.ok(state.unlocked['careful-observer']); // not revoked if records are deleted
  assert.equal(state.unlocked['first-look'], new Date(NOW).toISOString());
});

test('badge store is separate from experiment storage and tolerates bad data', () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const store = createBadgeStore(storage);
  assert.deepEqual(store.load(), { unlocked: {} });
  store.save({ unlocked: { 'first-look': '2026-10-26T00:00:00.000Z' } });
  assert.deepEqual([...data.keys()], ['embryotime.badges.v1']);
  data.set('embryotime.badges.v1', 'not json');
  assert.deepEqual(store.load(), { unlocked: {} });
});
