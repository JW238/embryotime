// CSV export of experiment records.

import { formatIsoLocal } from './time.js';
import {
  STATUS_LABEL,
  VERDICT_LABEL,
  activeObservations,
  displayName,
  effectiveStatus,
  eggCounts,
  formatTemperature,
  isOverdue,
  observationsByTime,
  retractionFor,
  windowOf,
  windowPhase,
} from './experiment.js';

/** Quote a cell; neutralise spreadsheet formula injection for free-text cells. */
export function csvCell(value, { text = false } = {}) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const hours = (minutes) => (minutes == null ? '' : (minutes / 60).toFixed(2).replace(/\.?0+$/, ''));
const local = (iso, tz) => (iso ? formatIsoLocal(Date.parse(iso), tz) : '');
const deltaMinutes = (a, b) => (a && b ? Math.round((Date.parse(a) - Date.parse(b)) / 60_000) : '');

export const CSV_COLUMNS = [
  ['Experiment ID', (r) => r.experimentId, true],
  ['Name', (r) => r.name, true],
  ['Batch/Sample ID', (r) => r.batchId, true],
  ['Initial eggs', (r) => eggCounts(r).initial ?? ''],
  ['Active eggs', (r) => eggCounts(r).active ?? ''],
  ['Completed eggs', (r) => eggCounts(r).completed ?? ''],
  ['Removed eggs', (r) => eggCounts(r).removed ?? ''],
  ['Cancelled eggs', (r) => eggCounts(r).cancelled ?? ''],
  ['Timing', (r) => (r.stagePlan ? 'stage-based (estimate)' : 'entered durations')],
  ['Start', (r) => r.stagePlan?.start ?? ''],
  ['Current HH stage', (r) => r.stagePlan?.currentStage ?? ''],
  ['Current stage basis', (r) => r.stagePlan?.currentStageBasis ?? ''],
  ['Baseline age min (h)', (r) => r.stagePlan?.baselineAgeHours[0] ?? ''],
  ['Baseline age max (h)', (r) => r.stagePlan?.baselineAgeHours[1] ?? ''],
  ['Target HH stage', (r) => r.stagePlan?.targetStage ?? ''],
  ['Estimated window start (local)', (r) => (windowOf(r) ? formatIsoLocal(windowOf(r).startMs, r.timeZone) : '')],
  ['Estimated window end (local)', (r) => (windowOf(r) ? formatIsoLocal(windowOf(r).endMs, r.timeZone) : '')],
  ['Estimated window start (UTC)', (r) => (windowOf(r) ? new Date(windowOf(r).startMs).toISOString() : '')],
  ['Estimated window end (UTC)', (r) => (windowOf(r) ? new Date(windowOf(r).endMs).toISOString() : '')],
  ['Window state', (r, now) => ({ before: 'not yet open', in: 'in window', after: 'window passed' })[windowPhase(r, now)] ?? ''],
  ['Planned return', (r) => r.stagePlan?.plannedReturn ?? ''],
  ['Reference version', (r) => r.stagePlan?.referenceVersion ?? ''],
  ['Incubation temperature', (r) => (r.temperature ? formatTemperature(r.temperature) : '')],
  ['Observations (active)', (r) => activeObservations(r).length],
  ['Observations retracted', (r) => (r.retractions ?? []).length],
  ['Status', (r, now) => STATUS_LABEL[effectiveStatus(r, now)]],
  ['Overdue or window passed', (r, now) => (isOverdue(r, now) ? 'yes' : 'no')],
  ['Time zone', (r) => r.timeZone],
  ['Incubation at placement (h)', (r) => hours(r.currentIncubationMinutes)],
  ['Placement (local)', (r) => local(r.placementAt, r.timeZone)],
  ['Placement (UTC)', (r) => r.placementAt],
  ['Waiting duration (h)', (r) => hours(r.waitMinutes)],
  ['Original target (local)', (r) => local(r.originalTargetAt, r.timeZone)],
  ['Original target (UTC)', (r) => r.originalTargetAt],
  ['Current target (local)', (r) => local(r.targetAt, r.timeZone)],
  ['Current target (UTC)', (r) => r.targetAt],
  ['Projected total incubation (h)', (r) => hours(r.currentIncubationMinutes + r.waitMinutes)],
  ['Reminders (min before)', (r) => (r.reminderOffsets ?? []).join(' ')],
  ['Actual completion (local)', (r) => local(r.completedAt, r.timeZone)],
  ['Actual completion (UTC)', (r) => r.completedAt ?? ''],
  ['Completion vs target (min, + = late)', (r) => deltaMinutes(r.completedAt, r.targetAt)],
  ['Completion note', (r) => r.completionNote, true],
  ['Cancel reason', (r) => r.cancelReason, true],
  ['Conditions', (r) => r.conditions, true],
  ['Notes', (r) => r.notes, true],
  ['Created (UTC)', (r) => r.createdAt],
  ['Updated (UTC)', (r) => r.updatedAt],
  ['Demo data', (r) => (r.demo ? 'yes' : 'no')],
];

