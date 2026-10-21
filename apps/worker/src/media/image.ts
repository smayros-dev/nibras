import { imageSize } from 'image-size';

/** Outcome of `probeImage`: the displayed dimensions, or a refusal. */
export type ImageProbe =
  { ok: true; width: number; height: number } | { ok: false; reason: 'INVALID_SIGNATURE' };

/** The formats an IMAGE asset may be (`MEDIA_MIME_TYPES.IMAGE`), as `image-size` names them. */
const IMAGE_TYPES = new Set(['jpg', 'png', 'webp']);
/** Larger than any real image; guards the `int` columns against hostile headers. */
const MAX_DIMENSION = 100_000;

/**
 * Width and height of an uploaded image (`image-size`: headers only, no decoding; the input is
 * bounded by the IMAGE limit, 5 MiB). EXIF orientations 5–8 (rotated a quarter turn) swap the
 * two, so the stored numbers are the displayed ones. An unreadable header, another format or an
 * absurd size is `INVALID_SIGNATURE` (never thrown).
 */
export function probeImage(bytes: Uint8Array): ImageProbe {
  try {
    const size = imageSize(bytes);
    const valid = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= MAX_DIMENSION;
    if (!size.type || !IMAGE_TYPES.has(size.type) || !valid(size.width) || !valid(size.height)) {
      return { ok: false, reason: 'INVALID_SIGNATURE' };
    }
    const rotated = size.orientation !== undefined && size.orientation >= 5;
    return rotated
      ? { ok: true, width: size.height, height: size.width }
      : { ok: true, width: size.width, height: size.height };
  } catch {
    return { ok: false, reason: 'INVALID_SIGNATURE' };
  }
}
