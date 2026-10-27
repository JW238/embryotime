// Pure date-time logic. No DOM access here.
//
// Model: every point in time is stored as an absolute instant (epoch ms / ISO UTC).
// Wall-clock input ("2026-10-26 13:20") is always interpreted in an explicit IANA
// time zone. Durations are elapsed time, so target = placement instant + duration,
// which is correct across midnight, month/year boundaries and DST changes.

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

const MIN_YEAR = 1970;
const MAX_YEAR = 2199;

// ---------- time zones ----------

const partsFormatters = new Map();

function partsFormatter(timeZone) {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function getSystemTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function listTimeZones() {
  if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone');
  return ['UTC'];
}

/** Wall-clock fields of an instant in a time zone. */
export function instantToZonedParts(ms, timeZone) {
  const out = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** Offset of the zone from UTC at a given instant, in minutes (e.g. EDT = -240). */
export function getTimeZoneOffsetMinutes(ms, timeZone) {
  const p = instantToZonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const wholeSeconds = Math.floor(ms / 1000) * 1000;
  return Math.round((asUtc - wholeSeconds) / MS_PER_MINUTE);
}

export function formatUtcOffset(offsetMinutes) {
  const sign = offsetMinutes < 0 ? '−' : '+';
  const abs = Math.abs(offsetMinutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

// ---------- parsing wall-clock input ----------

export function parseDateInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null; // e.g. 2026-02-30
  return { year, month, day };
}

export function parseTimeInput(value) {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const [hour, minute] = [Number(m[1]), Number(m[2])];
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Convert a wall-clock date + time in `timeZone` to an absolute instant.
 * Returns { ok, instantMs, ambiguous, alternatives } or { ok: false, code, error }.
 * - Nonexistent local times (skipped by a DST "spring forward") are rejected.
 * - Ambiguous local times (repeated by a DST "fall back") return both candidates,
 *   earliest first, so the caller can ask which one was meant.
 */
export function zonedWallTimeToInstant(dateStr, timeStr, timeZone) {
  const d = parseDateInput(dateStr);
  if (!d) return { ok: false, code: 'invalid-date', error: 'Enter a valid date.' };
  const t = parseTimeInput(timeStr);
  if (!t) return { ok: false, code: 'invalid-time', error: 'Enter a valid time (HH:MM, 24-hour).' };
  if (!isValidTimeZone(timeZone)) return { ok: false, code: 'invalid-zone', error: 'Choose a valid time zone.' };

  const wallAsUtc = Date.UTC(d.year, d.month - 1, d.day, t.hour, t.minute);
  const offsets = new Set([
    getTimeZoneOffsetMinutes(wallAsUtc - MS_PER_DAY, timeZone),
    getTimeZoneOffsetMinutes(wallAsUtc, timeZone),
    getTimeZoneOffsetMinutes(wallAsUtc + MS_PER_DAY, timeZone),
  ]);
  const matches = [...new Set([...offsets].map((o) => wallAsUtc - o * MS_PER_MINUTE))]
    .filter((ms) => {
      const p = instantToZonedParts(ms, timeZone);
      return p.year === d.year && p.month === d.month && p.day === d.day && p.hour === t.hour && p.minute === t.minute;
    })
    .sort((a, b) => a - b);

  if (matches.length === 0) {
    return {
      ok: false,
      code: 'nonexistent',
      error: `${timeStr} does not exist on ${dateStr} in ${timeZone} (clocks jump forward for daylight saving). Choose a different time.`,
    };
  }
  return { ok: true, instantMs: matches[0], ambiguous: matches.length > 1, alternatives: matches };
}

/** Instant → { date: 'YYYY-MM-DD', time: 'HH:MM' } in a zone (for form inputs). */
export function instantToWallInputs(ms, timeZone) {
  const p = instantToZonedParts(ms, timeZone);
  const pad = (n) => String(n).padStart(2, '0');
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** Calendar date key ('YYYY-MM-DD') of an instant in a zone. */
export function zonedDateKey(ms, timeZone) {
  return instantToWallInputs(ms, timeZone).date;
}

// ---------- durations ----------

/**
 * Parse an hours + optional minutes pair into whole minutes.
 * Returns { ok, minutes } or { ok: false, error }.
 */
export function parseDuration(hoursStr, minutesStr, { allowZero = false, label = 'Duration', maxHours = 10_000 } = {}) {
  const hRaw = String(hoursStr ?? '').trim();
  const mRaw = String(minutesStr ?? '').trim();
  if (hRaw === '' && mRaw === '') return { ok: false, error: `${label} is required.` };
  const isWhole = (s) => s === '' || /^\d+$/.test(s);
  if (!isWhole(hRaw) || !isWhole(mRaw)) {
    return { ok: false, error: `${label} must be whole, non-negative numbers of hours and minutes.` };
  }
  const hours = hRaw === '' ? 0 : Number(hRaw);
  const minutes = mRaw === '' ? 0 : Number(mRaw);
  if (minutes > 59) return { ok: false, error: `${label}: minutes must be between 0 and 59.` };
  if (hours > maxHours) return { ok: false, error: `${label} cannot exceed ${maxHours} hours.` };
  const total = hours * 60 + minutes;
  if (!allowZero && total === 0) return { ok: false, error: `${label} must be greater than zero.` };
  return { ok: true, minutes: total };
}

export function splitMinutes(totalMinutes) {
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/** 2190 → "36 h 30 min"; 2160 → "36 h". */
export function formatDuration(totalMinutes) {
  const { hours, minutes } = splitMinutes(Math.max(0, Math.round(totalMinutes)));
  if (minutes === 0) return `${hours} h`;
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
}

/** 2160 → "1 d 12 h" (supplementary, for long durations). */
export function formatDurationDays(totalMinutes) {
  const m = Math.max(0, Math.round(totalMinutes));
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  return [days && `${days} d`, hours && `${hours} h`, mins && `${mins} min`].filter(Boolean).join(' ') || '0 min';
}

// ---------- core calculations ----------

export function calculateTargetMs(placementMs, waitMinutes) {
  if (!Number.isFinite(placementMs)) throw new TypeError('placementMs must be a finite number');
  if (!Number.isInteger(waitMinutes) || waitMinutes < 0) throw new RangeError('waitMinutes must be a non-negative integer');
  return placementMs + waitMinutes * MS_PER_MINUTE;
}

export function projectedTotalIncubationMinutes(currentIncubationMinutes, waitMinutes) {
  return currentIncubationMinutes + waitMinutes;
}

/**
 * Difference in UTC offset between two instants in a zone, in minutes.
 * Non-zero means the wall clock was changed (DST) during the interval.
 */
export function clockShiftMinutes(fromMs, toMs, timeZone) {
  return getTimeZoneOffsetMinutes(toMs, timeZone) - getTimeZoneOffsetMinutes(fromMs, timeZone);
}

/** Remaining time until target. Never returns a negative "remaining" value. */
export function timeRemaining(targetMs, nowMs) {
  const diff = targetMs - nowMs;
  return diff > 0 ? { overdue: false, remainingMs: diff, overdueMs: 0 } : { overdue: true, remainingMs: 0, overdueMs: Math.max(0, -diff) };
}

/** 93784000 → "1 d 02:03:04"; under a day → "02:03:04". */
export function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const clock = `${pad(h)}:${pad(m)}:${pad(s)}`;
  return days > 0 ? `${days} d ${clock}` : clock;
}

/** Coarse human description, e.g. "2 h 5 min", "3 d 4 h". */
export function formatApproxDuration(ms) {
  const totalMinutes = Math.floor(Math.max(0, ms) / MS_PER_MINUTE);
  if (totalMinutes < 1) return 'less than 1 min';
  if (totalMinutes < 60 * 24) return formatDuration(totalMinutes);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  return hours ? `${days} d ${hours} h` : `${days} d`;
}

// ---------- display ----------

const displayFormatters = new Map();

function displayFormatter(timeZone, kind) {
  const key = `${timeZone}|${kind}`;
  let f = displayFormatters.get(key);
  if (!f) {
    const base = { timeZone };
    const opts = {
      datetime: { ...base, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' },
      date: { ...base, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' },
      time: { ...base, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
      zone: { ...base, timeZoneName: 'short' },
    }[kind];
    f = new Intl.DateTimeFormat('en-US', opts);
    displayFormatters.set(key, f);
  }
  return f;
}

/** "Tue, Oct 27, 2026, 13:20 EDT" */
export function formatDateTime(ms, timeZone) {
  return displayFormatter(timeZone, 'datetime').format(new Date(ms));
}

/** "Tue, Oct 27, 2026" */
export function formatDate(ms, timeZone) {
  return displayFormatter(timeZone, 'date').format(new Date(ms));
}

/** "13:20" */
export function formatTime(ms, timeZone) {
  return displayFormatter(timeZone, 'time').format(new Date(ms));
}

/** Short zone name at an instant, e.g. "EDT" or "GMT+8". */
export function zoneAbbreviation(ms, timeZone) {
  const part = displayFormatter(timeZone, 'zone').formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName');
  return part ? part.value : timeZone;
}

/** "2026-10-27 13:20" in zone — compact, sortable, unambiguous with the zone label. */
export function formatIsoLocal(ms, timeZone) {
  const { date, time } = instantToWallInputs(ms, timeZone);
  return `${date} ${time}`;
}
