// Persistence. The MVP stores everything in the browser's localStorage.
//
// The repository is async on purpose: a future server/database backend can implement
// the same four methods (list, save, remove, replaceAll) without touching the UI.

import { EGG_COUNT_MAX, EGG_COUNT_MIN, MAX_REMINDER_MINUTES, SCHEMA_VERSION, STATUS, VERDICTS, normalizeRecord } from './experiment.js';
import { PLANNED_RETURN, isValidStage } from './hh-stages.js';
import { isValidTimeZone } from './time.js';

export const STORAGE_KEY = 'embryotime.experiments.v1';

export class StorageError extends Error {}

export function createLocalRepository(storage = globalThis.localStorage) {
  if (!storage) throw new StorageError('Browser storage is not available. Records cannot be saved.');

  function readAll() {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      // Keep the unreadable data instead of overwriting it.
      storage.setItem(`${STORAGE_KEY}.corrupt-${Date.now()}`, raw);
      throw new StorageError('Saved data could not be read. A copy of the unreadable data was kept in browser storage.');
    }
    if (!data || !Array.isArray(data.experiments)) throw new StorageError('Saved data has an unexpected format.');
    return data.experiments.map(normalizeRecord);
  }

  function writeAll(experiments) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, experiments }));
    } catch (err) {
      throw new StorageError(`Could not save to browser storage (${err?.name ?? 'error'}). Storage may be full or disabled.`);
    }
  }

  return {
    async list() {
      return readAll();
    },
    async save(record) {
      const all = readAll();
      const i = all.findIndex((r) => r.uid === record.uid);
      if (i >= 0) all[i] = record;
      else all.push(record);
      writeAll(all);
      return record;
    },
    async remove(uid) {
      writeAll(readAll().filter((r) => r.uid !== uid));
    },
    async replaceAll(experiments) {
      writeAll(experiments);
    },
    /** Discard the stored data (used to recover from a corrupt store). */
    async reset() {
      storage.removeItem(STORAGE_KEY);
    },
  };
}

export const PROFILE_KEY = 'embryotime.profile.v1';
export const DEFAULT_PROFILE = Object.freeze({ researcherName: '', coopName: '' });

/** The local researcher's display name and coop name. Never throws: falls back to defaults. */
export function createProfileStore(storage = globalThis.localStorage) {
  return {
    load() {
      try {
        const data = JSON.parse(storage?.getItem(PROFILE_KEY) ?? 'null');
        return {
          researcherName: String(data?.researcherName ?? '').slice(0, 40),
          coopName: String(data?.coopName ?? '').slice(0, 40),
        };
      } catch {
        return { ...DEFAULT_PROFILE };
      }
    },
    save(profile) {
      const clean = {
        researcherName: String(profile.researcherName ?? '').trim().slice(0, 40),
        coopName: String(profile.coopName ?? '').trim().slice(0, 40),
      };
      try {
        storage.setItem(PROFILE_KEY, JSON.stringify(clean));
      } catch (err) {
        throw new StorageError(`Could not save your profile (${err?.name ?? 'error'}).`);
      }
      return clean;
    },
  };
}

/** Display name of a coop: custom name, else "<name>'s coop", else "My coop". */
export function coopDisplayName(profile) {
  if (profile.coopName) return profile.coopName;
  if (profile.researcherName) return `${profile.researcherName}'s coop`;
  return 'My coop';
}

// ---------- backups ----------

export const BACKUP_FORMAT = 'embryotime-backup';
export const BACKUP_VERSION = 2;

