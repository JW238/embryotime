// Egg Collection badges. Kept separate from experiment records: this module only reads
// observations and stores its own unlock dates under its own localStorage key. Badges never
// change scientific data, and once unlocked they are not revoked.
//
// Counting rules (shown to the user in the Collection view):
//  1. Each saved stage observation counts once, for the whole batch — not once per egg.
//  2. Every answer counts the same: "matches", "different" and "unable to confirm".
//     (Counting "unable to confirm" means badges never reward guessing a stage.)
//  3. Accidental duplicates (same batch, same minute, same answer and stage) count once.
//  4. Demo batches do not count.

import { observationKey } from './experiment.js';

/** Edit thresholds, titles and texts here. */
export const BADGES = [
  { id: 'first-look', threshold: 1, title: 'First look', art: 'crack', unlock: 'Record your first stage observation.' },
  { id: 'careful-observer', threshold: 5, title: 'Careful observer', art: 'peek', unlock: 'Record 5 stage observations.' },
  { id: 'steady-hands', threshold: 20, title: 'Steady hands', art: 'chick', unlock: 'Record 20 stage observations.' },
  { id: 'seasoned-stager', threshold: 50, title: 'Seasoned stager', art: 'pair', unlock: 'Record 50 stage observations.' },
];

export const COUNTING_RULES = [
  'Each saved stage observation counts once for its batch — not once per egg.',
  'Every answer counts the same: matches, different, or unable to confirm.',
  'Accidental duplicates (same batch, same minute, same answer and stage) count once.',
  'Demo batches do not count.',
];

/** Number of observations that count toward badges, under the rules above. */
export function countObservations(records) {
  let n = 0;
  for (const r of records) {
    if (r.demo) continue;
    const seen = new Set();
    for (const o of r.observations ?? []) {
      if (!o || Number.isNaN(Date.parse(o.observedAt))) continue;
      const key = observationKey(o);
      if (seen.has(key)) continue;
      seen.add(key);
      n += 1;
    }
  }
  return n;
}

/** Progress toward the next badge (fraction of the gap from the previous threshold). */
export function badgeProgress(count, badges = BADGES) {
  const sorted = [...badges].sort((a, b) => a.threshold - b.threshold);
  const next = sorted.find((b) => b.threshold > count) ?? null;
  const prevThreshold = [...sorted].reverse().find((b) => b.threshold <= count)?.threshold ?? 0;
  const fraction = next ? (count - prevThreshold) / (next.threshold - prevThreshold) : 1;
  return { count, next, remaining: next ? next.threshold - count : 0, fraction: Math.max(0, Math.min(1, fraction)), earned: sorted.filter((b) => b.threshold <= count) };
}

export const BADGE_KEY = 'embryotime.badges.v1';

export function createBadgeStore(storage = globalThis.localStorage) {
  return {
    load() {
      try {
        const data = JSON.parse(storage?.getItem(BADGE_KEY) ?? 'null');
        return { unlocked: data && typeof data.unlocked === 'object' && data.unlocked ? { ...data.unlocked } : {} };
      } catch {
        return { unlocked: {} };
      }
    },
    save(state) {
      try {
        storage.setItem(BADGE_KEY, JSON.stringify({ unlocked: state.unlocked }));
      } catch {
        // Badges are a convenience; failing to save them must never block scientific work.
      }
    },
  };
}

/** Unlock every badge whose threshold is met. Never revokes. Returns the newly unlocked ones. */
export function syncUnlocks(state, count, nowMs, badges = BADGES) {
  const unlocked = { ...state.unlocked };
  const newly = [];
  for (const b of badges) {
    if (count >= b.threshold && !unlocked[b.id]) {
      unlocked[b.id] = new Date(nowMs).toISOString();
      newly.push(b);
    }
  }
  return { state: { unlocked }, newly };
}
