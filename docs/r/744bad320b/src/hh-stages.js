// Hamburger–Hamilton (HH) reference stages for the chick embryo.
//
// Source: Hamburger V. & Hamilton H.L. (1951) "A series of normal stages in the development of
// the chick embryo", J Morphol 88(1):49–92 (republished 1992, Dev Dyn 195:231–272), as tabulated
// by UNSW Embryology: https://embryology.med.unsw.edu.au/embryology/index.php/Hamburger_Hamilton_Stages
// (accessed 2026-10-26). Ages are the table's approximate incubation ages, converted to hours
// (1 day = 24 h). Features are short identifying characteristics from the same table.
// Only whole stages 1–46 are included; stage 1 has no age in the table, so it has none here.
//
// Estimates below use only these listed ages. Nothing is interpolated or extrapolated.

export const HH_REFERENCE = Object.freeze({
  version: 'HH1951/UNSW-2026-10-26',
  citation: 'Hamburger & Hamilton (1951) J Morphol 88:49–92; table via UNSW Embryology (accessed 26 Oct 2026)',
  url: 'https://embryology.med.unsw.edu.au/embryology/index.php/Hamburger_Hamilton_Stages',
});

const d = (days) => days * 24;

// [stage, minHours, maxHours, features]
const RAW = [
  [1, null, null, 'Pre-primitive streak (embryonic shield)'],
  [2, 6, 7, 'Initial primitive streak, 0.3–0.5 mm long'],
  [3, 12, 13, 'Intermediate primitive streak'],
  [4, 18, 19, 'Definitive primitive streak, about 1.88 mm'],
  [5, 19, 22, 'Head process (notochord)'],
  [6, 23, 25, 'Head fold'],
  [7, 23, 26, '1 somite; neural folds'],
  [8, 26, 29, '4 somites; blood islands'],
  [9, 29, 33, '7 somites; primary optic vesicles'],
  [10, 33, 38, '10 somites; 3 primary brain vesicles'],
  [11, 40, 45, '13 somites; 5 hindbrain neuromeres'],
  [12, 45, 49, '16 somites; telencephalon'],
  [13, 48, 52, '19 somites; atrioventricular canal'],
  [14, 50, 53, '22 somites; trunk flexure; visceral arches I–II, clefts 1–2'],
  [15, 50, 55, '24–27 somites; visceral arch III, cleft 3'],
  [16, 51, 56, '26–28 somites; wing bud; posterior amniotic fold'],
  [17, 52, 64, '29–32 somites; leg bud; epiphysis'],
  [18, d(3), d(3), '30–36 somites, extending past the leg bud; allantois'],
  [19, d(3), d(3.5), '37–40 somites, extending into the tail; maxillary process'],
  [20, d(3), d(3.5), '40–43 somites; rotation completed; eye pigment'],
  [21, d(3.5), d(3.5), '43–44 somites; visceral arch IV, cleft 4'],
  [22, d(3.5), d(4), 'Somites reach the tip of the tail'],
  [23, d(4), d(4), 'Dorsal contour from hindbrain to tail forms a curved line'],
  [24, d(4.5), d(4.5), 'Toe plate'],
  [25, d(4.5), d(5), 'Elbow and knee joints'],
  [26, d(5), d(5), 'First 3 toes'],
  [27, d(5), d(5.5), 'Beak'],
  [28, d(5.5), d(6), '3 digits, 4 toes'],
  [29, d(6), d(6.5), 'Rudiment of 5th toe'],
  [30, d(6.5), d(7), 'Feather germs; scleral papillae; egg tooth'],
  [31, d(7), d(7.5), 'Web between 1st and 2nd digits'],
  [32, d(7.5), d(7.5), 'Anterior tip of mandible reaches the beak'],
  [33, d(7.5), d(8), 'Web on radial margin of wing and 1st digit'],
  [34, d(8), d(8), 'Nictitating membrane'],
  [35, d(8.5), d(9), 'Phalanges in toes'],
  [36, d(10), d(10), '3rd toe ≈ 5.4 ± 0.3 mm; beak ≈ 2.5 mm; comb primordium; labial groove; uropygial gland'],
  [37, d(11), d(11), '3rd toe ≈ 7.4 ± 0.3 mm; beak ≈ 3.0 mm'],
  [38, d(12), d(12), '3rd toe ≈ 8.4 ± 0.3 mm; beak ≈ 3.1 mm'],
  [39, d(13), d(13), '3rd toe ≈ 9.8 ± 0.3 mm; beak ≈ 3.5 mm'],
  [40, d(14), d(14), 'Beak ≈ 4.0 mm; 3rd toe ≈ 12.7 ± 0.5 mm'],
  [41, d(15), d(15), 'Beak ≈ 4.5 mm; 3rd toe ≈ 14.9 ± 0.8 mm'],
  [42, d(16), d(16), 'Beak ≈ 4.8 mm; 3rd toe ≈ 16.7 ± 0.8 mm'],
  [43, d(17), d(17), 'Beak ≈ 5.0 mm; 3rd toe ≈ 18.6 ± 0.8 mm'],
  [44, d(18), d(18), 'Beak ≈ 5.7 mm; 3rd toe ≈ 20.4 ± 0.8 mm'],
  [45, d(19), d(20), 'Yolk sac half enclosed in body cavity; chorioallantoic membrane less vascular, "sticky"'],
  [46, d(20), d(21), 'Newly hatched chick'],
];

