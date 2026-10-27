// Pure presentation logic for the hatchery home screen: egg stages, progress and the
// hen's status message. Arithmetic only — stages describe the schedule, not the embryo.

import { DEFAULT_COOP_ID, STATUS, byTarget, displayName, isOpen, isOverdue, windowOf, windowPhase } from './experiment.js';
import { formatApproxDuration, formatDateTime, formatTime, zonedDateKey } from './time.js';

export { DEFAULT_COOP_ID };
export const ALMOST_THRESHOLD_MS = 60 * 60_000; // last hour before target
export const RECENT_HATCH_DAYS = 7;

/** Fraction of the waiting period that has elapsed, clamped to 0..1. */
export function eggProgress(record, nowMs) {
  const start = Date.parse(record.placementAt);
  // Stage-based: progress toward the opening of the estimated window.
  const end = windowOf(record)?.startMs ?? Date.parse(record.targetAt);
  if (!(end > start)) return nowMs >= end ? 1 : 0;
  return Math.min(1, Math.max(0, (nowMs - start) / (end - start)));
}

/**
 * Visual stage of an egg:
 * planned (not yet placed) · warming (waiting) · almost (last hour) · due (target passed)
 * · hatched (completed) · cancelled
 */
export function eggStage(record, nowMs) {
  if (record.status === STATUS.COMPLETED) return 'hatched';
  if (record.status === STATUS.CANCELLED) return 'cancelled';
  const phase = windowPhase(record, nowMs);
  if (phase === 'after') return 'passed';
  if (Date.parse(record.placementAt) > nowMs) return 'planned';
  if (phase === 'in') return 'window';
  if (phase === 'before') return 'warming';
  if (isOverdue(record, nowMs)) return 'due';
  if (Date.parse(record.targetAt) - nowMs <= ALMOST_THRESHOLD_MS) return 'almost';
  return 'warming';
}

export const STAGE_LABEL = {
  planned: 'Planned',
  warming: 'Incubating',
  almost: 'Due within the hour',
  due: 'Overdue',
  window: 'In estimated window',
  passed: 'Window passed',
  hatched: 'Completed',
  cancelled: 'Cancelled',
};

/** Experiments shown as eggs in a coop: open ones, earliest target first. */
export function coopEggs(records, coopId = DEFAULT_COOP_ID) {
  return records.filter((r) => isOpen(r) && (r.coopId ?? DEFAULT_COOP_ID) === coopId).sort(byTarget);
}

/** Completed within the last RECENT_HATCH_DAYS, newest first. */
export function recentlyHatched(records, nowMs, coopId = DEFAULT_COOP_ID) {
  const since = nowMs - RECENT_HATCH_DAYS * 86_400_000;
  return records
    .filter((r) => r.status === STATUS.COMPLETED && (r.coopId ?? DEFAULT_COOP_ID) === coopId && Date.parse(r.completedAt) >= since)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
}

/** Variant used to give each egg a stable shell colour from its uid. */
export function shellVariant(uid) {
  let h = 0;
  for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 3;
}

/** Friendly greeting for the local time of day. */
export function greeting(nowMs, timeZone) {
  const hour = Number(formatTime(nowMs, timeZone).slice(0, 2));
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * What the hen says. Always factual: names the experiment and the exact target time.
 * Returns { mood: 'idle'|'happy'|'heads-up'|'alert', text }.
 */
export function henMessage(records, nowMs, { justLaidUid = null } = {}) {
  const eggs = coopEggs(records);
  const laid = justLaidUid && eggs.find((r) => r.uid === justLaidUid);
  if (laid) {
    return {
      mood: 'happy',
      text: `New batch settled in: ${displayName(laid)}${
        Number.isInteger(laid.initialEggCount) ? ` (${laid.initialEggCount} eggs)` : ''
      }. ${windowOf(laid) ? `Estimated window opens ${formatDateTime(windowOf(laid).startMs, laid.timeZone)}` : `Target ${formatDateTime(Date.parse(laid.targetAt), laid.timeZone)}`}.`,
    };
  }
  if (!eggs.length) return { mood: 'idle', text: 'The coop is empty. Add a batch of eggs to start a countdown.' };

  const overdue = eggs.filter((r) => isOverdue(r, nowMs));
  if (overdue.length) {
    const first = overdue[0];
    const more = overdue.length > 1 ? ` (+${overdue.length - 1} more past schedule)` : '';
    const w = windowOf(first);
    if (w) {
      return {
        mood: 'alert',
        text: `The estimated window for ${displayName(first)} closed at ${formatDateTime(w.endMs, first.timeZone)} — ${formatApproxDuration(nowMs - w.endMs)} ago${more}. Record what you observed, or complete the batch.`,
      };
    }
    const late = formatApproxDuration(nowMs - Date.parse(first.targetAt));
    const others = overdue.length > 1 ? ` (+${overdue.length - 1} more overdue)` : '';
    return {
      mood: 'alert',
      text: `${first.experimentId} passed its target at ${formatDateTime(Date.parse(first.targetAt), first.timeZone)} — ${late} ago${others}.`,
    };
  }

  const inWindow = eggs.find((r) => windowPhase(r, nowMs) === 'in');
  if (inWindow) {
    const w = windowOf(inWindow);
    return { mood: 'heads-up', text: `${displayName(inWindow)} is inside its estimated window (closes ${formatTime(w.endMs, inWindow.timeZone)}, in ${formatApproxDuration(w.endMs - nowMs)}). The stage is an estimate — check the embryos.` };
  }
  const next = eggs[0];
  const t = windowOf(next)?.startMs ?? Date.parse(next.targetAt);
  const inText = formatApproxDuration(t - nowMs);
  if (t - nowMs <= ALMOST_THRESHOLD_MS) {
    if (windowOf(next)) return { mood: 'heads-up', text: `Heads up: the estimated window for ${displayName(next)} opens at ${formatTime(t, next.timeZone)} — in ${inText}.` };
    return { mood: 'heads-up', text: `Heads up: ${next.experimentId} is due at ${formatTime(t, next.timeZone)} — in ${inText}.` };
  }
  const today = zonedDateKey(t, next.timeZone) === zonedDateKey(nowMs, next.timeZone);
  const when = today ? `today at ${formatTime(t, next.timeZone)}` : formatDateTime(t, next.timeZone);
  const count = eggs.length === 1 ? 'Your batch is' : `All ${eggs.length} batches are`;
  if (windowOf(next)) return { mood: 'idle', text: `${count} cozy. Next estimated window: ${displayName(next)}, opens ${when} (in ${inText}).` };
  return { mood: 'idle', text: `${count} cozy. Next check: ${next.experimentId}, ${when} (in ${inText}).` };
}
