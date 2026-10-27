// CSV export of experiment records.

import { formatIsoLocal } from './time.js';
import { STATUS_LABEL, effectiveStatus, eggCounts, isOverdue } from './experiment.js';

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
  ['Status', (r, now) => STATUS_LABEL[effectiveStatus(r, now)]],
  ['Overdue', (r, now) => (isOverdue(r, now) ? 'yes' : 'no')],
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