export const HH_STAGES = Object.freeze(
  RAW.map(([stage, minHours, maxHours, features]) => Object.freeze({ stage, minHours, maxHours, features }))
);

export const HH_MIN = 1;
export const HH_MAX = 46;

export function getStage(stage) {
  return HH_STAGES.find((s) => s.stage === stage) ?? null;
}

export function isValidStage(stage) {
  return Number.isInteger(stage) && stage >= HH_MIN && stage <= HH_MAX;
}

/** "6–7 h", "3 d", "3–3.5 d", or "no age listed". */
export function formatReferenceAge(s) {
  if (s.minHours === null) return 'no age listed';
  const unit = s.minHours >= 72 ? 'd' : 'h';
  const f = (h) => (unit === 'd' ? String(+(h / 24).toFixed(1)) : String(h));
  return s.minHours === s.maxHours ? `${f(s.minHours)} ${unit}` : `${f(s.minHours)}–${f(s.maxHours)} ${unit}`;
}

export function stageRangeLabel([lo, hi]) {
  return lo === hi ? `HH${lo}` : `HH${lo}–HH${hi}`;
}

const listed = HH_STAGES.filter((s) => s.minHours !== null);
const firstListed = listed[0];
const lastListedMax = Math.max(...listed.map((s) => s.maxHours));

/**
 * Estimated stage range for an incubation-age interval [loMinutes, hiMinutes], using only the
 * reference table. An exact age is the special case lo === hi.
 *  - 'within': listed stages whose age range intersects the interval (ranges overlap, so often several);
 *  - 'between': the interval lies entirely in a gap between listed ages → the two neighbouring stages;
 *  - 'before-first': younger than the first listed age (HH1 has none) → HH1–HH2;
 *  - 'beyond': older than the last listed age → HH46, flagged as beyond the table.
 * Intervals that cross several of these regions combine them (e.g. HH1–HH3).
 * Returns a plain snapshot object safe to store with an observation.
 */
