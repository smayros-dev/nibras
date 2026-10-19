// Test-only: builds minimal ISO-BMFF (MP4) files in memory for the probe tests.

/** A box: 32-bit size + 4-char type + payload (or the 64-bit `largesize` form). */
export function box(type: string, payload: Uint8Array = new Uint8Array(), large = false): Buffer {
  const header = large ? 16 : 8;
  const out = Buffer.alloc(header + payload.length);
  if (large) {
    out.writeUInt32BE(1, 0);
    out.write(type, 4, 'latin1');
    out.writeBigUInt64BE(BigInt(out.length), 8);
  } else {
    out.writeUInt32BE(out.length, 0);
    out.write(type, 4, 'latin1');
  }
  out.set(payload, header);
  return out;
}

/** A raw box header claiming `size` (32-bit field) without the matching payload. */
export function rawHeader(type: string, size: number): Buffer {
  const out = Buffer.alloc(8);
  out.writeUInt32BE(size, 0);
  out.write(type, 4, 'latin1');
  return out;
}

/** A 16-byte header with `size = 1` and the given 64-bit `largesize`. */
export function rawLargeHeader(type: string, largesize: bigint): Buffer {
  const out = Buffer.alloc(16);
  out.writeUInt32BE(1, 0);
  out.write(type, 4, 'latin1');
  out.writeBigUInt64BE(largesize, 8);
  return out;
}

export function ftyp(brand = 'isom'): Buffer {
  const payload = Buffer.alloc(16);
  payload.write(brand, 0, 'latin1');
  payload.writeUInt32BE(0x200, 4);
  payload.write('isom', 8, 'latin1');
  payload.write('mp41', 12, 'latin1');
  return box('ftyp', payload);
}

export function mvhd(version: 0 | 1, timescale: number, duration: number | bigint): Buffer {
  if (version === 0) {
    const p = Buffer.alloc(100);
    p.writeUInt32BE(0, 0); // version 0 + flags
    p.writeUInt32BE(timescale, 12);
    p.writeUInt32BE(Number(duration), 16);
    return box('mvhd', p);
  }
  const p = Buffer.alloc(112);
  p.writeUInt8(1, 0);
  p.writeUInt32BE(timescale, 20);
  p.writeBigUInt64BE(BigInt(duration), 24);
  return box('mvhd', p);
}

export function tkhd(version: 0 | 1, width: number, height: number): Buffer {
  const before = version === 0 ? 24 : 36;
  const p = Buffer.alloc(before + 52 + 8);
  p.writeUInt8(version, 0);
  p.writeUInt32BE(width * 65536, before + 52);
  p.writeUInt32BE(height * 65536, before + 56);
  return box('tkhd', p);
}

export function hdlr(handler: string): Buffer {
  const p = Buffer.alloc(25);
  p.write(handler, 8, 'latin1');
  return box('hdlr', p);
}

export function trak(handler: string, width: number, height: number, version: 0 | 1 = 0): Buffer {
  return box('trak', Buffer.concat([tkhd(version, width, height), box('mdia', hdlr(handler))]));
}

export interface Mp4Options {
  moovFirst: boolean;
  timescale: number;
  duration: number | bigint;
  width: number;
  height: number;
  mdatBytes: number;
  mvhdVersion?: 0 | 1;
  brand?: string;
  /** Prepends an audio track (zero dimensions) before the video one. */
  audioFirst?: boolean;
  /** Writes `mdat` with the 64-bit `largesize` header. */
  largeMdat?: boolean;
}

/** `ftyp`, then `moov` before or after an `mdat` of `mdatBytes` bytes. */
export function buildMp4(o: Mp4Options): Buffer {
  const traks = [
    ...(o.audioFirst ? [trak('soun', 0, 0)] : []),
    trak('vide', o.width, o.height, o.mvhdVersion ?? 0),
  ];
  const moov = box(
    'moov',
    Buffer.concat([mvhd(o.mvhdVersion ?? 0, o.timescale, o.duration), ...traks]),
  );
  const mdat = box('mdat', Buffer.alloc(o.mdatBytes, 0xab), o.largeMdat ?? false);
  return Buffer.concat(
    o.moovFirst ? [ftyp(o.brand), moov, mdat] : [ftyp(o.brand), mdat, box('free'), moov],
  );
}

/** An inclusive-range reader over `buf` that records every call. */
export function readerOf(buf: Uint8Array) {
  const calls: Array<[number, number]> = [];
  const read = (start: number, end: number) => {
    calls.push([start, end]);
    return Promise.resolve(buf.subarray(start, end + 1));
  };
  return { read, calls };
}
