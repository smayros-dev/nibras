import { describe, expect, it } from 'vitest';

import {
  box,
  buildMp4,
  ftyp,
  mvhd,
  rawHeader,
  rawLargeHeader,
  readerOf,
  trak,
} from './fixtures/mp4-fixture';
import { MOOV_MAX_BYTES, NotMp4Error, probeMp4 } from './mp4-probe';

const NULLS = { durationS: null, width: null, height: null };

describe('probeMp4', () => {
  it('reads duration and dimensions from a faststart file and from a moov-at-end file', async () => {
    for (const moovFirst of [true, false]) {
      const buf = buildMp4({
        moovFirst,
        timescale: 1000,
        duration: 12_345,
        width: 1280,
        height: 720,
        mdatBytes: 100_000,
      });
      const probe = await probeMp4((s, e) => Promise.resolve(buf.subarray(s, e + 1)), buf.length);
      expect(probe).toEqual({ durationS: 12, width: 1280, height: 720, brand: 'isom' });
    }
  });

  it('does not read the mdat payload when moov is at the end', async () => {
    const buf = buildMp4({
      moovFirst: false,
      timescale: 1000,
      duration: 5000,
      width: 640,
      height: 360,
      mdatBytes: 2_000_000,
    });
    const { read, calls } = readerOf(buf);
    await probeMp4(read, buf.length);
    const bytesRead = calls.reduce((n, [s, e]) => n + (e - s + 1), 0);
    expect(bytesRead).toBeLessThan(2_000);
  });

  it('handles mvhd version 1 (64-bit duration) and a 64-bit largesize mdat', async () => {
    const buf = buildMp4({
      moovFirst: false,
      timescale: 90_000,
      duration: 90_000n * 3_600n,
      width: 1920,
      height: 1080,
      mdatBytes: 1000,
      mvhdVersion: 1,
      largeMdat: true,
      brand: 'mp42',
    });
    const { read } = readerOf(buf);
    expect(await probeMp4(read, buf.length)).toEqual({
      durationS: 3600,
      width: 1920,
      height: 1080,
      brand: 'mp42',
    });
  });

  it('takes the dimensions of the first video track, skipping an audio track', async () => {
    const buf = buildMp4({
      moovFirst: true,
      timescale: 600,
      duration: 6000,
      width: 854,
      height: 480,
      mdatBytes: 10,
      audioFirst: true,
    });
    const { read } = readerOf(buf);
    expect(await probeMp4(read, buf.length)).toMatchObject({ width: 854, height: 480 });
  });

  it('refuses a non-mp4 (no leading ftyp) with NotMp4Error', async () => {
    for (const buf of [
      Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj'),
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]), // WebM / EBML
      Buffer.concat([box('mdat', Buffer.alloc(16)), ftyp()]),
      Buffer.alloc(0),
      Buffer.from('MZ'),
    ]) {
      const { read } = readerOf(buf);
      await expect(probeMp4(read, buf.length)).rejects.toBeInstanceOf(NotMp4Error);
    }
  });

  it('reports unknown duration as null (all-ones duration, zero timescale)', async () => {
    for (const [timescale, duration] of [
      [1000, 0xffffffff],
      [0, 1000],
    ] as const) {
      const buf = Buffer.concat([
        ftyp(),
        box('moov', Buffer.concat([mvhd(0, timescale, duration), trak('vide', 320, 240)])),
      ]);
      const { read } = readerOf(buf);
      expect(await probeMp4(read, buf.length)).toEqual({
        durationS: null,
        width: 320,
        height: 240,
        brand: 'isom',
      });
    }
  });

  it('a moov above the bound is not read: nulls, and no read larger than the bound', async () => {
    const claimed = MOOV_MAX_BYTES + 1024;
    const head = Buffer.concat([ftyp(), rawHeader('moov', claimed)]);
    const fileSize = head.length + claimed - 8;
    const { read, calls } = readerOf(head);
    expect(await probeMp4(read, fileSize)).toEqual({ ...NULLS, brand: 'isom' });
    for (const [s, e] of calls) expect(e - s + 1).toBeLessThanOrEqual(MOOV_MAX_BYTES);
  });

  it('survives hostile box sizes without throwing or over-reading', async () => {
    const f = ftyp();
    const cases: Array<{ buf: Buffer; fileSize?: number }> = [
      // size smaller than its own header
      { buf: Buffer.concat([f, rawHeader('free', 4)]) },
      { buf: Buffer.concat([f, rawHeader('moov', 7)]) },
      // size beyond the end of the file (truncated upload)
      { buf: Buffer.concat([f, rawHeader('moov', 0xfffffff0)]) },
      { buf: Buffer.concat([f, rawHeader('mdat', 0xffffffff)]) },
      // 64-bit largesize: absurd, beyond MAX_SAFE_INTEGER, smaller than its header
      { buf: Buffer.concat([f, rawLargeHeader('moov', 0xffffffffffffffffn)]) },
      { buf: Buffer.concat([f, rawLargeHeader('mdat', 2n ** 60n)]) },
      { buf: Buffer.concat([f, rawLargeHeader('moov', 3n)]) },
      // size 0 = to the end of the file, with a garbage moov
      { buf: Buffer.concat([f, rawHeader('moov', 0), Buffer.alloc(32, 0xff)]) },
      // children with lying sizes inside an otherwise valid moov
      {
        buf: Buffer.concat([
          f,
          box('moov', Buffer.concat([rawHeader('mvhd', 0xffffffff), Buffer.alloc(40)])),
        ]),
      },
      {
        buf: Buffer.concat([
          f,
          box('moov', Buffer.concat([rawHeader('trak', 9), Buffer.alloc(1)])),
        ]),
      },
      // a truncated mvhd/tkhd
      { buf: Buffer.concat([f, box('moov', box('mvhd', Buffer.alloc(6)))]) },
      { buf: Buffer.concat([f, box('moov', box('trak', box('tkhd', Buffer.alloc(30))))]) },
      // the declared size is larger than what the reader really returns
      {
        buf: buildMp4({
          moovFirst: false,
          timescale: 1,
          duration: 1,
          width: 1,
          height: 1,
          mdatBytes: 64,
        }).subarray(0, 60),
        fileSize: 400,
      },
      // a ftyp whose own size lies
      { buf: Buffer.concat([rawHeader('ftyp', 0xffffffff), Buffer.from('isom')]) },
      { buf: Buffer.concat([rawHeader('ftyp', 9), Buffer.from('x')]) },
    ];
    for (const { buf, fileSize } of cases) {
      const { read, calls } = readerOf(buf);
      const result = await probeMp4(read, fileSize ?? buf.length);
      expect(result).toMatchObject(NULLS);
      for (const [s, e] of calls) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(e).toBeGreaterThanOrEqual(s);
        expect(e - s + 1).toBeLessThanOrEqual(MOOV_MAX_BYTES);
      }
    }
  });

  it('every truncation of a valid file resolves or throws NotMp4Error', async () => {
    const buf = buildMp4({
      moovFirst: false,
      timescale: 1000,
      duration: 2000,
      width: 16,
      height: 16,
      mdatBytes: 32,
    });
    for (let cut = 0; cut <= buf.length; cut++) {
      const prefix = buf.subarray(0, cut);
      const { read } = readerOf(prefix);
      // the real size, and a lying larger size (the store returned fewer bytes than asked)
      for (const size of [cut, buf.length]) {
        try {
          const r = await probeMp4(read, size);
          if (cut < buf.length) expect(r.durationS).toBeNull();
          else if (size === buf.length) expect(r.durationS).toBe(2);
        } catch (error) {
          expect(error).toBeInstanceOf(NotMp4Error);
        }
      }
    }
  });

  it('random bytes after a valid ftyp never throw anything but NotMp4Error', async () => {
    let seed = 0x5eed;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed;
    };
    const valid = buildMp4({
      moovFirst: true,
      timescale: 1000,
      duration: 1000,
      width: 2,
      height: 2,
      mdatBytes: 8,
    });
    for (let i = 0; i < 400; i++) {
      const mutated = Buffer.from(valid);
      // flip a few bytes (sizes and types included), sometimes in the ftyp
      for (let k = 0; k < 1 + (rand() % 6); k++) mutated[rand() % mutated.length] = rand() & 0xff;
      const { read, calls } = readerOf(mutated);
      try {
        await probeMp4(read, mutated.length);
      } catch (error) {
        expect(error).toBeInstanceOf(NotMp4Error);
      }
      expect(calls.length).toBeLessThan(2_000);
    }
  });

  it('refuses an invalid file size', async () => {
    const { read } = readerOf(Buffer.alloc(0));
    for (const size of [-1, Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
      await expect(probeMp4(read, size)).rejects.toBeInstanceOf(RangeError);
    }
  });
});
