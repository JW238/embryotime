import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExperiment, validateExperimentInput } from '../src/experiment.js';
import { buildIcs, escapeIcsText, foldLine, icsFileName, reminderTrigger, toIcsUtc } from '../src/ics.js';
import { csvCell, experimentsToCsv } from '../src/csv.js';
import { StorageError, createLocalRepository, validateImportedRecords } from '../src/storage.js';

const NOW = Date.parse('2026-10-26T17:30:00Z');

function make(overrides = {}) {
  const v = validateExperimentInput(
    {
      experimentId: 'EXP-1',
      name: 'Core, scenario; test',
      batchId: 'B1',
      eggCount: '24',
      currentHours: '48',
      placementDate: '2026-10-26',
      placementTime: '13:20',
      timeZone: 'America/Toronto',
      waitHours: '36',
      reminderOffsets: [30, 120, 1440],
      notes: '第一行\n=SUM(A1)',
      conditions: '',
      ...overrides,
    },
    { nowMs: NOW }
  );
  assert.ok(v.ok, JSON.stringify(v.errors));
  return createExperiment(v.value, { nowMs: NOW, uid: 'abc-123' });
}

// Unfold RFC 5545 content lines for easy assertions.
const unfold = (ics) => ics.replace(/\r\n /g, '');

test('ICS event uses the exact UTC instant of the zoned target', () => {
  const ics = buildIcs(make(), { nowMs: NOW });
  const text = unfold(ics);
  // 2026-10-28 01:20 EDT == 05:20Z
  assert.match(text, /\r\nDTSTART:20261028T052000Z\r\n/);
  assert.match(text, /\r\nDTEND:20261028T055000Z\r\n/);
  assert.match(text, /\r\nUID:abc-123@embryotime\.local\r\n/);
  assert.match(text, /\r\nDTSTAMP:20261026T173000Z\r\n/);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('ICS event in a zone across DST still targets the exact elapsed instant', () => {
  const ics = unfold(buildIcs(make({ placementDate: '2026-10-31', placementTime: '12:00' }), { nowMs: NOW }));
  // 12:00 EDT Oct 31 = 16:00Z, +36 h = 04:00Z Nov 2 (= 23:00 EST Nov 1)
  assert.match(ics, /DTSTART:20261102T040000Z/);
});

test('ICS includes ID, name, notes and one alarm per reminder', () => {
  const text = unfold(buildIcs(make(), { nowMs: NOW }));
  assert.match(text, /SUMMARY:\[EXP-1\] Lab return: Core\\, scenario\\; test/);
  assert.match(text, /DESCRIPTION:Experiment ID: EXP-1\\nName:/);
  assert.match(text, /第一行/);
  assert.equal((text.match(/BEGIN:VALARM/g) ?? []).length, 3);
  assert.match(text, /TRIGGER:-PT30M/);
  assert.match(text, /TRIGGER:-PT2H/);
  assert.match(text, /TRIGGER:-P1D/);
});

test('ICS without reminders has no alarms', () => {
  assert.doesNotMatch(buildIcs(make({ reminderOffsets: [] }), { nowMs: NOW }), /VALARM/);
});

test('ICS lines are folded to at most 75 octets without splitting characters', () => {
  const long = foldLine('DESCRIPTION:' + '胚'.repeat(60) + 'x'.repeat(100));
  const enc = new TextEncoder();
  for (const line of long.split('\r\n')) assert.ok(enc.encode(line).length <= 75, line);
  assert.equal(long.replace(/\r\n /g, ''), 'DESCRIPTION:' + '胚'.repeat(60) + 'x'.repeat(100));
  assert.doesNotMatch(long, /�/);
});

test('ICS helpers', () => {
  assert.equal(escapeIcsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  assert.equal(toIcsUtc('2026-01-02T03:04:05.678Z'), '20260102T030405Z');
  assert.equal(reminderTrigger(90), '-PT90M');
  assert.equal(icsFileName(make()), 'EXP-1-20261028T0520Z.ics');
});

test('CSV quoting and formula-injection guard', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)', { text: true }), "'=SUM(A1)");
  assert.equal(csvCell(null), '');
});

test('CSV export has header, BOM, local and UTC times', () => {
  const csv = experimentsToCsv([make()], NOW);
  assert.ok(csv.startsWith('﻿Experiment ID,Name,'));
  const lines = csv.trim().split('\r\n');
  assert.ok(lines.length >= 2);
  assert.match(csv, /2026-10-28 01:20/);
  assert.match(csv, /2026-10-28T05:20:00\.000Z/);
  assert.match(csv, /,84,/);
  assert.match(csv, /"第一行\n=SUM\(A1\)"/);
  assert.match(experimentsToCsv([make({ notes: '=HYPERLINK("x")' })], NOW), /"'=HYPERLINK\(""x""\)"/);
});

function fakeStorage() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

test('local repository round-trips records', async () => {
  const s = fakeStorage();
  const repo = createLocalRepository(s);
  assert.deepEqual(await repo.list(), []);
  const r = make();
  await repo.save(r);
  await repo.save({ ...r, name: 'renamed' });
  const all = await createLocalRepository(s).list();
  assert.equal(all.length, 1);
  assert.equal(all[0].name, 'renamed');
  await repo.remove(r.uid);
  assert.deepEqual(await repo.list(), []);
});

test('corrupt storage is preserved and reported, not overwritten', async () => {
  const s = fakeStorage();
  s.setItem('embryotime.experiments.v1', '{not json');
  await assert.rejects(createLocalRepository(s).list(), StorageError);
  assert.ok([...s.data.keys()].some((k) => k.includes('corrupt')));
  assert.equal(s.getItem('embryotime.experiments.v1'), '{not json');
});

test('storage write failures surface as StorageError', async () => {
  const s = fakeStorage();
  s.setItem = () => {
    throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
  };
  await assert.rejects(createLocalRepository(s).save(make()), /QuotaExceededError/);
});

test('import validation rejects malformed backups', () => {
  assert.throws(() => validateImportedRecords({}), StorageError);
  assert.throws(() => validateImportedRecords([{ uid: 'x' }]), /missing/);
  assert.equal(validateImportedRecords({ experiments: [make()] }).length, 1);
});
