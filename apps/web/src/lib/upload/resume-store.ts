import type { UploadableMediaKind } from '@nibras/contracts/web';

/**
 * Where an interrupted S3 multipart upload is remembered (AC-MED-01): `localStorage`
 * `nibras-upload:{mediaId}`. Only what identifies the file and the parts already sent — never a
 * presigned URL (bearer secrets). Every access is wrapped: a private window, blocked site data or
 * a throwing accessor makes the store empty, never breaks the upload.
 */
export interface ResumeRecord {
  mediaId: string;
  wid: string;
  kind: UploadableMediaKind;
  fileName: string;
  size: number;
  lastModified: number;
  partCount: number;
  /** Part numbers already stored (sorted, unique). */
  done: number[];
}

/** The subset of `Storage` used here (injectable for tests). */
export interface KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'nibras-upload:';

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): ResumeRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ResumeRecord> | null;
    if (
      !value ||
      typeof value.mediaId !== 'string' ||
      typeof value.fileName !== 'string' ||
      typeof value.size !== 'number' ||
      typeof value.lastModified !== 'number' ||
      !Array.isArray(value.done)
    ) {
      return null;
    }
    return value as ResumeRecord;
  } catch {
    return null;
  }
}

export function saveRecord(
  record: ResumeRecord,
  storage: KeyValueStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(PREFIX + record.mediaId, JSON.stringify(record));
  } catch {
    // Quota or access denied: the upload goes on, it just cannot be resumed after a reload.
  }
}

export function loadRecord(
  mediaId: string,
  storage: KeyValueStorage | null = defaultStorage(),
): ResumeRecord | null {
  try {
    return parse(storage?.getItem(PREFIX + mediaId) ?? null);
  } catch {
    return null;
  }
}

/** Adds `partNumber` to the record's `done` parts (no-op when the record is gone). */
export function markPartDone(
  mediaId: string,
  partNumber: number,
  storage: KeyValueStorage | null = defaultStorage(),
): void {
  const record = loadRecord(mediaId, storage);
  if (!record || record.done.includes(partNumber)) return;
  const done = [...record.done, partNumber].sort((a, b) => a - b);
  saveRecord({ ...record, done }, storage);
}

export function clearRecord(
  mediaId: string,
  storage: KeyValueStorage | null = defaultStorage(),
): void {
  try {
    storage?.removeItem(PREFIX + mediaId);
  } catch {
    // Nothing to do.
  }
}

/**
 * The stored upload of the same file (name + size + lastModified) in the same workspace and of
 * the same kind, or `null`.
 */
export function findResumable(
  file: { name: string; size: number; lastModified: number },
  scope: { wid: string; kind: UploadableMediaKind },
  storage: KeyValueStorage | null = defaultStorage(),
): ResumeRecord | null {
  try {
    if (!storage) return null;
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const record = parse(storage.getItem(key));
      if (
        record &&
        record.fileName === file.name &&
        record.size === file.size &&
        record.lastModified === file.lastModified &&
        record.wid === scope.wid &&
        record.kind === scope.kind
      ) {
        return record;
      }
    }
    return null;
  } catch {
    return null;
  }
}
