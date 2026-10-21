/**
 * Minimal ISO-BMFF (MP4) probe for the S3 passthrough provider (spec §6): walks the top-level
 * boxes with ranged reads, then parses `moov` (bounded) for `mvhd` (duration) and the first video
 * `trak/tkhd` (dimensions). The input is untrusted: every size is checked against its parent and
 * the file, reads are bounded, and malformed or truncated structures end the walk with `null`s
 * instead of throwing. Only a file that does not start with `ftyp` throws (`NotMp4Error`).
 */

export interface Mp4Probe {
  durationS: number | null;
  width: number | null;
  height: number | null;
  /** `ftyp` major brand (e.g. `isom`, `mp42`). */
  brand: string | null;
}

/** Inclusive byte range reader (HTTP Range semantics), e.g. `StorageProvider.getRange`. */
export type RangeReader = (start: number, end: number) => Promise<Uint8Array>;

export class NotMp4Error extends Error {
  constructor() {
    super('Not an MP4 file (no leading ftyp box)');
    this.name = 'NotMp4Error';
  }
}

/** Largest `moov` payload read into memory; above it the metadata is reported unknown. */
export const MOOV_MAX_BYTES = 8 * 1024 * 1024;
/** Top-level boxes visited before giving up (a real file has a handful). */
const MAX_TOP_LEVEL_BOXES = 1024;
/** Child boxes visited per container inside `moov`. */
const MAX_CHILD_BOXES = 4096;
/** Durations above this (≈ 68 years, the `Int` column limit) are reported unknown. */
const MAX_DURATION_S = 2 ** 31 - 1;
/** `trak` boxes inspected for the video track. */
const MAX_TRACKS = 64;

interface BoxHeader {
  type: string;
  /** Total size including the header. */
  size: number;
  headerSize: number;
}

const ascii = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);

const isPrintable = (s: string) => /^[\x20-\x7e]{4}$/.test(s);

/**
 * Parses a box header at `at` in `bytes`; `available` = bytes left in the parent (from `at`).
 * Returns `null` when the header is truncated, the size is smaller than the header, exceeds the
 * parent, or is not a safe integer.
 */
function parseHeader(bytes: Uint8Array, at: number, available: number): BoxHeader | null {
  if (available < 8 || at + 8 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + at);
  const size32 = view.getUint32(0);
  const type = ascii(bytes, at + 4);
  let size: number;
  let headerSize = 8;
  if (size32 === 1) {
    if (available < 16 || at + 16 > bytes.length) return null;
    const large = view.getBigUint64(8);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(large);
    headerSize = 16;
  } else if (size32 === 0) {
    size = available; // extends to the end of the parent
  } else {
    size = size32;
  }
  if (size < headerSize || size > available) return null;
  return { type, size, headerSize };
}

/** Iterates the child boxes of `bytes[start, end)`, stopping at the first malformed one. */
function* children(bytes: Uint8Array, start: number, end: number) {
  let at = start;
  for (let i = 0; i < MAX_CHILD_BOXES && at < end; i++) {
    const header = parseHeader(bytes, at, end - at);
    if (!header) return;
    yield { type: header.type, start: at + header.headerSize, end: at + header.size };
    at += header.size;
  }
}

function findChild(bytes: Uint8Array, start: number, end: number, type: string) {
  for (const child of children(bytes, start, end)) if (child.type === type) return child;
  return null;
}

function parseMvhd(bytes: Uint8Array, start: number, end: number): number | null {
  const len = end - start;
  if (len < 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, len);
  const version = view.getUint8(0);
  let timescale: number;
  let duration: bigint;
  if (version === 1) {
    if (len < 32) return null;
    timescale = view.getUint32(20);
    duration = view.getBigUint64(24);
    if (duration === 0xffffffffffffffffn) return null;
  } else if (version === 0) {
    if (len < 20) return null;
    timescale = view.getUint32(12);
    const d = view.getUint32(16);
    if (d === 0xffffffff) return null;
    duration = BigInt(d);
  } else {
    return null;
  }
  if (timescale === 0) return null;
  const seconds = Math.round(Number(duration) / timescale);
  // Beyond a 32-bit column it is garbage, not a duration.
  return seconds <= MAX_DURATION_S ? seconds : null;
}

