// Clearly labelled demo records, generated relative to the current time.

import { adjustEggCount, createExperiment, completeExperiment, validateExperimentInput } from './experiment.js';
import { MS_PER_HOUR, instantToWallInputs } from './time.js';

export function buildDemoExperiments(nowMs, timeZone) {
  const specs = [
    { id: 'DEMO-001', name: '[DEMO] Core scenario: 48 h egg + 36 h wait', batch: 'DEMO-B1', eggs: 24, cur: 48, wait: 36, placedHoursAgo: 3, removed: 1 },
    { id: 'DEMO-002', name: '[DEMO] Short follow-up check', batch: 'DEMO-B1', eggs: 20, cur: 72, wait: 6, placedHoursAgo: 2 },
    { id: 'DEMO-003', name: '[DEMO] Overdue example', batch: 'DEMO-B2', eggs: 30, cur: 24, wait: 12, placedHoursAgo: 13 },
    { id: 'DEMO-004', name: '[DEMO] Planned placement tomorrow', batch: 'DEMO-B2', eggs: 40, cur: 0, wait: 48, placedHoursAgo: -20 },
    { id: 'DEMO-005', name: '[DEMO] Completed example', batch: 'DEMO-B3', eggs: 36, cur: 60, wait: 24, placedHoursAgo: 30, completeLateMin: 12 },
  ];
  const records = specs.map((s) => {
    const placement = instantToWallInputs(nowMs - s.placedHoursAgo * MS_PER_HOUR, timeZone);
    const v = validateExperimentInput(
      {
        experimentId: s.id,
        name: s.name,
        batchId: s.batch,
        eggCount: String(s.eggs),
        currentHours: String(s.cur),
        placementDate: placement.date,
        placementTime: placement.time,
        timeZone,
        waitHours: String(s.wait),
        reminderOffsets: [30, 120],
        notes: 'Demo data — not a real experiment.',
        conditions: '',
      },
      { nowMs }
    );
    if (!v.ok) throw new Error(`Demo record ${s.id} is invalid: ${JSON.stringify(v.errors)}`);
    let record = createExperiment(v.value, { nowMs: nowMs - Math.max(0, s.placedHoursAgo) * MS_PER_HOUR, demo: true });
    if (s.removed) {
      record = adjustEggCount(record, { kind: 'removed', count: s.removed, reason: 'Demo: example of an audited count change', nowMs });
    }
    if (s.completeLateMin !== undefined) {
      record = completeExperiment(record, { nowMs, completedAtMs: Date.parse(record.targetAt) + s.completeLateMin * 60_000 });
    }
    return record;
  });
  // A stage-based example: freshly set eggs → HH19, tracked as an estimated window.
  const placed = instantToWallInputs(nowMs - 30 * MS_PER_HOUR, timeZone);
  const v = validateExperimentInput(
    {
      experimentId: 'DEMO-006',
      name: '[DEMO] Stage-based window (fresh eggs → HH19)',
      nameIsDefault: false,
      eggCount: '24',
      timingMode: 'stage',
      start: 'fresh',
      targetStage: 19,
      plannedReturn: 'none',
      placementDate: placed.date,
      placementTime: placed.time,
      timeZone,
      reminderOffsets: [],
      notes: 'Demo data — not a real experiment.',
    },
    { nowMs }
  );
  if (!v.ok) throw new Error(`Demo record DEMO-006 is invalid: ${JSON.stringify(v.errors)}`);
  return [...records, createExperiment(v.value, { nowMs: nowMs - 30 * MS_PER_HOUR, demo: true })];
}