/** Returns CSV text with a UTF-8 BOM so spreadsheet apps detect the encoding. */
export function experimentsToCsv(records, nowMs) {
  const header = CSV_COLUMNS.map(([label]) => csvCell(label)).join(',');
  const rows = records.map((r) => CSV_COLUMNS.map(([, get, text]) => csvCell(get(r, nowMs), { text })).join(','));
  return '﻿' + [header, ...rows].join('\r\n') + '\r\n';
}

// ---------- one row per observation ----------
// Retracted observations ARE included (for the audit trail) and marked in "Retracted" with the
// time and reason. Estimated stages are always in "Estimated stage (estimate)" columns and never
// in "Observed stage".

const ANSWER = { match: 'matches estimate', different: 'differs from estimate', unconfirmed: 'unable to confirm', baseline: 'observed at setup' };

export const OBSERVATION_COLUMNS = [
  ['Batch record ID', (r) => r.experimentId, true],
  ['Batch name', (r) => displayName(r), true],
  ['Observation ID', (r, o) => o.id, true],
  ['Observed at (local)', (r, o) => local(o.observedAt, r.timeZone)],
  ['Observed at (UTC)', (r, o) => o.observedAt],
  ['Recorded at (UTC)', (r, o) => o.recordedAt],
  ['Time zone', (r) => r.timeZone],
  ['Time since placement (h)', (r, o) => hours(o.elapsedMinutes ?? Math.max(0, Math.round((Date.parse(o.observedAt) - Date.parse(r.placementAt)) / 60_000)))],
  ['Estimated incubation age min (h)', (r, o) => hours((o.ageRangeMinutes ?? [o.ageMinutes])[0])],
  ['Estimated incubation age max (h)', (r, o) => hours((o.ageRangeMinutes ?? [o.ageMinutes, o.ageMinutes])[1])],
  ['Estimated stage (estimate)', (r, o) => o.estimate?.label ?? ''],
  ['Estimated stage min', (r, o) => o.estimate?.stages?.[0] ?? ''],
  ['Estimated stage max', (r, o) => o.estimate?.stages?.[1] ?? ''],
  ['Reference version', (r, o) => o.estimate?.referenceVersion ?? ''],
  ['Answer', (r, o) => ANSWER[o.verdict] ?? o.verdict],
  ['Answer (full)', (r, o) => VERDICT_LABEL[o.verdict] ?? ''],
  ['Observed stage', (r, o) => (o.observedStage === null || o.observedStage === undefined ? '' : o.observedStage)],
  ['Observation status', (r, o) => (retractionFor(r, o.id) ? 'retracted' : 'active')],
  ['Source', (r, o) => o.source ?? 'manual'],
  ['Temperature', (r, o) => (o.temperature ? formatTemperature(o.temperature) : r.temperature ? `${formatTemperature(r.temperature)} (batch)` : '')],
  ['Note', (r, o) => o.note, true],
  ['Retracted', (r, o) => (retractionFor(r, o.id) ? 'yes' : 'no')],
  ['Retracted at (UTC)', (r, o) => retractionFor(r, o.id)?.at ?? ''],
  ['Retraction reason', (r, o) => retractionFor(r, o.id)?.reason ?? '', true],
  ['Demo data', (r) => (r.demo ? 'yes' : 'no')],
];

export function observationsToCsv(records) {
  const header = OBSERVATION_COLUMNS.map(([label]) => csvCell(label)).join(',');
  const rows = [];
  for (const r of records) {
    for (const o of observationsByTime(r)) {
      rows.push(OBSERVATION_COLUMNS.map(([, get, text]) => csvCell(get(r, o), { text })).join(','));
    }
  }
  return '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n';
}