function parseTkhd(
  bytes: Uint8Array,
  start: number,
  end: number,
): { width: number; height: number } | null {
  const len = end - start;
  if (len < 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, len);
  const version = view.getUint8(0);
  const widthAt = version === 1 ? 88 : version === 0 ? 76 : -1;
  if (widthAt < 0 || len < widthAt + 8) return null;
  // 16.16 fixed point: keep the integer part.
  return { width: view.getUint32(widthAt) >>> 16, height: view.getUint32(widthAt + 4) >>> 16 };
}

function handlerOf(bytes: Uint8Array, trakStart: number, trakEnd: number): string | null {
  const mdia = findChild(bytes, trakStart, trakEnd, 'mdia');
  const hdlr = mdia && findChild(bytes, mdia.start, mdia.end, 'hdlr');
  if (!hdlr || hdlr.end - hdlr.start < 12) return null;
  return ascii(bytes, hdlr.start + 8);
}

function parseMoov(moov: Uint8Array): Omit<Mp4Probe, 'brand'> {
  let durationS: number | null = null;
  let dims: { width: number; height: number } | null = null;
  let fallback: { width: number; height: number } | null = null;
  let tracks = 0;
  for (const child of children(moov, 0, moov.length)) {
    if (child.type === 'mvhd' && durationS === null) {
      durationS = parseMvhd(moov, child.start, child.end);
    } else if (child.type === 'trak' && !dims && tracks++ < MAX_TRACKS) {
      const tkhd = findChild(moov, child.start, child.end, 'tkhd');
      const size = tkhd && parseTkhd(moov, tkhd.start, tkhd.end);
      if (!size || size.width === 0 || size.height === 0) continue;
      if (handlerOf(moov, child.start, child.end) === 'vide') dims = size;
      else fallback ??= size;
    }
  }
  const found = dims ?? fallback;
  return { durationS, width: found?.width ?? null, height: found?.height ?? null };
}

/** Reads exactly `end - start + 1` bytes or returns `null` (short read = truncated object). */
async function readExact(read: RangeReader, start: number, end: number) {
  const bytes = await read(start, end);
  return bytes.length === end - start + 1 ? bytes : null;
}

export async function probeMp4(read: RangeReader, fileSize: number): Promise<Mp4Probe> {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
    throw new RangeError(`Invalid file size: ${fileSize}`);
  }
  if (fileSize < 8) throw new NotMp4Error();

  // ftyp: header + major brand.
  const first = await read(0, Math.min(fileSize, 20) - 1);
  if (first.length < 8 || ascii(first, 4) !== 'ftyp') throw new NotMp4Error();
  const result: Mp4Probe = { durationS: null, width: null, height: null, brand: null };
  const ftyp = parseHeader(first, 0, fileSize);
  if (ftyp && ftyp.size >= ftyp.headerSize + 4 && first.length >= ftyp.headerSize + 4) {
    const brand = ascii(first, ftyp.headerSize);
    result.brand = isPrintable(brand) ? brand : null;
  }
  if (!ftyp) return result;

  let offset = ftyp.size;
  for (let i = 0; i < MAX_TOP_LEVEL_BOXES && offset + 8 <= fileSize; i++) {
    const head = await read(offset, Math.min(fileSize, offset + 16) - 1);
    const header = parseHeader(head, 0, fileSize - offset);
    if (!header) break;
    if (header.type === 'moov') {
      const payloadSize = header.size - header.headerSize;
      if (payloadSize > MOOV_MAX_BYTES || payloadSize === 0) break;
      const start = offset + header.headerSize;
      const moov = await readExact(read, start, start + payloadSize - 1);
      if (moov) Object.assign(result, parseMoov(moov));
      break;
    }
    offset += header.size; // size >= 8: always progresses
  }
  return result;
}
