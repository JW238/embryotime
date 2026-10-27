// Persistence. The MVP stores everything in the browser's localStorage.
//
// The repository is async on purpose: a future server/database backend can implement
// the same four methods (list, save, remove, replaceAll) without touching the UI.

import { SCHEMA_VERSION, normalizeRecord } from './experiment.js';

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

/** Minimal shape check for imported backup files. */
export function validateImportedRecords(data) {
  const list = Array.isArray(data) ? data : data?.experiments;
  if (!Array.isArray(list)) throw new StorageError('File does not contain an experiments list.');
  const required = ['uid', 'experimentId', 'name', 'placementAt', 'targetAt', 'originalTargetAt', 'timeZone', 'waitMinutes', 'currentIncubationMinutes', 'status'];
  list.forEach((r, i) => {
    for (const key of required) {
      if (r?.[key] === undefined || r?.[key] === null) throw new StorageError(`Record ${i + 1} is missing "${key}".`);
    }
    if (Number.isNaN(Date.parse(r.targetAt)) || Number.isNaN(Date.parse(r.placementAt))) {
      throw new StorageError(`Record ${i + 1} has an invalid timestamp.`);
    }
  });
  return list.map((r) =>
    normalizeRecord({ history: [], reminderOffsets: [], notes: '', conditions: '', batchId: '', calendar: { exportedAt: null, exportedTargetAt: null, sequence: 0 }, ...r })
  );
}
