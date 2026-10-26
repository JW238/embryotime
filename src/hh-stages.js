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
 * Estimated stage range for an incubation age, using only the reference table:
 *  - 'within': stages whose listed age range contains the age (ranges overlap, so often several);
 *  - 'between': the age falls in a gap between listed ages → the two neighbouring stages;
 *  - 'before-first': younger than the first listed age (HH1 has none) → HH1–HH2;
 *  - 'beyond': older than the last listed age → HH46, flagged as beyond the table.
 * Returns a plain snapshot object safe to store with an observation.
 */
export function estimateStage(ageMinutes) {
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0) throw new RangeError('Incubation age must be a non-negative number');
  const h = ageMinutes / 60;
  let stages;
  let method;
  if (h < firstListed.minHours) {
    stages = [HH_MIN, firstListed.stage];
    method = 'before-first';
  } else if (h > lastListedMax) {
    stages = [HH_MAX, HH_MAX];
    method = 'beyond';
  } else {
    const hits = listed.filter((s) => s.minHours <= h && h <= s.maxHours).map((s) => s.stage);
    if (hits.length) {
      stages = [Math.min(...hits), Math.max(...hits)];
      method = 'within';
    } else {
      const lower = Math.max(...listed.filter((s) => s.maxHours < h).map((s) => s.stage));
      const upper = Math.min(...listed.filter((s) => s.minHours > h).map((s) => s.stage));
      stages = [lower, upper];
      method = 'between';
    }
  }
  const label =
    method === 'beyond' ? `HH${HH_MAX} or later (beyond the reference ages)` : stageRangeLabel(stages);
  return { stages, label, method, ageMinutes: Math.round(ageMinutes), referenceVersion: HH_REFERENCE.version };
}

export const ESTIMATE_METHOD_TEXT = {
  within: 'Reference age range(s) include this age.',
  between: 'This age falls between two listed reference ages.',
  'before-first': 'Younger than the first listed reference age (HH2, 6 h); HH1 has no listed age.',
  beyond: 'Older than the last listed reference age (21 d).',
};

export function stageInRange(stage, [lo, hi]) {
  return stage >= lo && stage <= hi;
}
