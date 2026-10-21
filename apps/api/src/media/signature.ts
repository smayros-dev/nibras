import { HttpStatus } from '@nestjs/common';
import { MEDIA_MIME_TYPES, kindForMime, type UploadableMediaKind } from '@nibras/contracts';
import { fileTypeFromBuffer } from 'file-type';
import { ApiError } from '../common/api-error';

/** Bytes read from the start of an object for the signature check (`file-type`'s sample size). */
export const SIGNATURE_BYTES = 4100;

export interface DetectedType {
  mime: string;
  ext: string;
}

/** The type the bytes say they are (magic numbers, `file-type`), or `null` when unknown. */
export async function detectSignature(bytes: Uint8Array): Promise<DetectedType | null> {
  const found = await fileTypeFromBuffer(bytes.subarray(0, SIGNATURE_BYTES));
  return found ? { mime: found.mime, ext: found.ext } : null;
}

/**
 * The signature decides, not the declared mime (spec §4.3, AC-MED-04): the detected type must be
 * one the kind accepts (`MEDIA_MIME_TYPES[kind]`; VIDEO: `acceptedVideo`, the provider's list).
 * Bytes of another media kind (a PDF uploaded as an image) → `422 MEDIA_KIND_MISMATCH`; anything
 * else (an executable, unknown bytes) → `415 INVALID_FILE_SIGNATURE`. Both carry
 * `{ detected, kind }`. Returns the detected type, which replaces the declared one.
 */
export async function assertSignature(
  kind: UploadableMediaKind,
  declaredMime: string,
  bytes: Uint8Array,
  acceptedVideo: readonly string[] = MEDIA_MIME_TYPES.VIDEO,
): Promise<DetectedType> {
  const detected = await detectSignature(bytes);
  const accepted = kind === 'VIDEO' ? acceptedVideo : MEDIA_MIME_TYPES[kind];
  if (detected && accepted.includes(detected.mime)) return detected;
  const details = { detected: detected?.mime ?? null, kind };
  const detectedKind = detected ? kindForMime(detected.mime) : null;
  if (detectedKind !== null && detectedKind !== kind) {
    throw new ApiError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'MEDIA_KIND_MISMATCH',
      `The file is not a ${kind.toLowerCase()} (declared ${declaredMime})`,
      details,
    );
  }
  throw new ApiError(
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    'INVALID_FILE_SIGNATURE',
    `The file content does not match an accepted ${kind.toLowerCase()} type`,
    details,
  );
}