export function estimateStageForRange(loMinutes, hiMinutes) {
  if (![loMinutes, hiMinutes].every(Number.isFinite) || loMinutes < 0 || hiMinutes < loMinutes) {
    throw new RangeError('Incubation age range must be non-negative numbers with lo ≤ hi');
  }
  const lo = loMinutes / 60;
  const hi = hiMinutes / 60;
  const set = new Set();
  let method = 'within';
  if (lo < firstListed.minHours) {
    set.add(HH_MIN);
    set.add(firstListed.stage);
    if (hi < firstListed.minHours) method = 'before-first';
  }
  for (const s of listed) if (s.minHours <= hi && lo <= s.maxHours) set.add(s.stage);
  const beyond = hi > lastListedMax;
  if (beyond) set.add(HH_MAX);
  if (lo > lastListedMax) method = 'beyond';
  if (set.size === 0) {
    set.add(Math.max(...listed.filter((s) => s.maxHours < lo).map((s) => s.stage)));
    set.add(Math.min(...listed.filter((s) => s.minHours > hi).map((s) => s.stage)));
    method = 'between';
  }
  const stages = [Math.min(...set), Math.max(...set)];
  const label =
    method === 'beyond'
      ? `HH${HH_MAX} or later (beyond the reference ages)`
      : `${stageRangeLabel(stages)}${beyond ? ' or later' : ''}`;
  const exact = loMinutes === hiMinutes;
  return {
    stages,
    label,
    method,
    ageRangeMinutes: [Math.round(loMinutes), Math.round(hiMinutes)],
    ageMinutes: exact ? Math.round(loMinutes) : null,
    referenceVersion: HH_REFERENCE.version,
  };
}

/** Estimate for a single, exactly known incubation age. */
export function estimateStage(ageMinutes) {
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0) throw new RangeError('Incubation age must be a non-negative number');
  return estimateStageForRange(ageMinutes, ageMinutes);
}

export const ESTIMATE_METHOD_TEXT = {
  within: 'Reference age range(s) include this age.',
  between: 'This age falls between two listed reference ages.',
  'before-first': 'Younger than the first listed reference age (HH2, 6 h); HH1 has no listed age.',
  beyond: 'Older than the last listed reference age (21 d).',
  range: 'All stages whose listed reference ages overlap the estimated age range.',
};

export function stageInRange(stage, [lo, hi]) {
  return stage >= lo && stage <= hi;
}

// ---------- stage-based planning ----------
//
// A plan starts from either freshly set eggs (incubation age exactly 0 h — a known elapsed time,
// not an HH1 observation) or a current HH stage (age = that stage's listed reference range).
// The target stage's listed range gives an estimated *window*, never a single exact time:
//   window start = max(0, targetMin − baselineMax)      window end = targetMax − baselineMin
// This interval arithmetic only combines the table's listed ranges; it does not capture the
// full biological variation between embryos or incubation conditions.

export const PLANNED_RETURN = Object.freeze({
  none: 'No planned return — track the window only',
  start: 'Start of window',
  middle: 'Middle of window',
  end: 'End of window',
});

export const PLANNED_RETURN_HELP = {
  none: 'Countdowns and the calendar show the estimated window itself.',
  start: 'Earliest return: less chance of missing an early target, but the stage may not have been reached yet.',
  middle: 'A scheduling convention between the two extremes — not a scientifically proven optimum.',
  end: 'Latest return: more development time, but a greater chance the target stage has already passed.',
};

export const PLAN_VERSION = 2;

/**
 * input: { start: 'fresh'|'stage', currentStage, targetStage, plannedReturn, observed }
 * Returns { ok, plan } or { ok: false, code, field, error } — never an invented age.
 */
