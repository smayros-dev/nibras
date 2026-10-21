import { sanitizeFilename, type MediaKind } from '@nibras/contracts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND_SEGMENT = /^[a-z]+$/;
const FILENAME_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertUuid(name: string, value: string): void {
  if (!UUID.test(value)) throw new Error(`${name} must be a uuid, got "${value}"`);
}

/** `w/{workspaceId}/{kind lower-case}/{mediaId}/{sanitizeFilename(filename)}` (spec §6). */
export function storageKeyFor(input: {
  workspaceId: string;
  kind: MediaKind;
  mediaId: string;
  filename: string;
}): string {
  assertUuid('workspaceId', input.workspaceId);
  assertUuid('mediaId', input.mediaId);
  return `w/${input.workspaceId}/${input.kind.toLowerCase()}/${input.mediaId}/${sanitizeFilename(input.filename)}`;
}

/** True when `key` has exactly the `storageKeyFor` shape and belongs to `workspaceId`. */
export function isStorageKeyOf(key: string, workspaceId: string): boolean {
  const parts = key.split('/');
  if (parts.length !== 5) return false;
  const [root, wid, kind, mediaId, filename] = parts as [string, string, string, string, string];
  return (
    root === 'w' &&
    UUID.test(wid) &&
    wid.toLowerCase() === workspaceId.toLowerCase() &&
    KIND_SEGMENT.test(kind) &&
    UUID.test(mediaId) &&
    FILENAME_SEGMENT.test(filename) &&
    filename !== '.' &&
    filename !== '..'
  );
}