/** The JSON written by "Download backup". */
export function buildBackup(records, nowMs) {
  return { app: 'EmbryoTime', format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date(nowMs).toISOString(), experiments: records };
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
const isRange = (v) => Array.isArray(v) && v.length === 2 && v.every((x) => Number.isFinite(x) && x >= 0) && v[0] <= v[1];

/**
 * Validate a parsed backup file completely before anything is written.
 * Supported formats (migrated explicitly):
 *   v2  { format: 'embryotime-backup', version: 2, experiments: [...] }
 *   v1  { app: 'EmbryoTime', exportedAt, experiments: [...] }   (earlier "Download backup")
 *   raw { schemaVersion: 1, experiments: [...] } or a bare array (localStorage dumps)
 * Older records are normalised (missing egg counts → null, missing lists → []); scientific
 * values that are missing are never invented.
 * options.existing: records already in this browser (to detect ID conflicts).
 * Returns { ok, errors: string[], records, format }.
 */
export function validateBackup(data, { existing = [] } = {}) {
  const errors = [];
  let list;
  let format;
  if (Array.isArray(data)) {
    list = data;
    format = 'array';
  } else if (data && typeof data === 'object' && Array.isArray(data.experiments)) {
    list = data.experiments;
    if (data.format === BACKUP_FORMAT) {
      format = `v${data.version}`;
      if (data.version !== BACKUP_VERSION) errors.push(`Unsupported backup version ${data.version}. This app reads version ${BACKUP_VERSION} and earlier formats.`);
    } else format = data.app === 'EmbryoTime' ? 'v1' : 'raw';
  } else {
    return { ok: false, errors: ['File does not contain an experiments list.'], records: [], format: null };
  }
  if (list.length === 0) errors.push('The backup contains no experiments.');

  const uids = new Set();
  const ids = new Set();
  const existingByExpId = new Map(existing.map((r) => [r.experimentId, r.uid]));
  const records = [];
  list.forEach((raw, i) => {
    const where = `Record ${i + 1}${raw && typeof raw.experimentId === 'string' ? ` (${raw.experimentId})` : ''}`;
    const err = (m) => errors.push(`${where}: ${m}`);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return err('is not an object.');
    const req = ['uid', 'experimentId', 'placementAt', 'targetAt', 'originalTargetAt', 'timeZone', 'waitMinutes', 'currentIncubationMinutes', 'status'];
    const missing = req.filter((k) => raw[k] === undefined || raw[k] === null);
    if (missing.length) return err(`missing ${missing.map((k) => `"${k}"`).join(', ')}.`);
    const r = normalizeRecord({ history: [], reminderOffsets: [], notes: '', conditions: '', batchId: '', name: '', calendar: { exportedAt: null, exportedTargetAt: null, sequence: 0 }, ...raw });

    if (typeof r.uid !== 'string' || !r.uid.trim()) err('"uid" must be a non-empty string.');
    else if (uids.has(r.uid)) err(`duplicate uid "${r.uid}" in this file.`);
    uids.add(r.uid);
    if (typeof r.experimentId !== 'string' || !ID_PATTERN.test(r.experimentId)) err('"experimentId" is not a valid record ID.');
    else if (ids.has(r.experimentId)) err(`duplicate experiment ID "${r.experimentId}" in this file.`);
    else if (existingByExpId.has(r.experimentId) && existingByExpId.get(r.experimentId) !== r.uid) {
      err(`experiment ID "${r.experimentId}" is already used by a different batch in this browser.`);
    }
    ids.add(r.experimentId);
    if (typeof r.name !== 'string') err('"name" must be text.');
    for (const k of ['placementAt', 'targetAt', 'originalTargetAt']) if (!isIso(r[k])) err(`"${k}" is not a valid timestamp.`);
    for (const k of ['createdAt', 'updatedAt', 'completedAt', 'cancelledAt']) if (r[k] !== undefined && r[k] !== null && !isIso(r[k])) err(`"${k}" is not a valid timestamp.`);
    if (!isValidTimeZone(r.timeZone)) err(`time zone "${r.timeZone}" is not recognised.`);
    if (!isNonNegInt(r.currentIncubationMinutes)) err('"currentIncubationMinutes" must be a whole, non-negative number.');
    if (!isNonNegInt(r.waitMinutes)) err('"waitMinutes" must be a whole, non-negative number.');
    if (!Object.values(STATUS).includes(r.status)) err(`status "${r.status}" is not valid.`);
    if (r.status === STATUS.COMPLETED && !isIso(r.completedAt)) err('a completed batch needs a valid "completedAt".');
    if (isIso(r.placementAt) && isIso(r.targetAt) && Date.parse(r.targetAt) < Date.parse(r.placementAt)) err('target time is before placement.');

    if (r.initialEggCount !== null && (!Number.isInteger(r.initialEggCount) || r.initialEggCount < EGG_COUNT_MIN || r.initialEggCount > EGG_COUNT_MAX)) {
      err(`egg count must be ${EGG_COUNT_MIN}–${EGG_COUNT_MAX} or not recorded.`);
    }
    let adjusted = 0;
    for (const a of r.eggAdjustments) {
      if (!a || !['removed', 'completed'].includes(a.kind) || !Number.isInteger(a.count) || a.count < 1 || !isIso(a.at)) {
        err('contains an invalid egg-count change.');
        break;
      }
      adjusted += a.count;
    }
    if (r.initialEggCount !== null && adjusted > r.initialEggCount) err('egg-count changes exceed the number of eggs.');
    if (!Array.isArray(r.reminderOffsets) || r.reminderOffsets.some((m) => !Number.isInteger(m) || m < 1 || m > MAX_REMINDER_MINUTES)) err('has invalid reminder offsets.');
    if (!Array.isArray(r.history) || r.history.some((h) => !h || !isIso(h.at) || typeof h.action !== 'string')) err('has an invalid history entry.');
    if (r.temperature !== null && !(r.temperature && Number.isFinite(r.temperature.value) && ['C', 'F'].includes(r.temperature.unit))) err('has an invalid temperature.');

    const obsIds = new Set();
    for (const o of r.observations) {
      if (!o || typeof o.id !== 'string' || !o.id) {
        err('has an observation without an id.');
        continue;
      }
      if (obsIds.has(o.id)) err(`duplicate observation id "${o.id}".`);
      obsIds.add(o.id);
      if (!isIso(o.observedAt)) err(`observation ${o.id} has an invalid time.`);
      if (!Object.values(VERDICTS).includes(o.verdict)) err(`observation ${o.id} has an invalid answer.`);
      const st = o.observedStage ?? null;
      if (o.verdict === VERDICTS.UNCONFIRMED ? st !== null : !isValidStage(st)) err(`observation ${o.id} has an invalid observed stage.`);
      const e = o.estimate;
      if (!e || !Array.isArray(e.stages) || !e.stages.every(isValidStage) || e.stages[0] > e.stages[1] || typeof e.referenceVersion !== 'string') {
        err(`observation ${o.id} has an invalid estimate snapshot.`);
      }
      if (o.ageRangeMinutes !== undefined && !isRange(o.ageRangeMinutes)) err(`observation ${o.id} has an invalid age range.`);
    }
    const retracted = new Set();
    for (const x of r.retractions) {
      if (!x || !obsIds.has(x.observationId)) err('has a retraction for an observation that does not exist.');
      else if (retracted.has(x.observationId)) err(`observation ${x.observationId} is retracted twice.`);
      else if (!isIso(x.at) || typeof x.reason !== 'string' || !x.reason.trim()) err(`retraction of ${x.observationId} needs a time and a reason.`);
      if (x) retracted.add(x.observationId);
    }

    const p = r.stagePlan;
    if (p) {
      if (!['fresh', 'stage', 'entered'].includes(p.start)) err('stage plan has an invalid starting point.');
      if (!isValidStage(p.targetStage)) err('stage plan has an invalid target stage.');
      if (p.currentStage !== null && p.currentStage !== undefined) {
        if (!isValidStage(p.currentStage)) err('stage plan has an invalid current stage.');
        else if (isValidStage(p.targetStage) && p.targetStage <= p.currentStage) err('stage plan target is not later than the current stage.');
      }
      if (!isRange(p.baselineAgeHours)) err('stage plan has an invalid starting-age range.');
      if (!isRange(p.targetAgeHours)) err('stage plan has an invalid target reference-age range.');
      if (!isRange(p.windowHours)) err('stage plan has an invalid window.');
      if (!Object.hasOwn(PLANNED_RETURN, p.plannedReturn ?? '')) err('stage plan has an invalid planned-return option.');
      if (typeof p.referenceVersion !== 'string') err('stage plan is missing its reference version.');
    }
    records.push(r);
  });
  const MAX = 25;
  const shown = errors.length > MAX ? [...errors.slice(0, MAX), `…and ${errors.length - MAX} more problems.`] : errors;
  return { ok: errors.length === 0, errors: shown, records: errors.length ? [] : records, format };
}

/** Backwards-compatible wrapper: throws a StorageError listing the problems. */
export function validateImportedRecords(data, options) {
  const v = validateBackup(data, options);
  if (!v.ok) throw new StorageError(v.errors.join(' '));
  return v.records;
}

/** Copy of the current data kept before a restore replaces anything. */
export function savePreRestoreCopy(records, nowMs, storage = globalThis.localStorage) {
  const key = `${STORAGE_KEY}.pre-restore-${new Date(nowMs).toISOString()}`;
  storage.setItem(key, JSON.stringify({ schemaVersion: SCHEMA_VERSION, experiments: records }));
  return key;
}

// ---------- backup health ----------
// The browser cannot confirm that a downloaded file was actually saved, so this only records
// that a backup download was started, and says so.

export const BACKUP_META_KEY = 'embryotime.backup.v1';
export const BACKUP_MAX_AGE_DAYS = 7;

export function createBackupMetaStore(storage = globalThis.localStorage) {
  return {
    load() {
      try {
        const d = JSON.parse(storage?.getItem(BACKUP_META_KEY) ?? 'null');
        return d && isIso(d.lastDownloadStartedAt) ? d : null;
      } catch {
        return null;
      }
    },
    recordDownload(nowMs, recordCount) {
      try {
        storage.setItem(BACKUP_META_KEY, JSON.stringify({ lastDownloadStartedAt: new Date(nowMs).toISOString(), recordCount }));
      } catch {
        // Not critical; the status will simply stay unknown.
      }
    },
  };
}

/**
 * { state: 'empty'|'none'|'stale'|'changed'|'recent', lastMs } — 'changed' means records were
 * edited after the last backup download.
 */
export function backupStatus(meta, records, nowMs, maxAgeDays = BACKUP_MAX_AGE_DAYS) {
  if (!records.length) return { state: 'empty', lastMs: null };
  if (!meta) return { state: 'none', lastMs: null };
  const last = Date.parse(meta.lastDownloadStartedAt);
  if (nowMs - last > maxAgeDays * 86_400_000) return { state: 'stale', lastMs: last };
  const latestEdit = Math.max(...records.map((r) => Date.parse(r.updatedAt ?? r.createdAt ?? 0) || 0));
  if (latestEdit > last) return { state: 'changed', lastMs: last };
  return { state: 'recent', lastMs: last };
}
