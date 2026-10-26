import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeExperiment, cancelExperiment, createExperiment, validateExperimentInput } from '../src/experiment.js';
import { coopEggs, eggProgress, eggStage, greeting, henMessage, recentlyHatched, shellVariant } from '../src/hatchery.js';
import { coopDisplayName, createProfileStore } from '../src/storage.js';

const TZ = 'America/Toronto';
const NOW = Date.parse('2026-10-26T17:30:00Z'); // 13:30 EDT
const H = 3600_000;

function make(id, { date = '2026-10-26', time = '13:20', wait = '36', uid = id } = {}) {
  const v = validateExperimentInput(
    { experimentId: id, name: id, batchId: 'B', eggCount: '24', currentHours: '48', placementDate: date, placementTime: time, timeZone: TZ, waitHours: wait, reminderOffsets: [30] },
    { nowMs: NOW }
  );
  assert.ok(v.ok, JSON.stringify(v.errors));
  return createExperiment(v.value, { nowMs: NOW, uid });
}

test('new experiments live in the personal coop', () => {
  assert.equal(make('A').coopId, 'personal');
});

test('egg progress is clamped and proportional to elapsed waiting time', () => {
  const r = make('A'); // 13:20 EDT + 36 h
  const start = Date.parse(r.placementAt);
  assert.equal(eggProgress(r, start - H), 0);
  assert.equal(eggProgress(r, start + 18 * H), 0.5);
  assert.equal(eggProgress(r, start + 100 * H), 1);
});

test('egg stages follow the schedule', () => {
  const r = make('A');
  const target = Date.parse(r.targetAt);
  assert.equal(eggStage(make('P', { date: '2026-10-27' }), NOW), 'planned');
  assert.equal(eggStage(r, NOW), 'warming');
  assert.equal(eggStage(r, target - 30 * 60_000), 'almost');
  assert.equal(eggStage(r, target), 'due');
  assert.equal(eggStage(completeExperiment(r, { nowMs: target, completedAtMs: target }), target), 'hatched');
  assert.equal(eggStage(cancelExperiment(r, { nowMs: NOW }), NOW), 'cancelled');
});

test('coop shows open eggs sorted by target; hatched shelf shows recent completions', () => {
  const late = make('LATE', { wait: '48' });
  const soon = make('SOON', { wait: '2' });
  const done = completeExperiment(make('DONE', { wait: '1' }), { nowMs: NOW + 2 * H, completedAtMs: NOW + H });
  const old = { ...done, uid: 'OLD', completedAt: new Date(NOW - 30 * 86_400_000).toISOString() };
  const legacy = { ...make('LEGACY'), coopId: undefined }; // records saved before coops existed
  const all = [late, soon, done, old, legacy];
  assert.deepEqual(coopEggs(all).map((r) => r.experimentId), ['SOON', 'LEGACY', 'LATE']);
  assert.deepEqual(recentlyHatched(all, NOW + 3 * H).map((r) => r.uid), ['DONE']);
  assert.deepEqual(coopEggs(all, 'other-coop'), []);
});

test('hen message: empty, next check, heads-up, overdue, just laid', () => {
  assert.equal(henMessage([], NOW).mood, 'idle');
  const r = make('EXP-1');
  const target = Date.parse(r.targetAt);
  const idle = henMessage([r], NOW);
  assert.equal(idle.mood, 'idle');
  assert.match(idle.text, /EXP-1/);
  assert.match(idle.text, /Oct 28, 2026, 01:20 EDT/);
  assert.match(idle.text, /in 1 d 11 h/);
  assert.match(henMessage([r], target - 20 * 60_000).text, /due at 01:20 — in 20 min/);
  const alert = henMessage([r, make('EXP-2', { wait: '1' })], target + 2 * H);
  assert.equal(alert.mood, 'alert');
  assert.match(alert.text, /EXP-2 passed its target/);
  assert.match(alert.text, /\+1 more overdue/);
  assert.equal(henMessage([r], NOW, { justLaidUid: r.uid }).mood, 'happy');
});

test('greeting and shell variant are deterministic', () => {
  assert.equal(greeting(NOW, TZ), 'Good afternoon');
  assert.equal(greeting(Date.parse('2026-10-26T13:00:00Z'), TZ), 'Good morning');
  assert.equal(shellVariant('abc'), shellVariant('abc'));
  assert.ok([0, 1, 2].includes(shellVariant('xyz')));
});

test('profile store: defaults, trimming, corrupt data, coop name', () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const store = createProfileStore(storage);
  assert.deepEqual(store.load(), { researcherName: '', coopName: '' });
  store.save({ researcherName: '  Ada  ', coopName: '' });
  assert.equal(store.load().researcherName, 'Ada');
  assert.equal(coopDisplayName(store.load()), "Ada's coop");
  assert.equal(coopDisplayName({ researcherName: 'J', coopName: 'Bench 3' }), 'Bench 3');
  assert.equal(coopDisplayName({ researcherName: '', coopName: '' }), 'My coop');
  data.set('embryotime.profile.v1', '{bad');
  assert.deepEqual(store.load(), { researcherName: '', coopName: '' });
});