export function planStages({ start, currentStage, targetStage, plannedReturn, observed = false }) {
  const fail = (code, field, error) => ({ ok: false, code, field, error });
  if (start !== 'fresh' && start !== 'stage') return fail('start', 'start', 'Choose a starting point: freshly set eggs or a current HH stage.');
  let baseline;
  let basis;
  let cur = null;
  if (start === 'fresh') {
    baseline = [0, 0];
    basis = 'known-age';
  } else {
    if (currentStage === null || currentStage === undefined || currentStage === '') return fail('missing', 'current', 'Choose the current HH stage.');
    if (!isValidStage(currentStage)) return fail('invalid', 'current', 'The current stage must be a whole number from 1 to 46.');
    cur = getStage(currentStage);
    if (cur.minHours === null) {
      return fail(
        'no-reference-age',
        'current',
        `HH${currentStage} has no reference age in the source table, so a waiting time cannot be calculated from it. For eggs that have just been set, choose “Freshly set eggs — incubation age 0 h”; otherwise choose HH2 or later.`
      );
    }
    baseline = [cur.minHours, cur.maxHours];
    basis = observed ? 'observed' : 'selected';
  }
  if (targetStage === null || targetStage === undefined || targetStage === '') return fail('missing', 'target', 'Choose the target HH stage.');
  if (!isValidStage(targetStage)) return fail('invalid', 'target', 'The target stage must be a whole number from 1 to 46.');
  if (cur && targetStage <= currentStage) return fail('order', 'target', `The target stage must be later than the current stage (HH${currentStage}).`);
  const t = getStage(targetStage);
  if (t.minHours === null) return fail('no-reference-age', 'target', `HH${targetStage} has no reference age in the source table. Choose HH2 or later as the target.`);
  if (plannedReturn === undefined || plannedReturn === null || plannedReturn === '') {
    return fail('missing', 'plannedReturn', 'Choose whether to plan a specific return time.');
  }
  if (!Object.hasOwn(PLANNED_RETURN, plannedReturn)) return fail('invalid', 'plannedReturn', 'Choose a valid planned-return option.');
  return windowPlan({ baseline, basis, currentStage: cur ? currentStage : null, start, targetStage, plannedReturn });
}

/** Shared by new plans and conversions of older batches (exact baseline from entered durations). */
export function windowPlan({ baseline, basis, currentStage = null, start, targetStage, plannedReturn }) {
  const t = getStage(targetStage);
  const rawStart = t.minHours - baseline[1];
  const windowStart = Math.max(0, rawStart);
  const windowEnd = t.maxHours - baseline[0];
  if (windowEnd <= 0) {
    return {
      ok: false,
      code: 'already-past',
      field: 'target',
      error: `The starting age (${formatHoursRange(baseline)}) is already at or past HH${targetStage}'s reference age (${formatHoursRange([t.minHours, t.maxHours])}). Choose a later target stage.`,
    };
  }
  if (plannedReturn === 'start' && windowStart === 0) {
    return {
      ok: false,
      code: 'zero-start',
      field: 'plannedReturn',
      error: 'The window starts at placement because the reference ranges overlap, so “Start of window” would mean no wait. Choose another option.',
    };
  }
  const point = { none: null, start: windowStart, middle: (windowStart + windowEnd) / 2, end: windowEnd }[plannedReturn];
  return {
    ok: true,
    plan: {
      version: PLAN_VERSION,
      start,
      currentStage,
      currentStageBasis: basis,
      baselineAgeHours: [baseline[0], baseline[1]],
      targetStage,
      targetAgeHours: [t.minHours, t.maxHours],
      windowHours: [windowStart, windowEnd],
      rangesOverlap: rawStart < 0,
      plannedReturn,
      plannedReturnMinutes: point === null ? null : Math.round(point * 60),
      referenceVersion: HH_REFERENCE.version,
    },
  };
}

export const BASIS_LABEL = {
  'known-age': 'freshly set eggs (known age 0 h)',
  selected: 'selected stage (not observed)',
  observed: 'observed stage (morphologically confirmed)',
  'entered-duration': 'entered incubation duration (converted)',
};

/** "7–16 h" / "3 h" / "0–5 h" (uses days above 72 h). */
export function formatHoursRange([lo, hi]) {
  const f = (h) => (hi > 72 ? `${+(h / 24).toFixed(2)}` : `${+h.toFixed(1)}`);
  const unit = hi > 72 ? 'd' : 'h';
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return '—';
  return lo === hi ? `${f(lo)} ${unit}` : `${f(lo)}–${f(hi)} ${unit}`;
}
