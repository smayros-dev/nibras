// Test-only byte fixtures of the worker media spec (SP3 T8): real file structures, built in code.

/**
 * A minimal, well-formed PDF with `pages` empty A4 pages (catalog, page tree, pages, xref,
 * trailer). `encrypted` adds a Standard security handler dictionary referenced by the trailer's
 * `/Encrypt` (what makes `pdf-lib` refuse the document with `EncryptedPDFError`).
 */
export function buildPdf(pages = 2, o: { encrypted?: boolean } = {}): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ')}] /Count ${pages} >>`,
    ...Array.from(
      { length: pages },
      () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
    ),
  ];
  if (o.encrypted) {
    objects.push(
      '<< /Filter /Standard /V 1 /R 2 /Length 40 /P -44 ' +
        '/O <0000000000000000000000000000000000000000000000000000000000000000> ' +
        '/U <0000000000000000000000000000000000000000000000000000000000000000> >>',
    );
  }
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((off) => `${String(off).padStart(10, '0')} 00000 n \n`).join('');
  const encrypt = o.encrypted
    ? ` /Encrypt ${objects.length} 0 R /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>]`
    : '';
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypt} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export const PDF_BYTES = buildPdf(2);
export const ENCRYPTED_PDF_BYTES = buildPdf(1, { encrypted: true });
/** `%PDF-` then garbage: passes the signature check at `complete`, no readable document. */
export const BROKEN_PDF_BYTES = Buffer.concat([
  Buffer.from('%PDF-1.4\n', 'latin1'),
  Buffer.alloc(2048, 0x00),
]);

/** A 1×1 PNG. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** A PNG signature and `IHDR` declaring `width`×`height` (headers are all `image-size` reads). */
export function pngHeader(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(8 + 13 + 4);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.writeUInt8(8, 16); // bit depth
  ihdr.writeUInt8(6, 17); // RGBA
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), ihdr]);
}

// ---- MP4 (a copy of the providers' probe fixture: ftyp, moov/mvhd/trak, mdat) ----

function box(type: string, payload: Uint8Array = new Uint8Array()): Buffer {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(out.length, 0);
  out.write(type, 4, 'latin1');
  out.set(payload, 8);
  return out;
}

function ftyp(brand: string): Buffer {
  const p = Buffer.alloc(16);
  p.write(brand, 0, 'latin1');
  p.writeUInt32BE(0x200, 4);
  p.write('isom', 8, 'latin1');
  p.write('mp41', 12, 'latin1');
  return box('ftyp', p);
}

function mvhd(timescale: number, duration: number): Buffer {
  const p = Buffer.alloc(100);
  p.writeUInt32BE(timescale, 12);
  p.writeUInt32BE(duration, 16);
  return box('mvhd', p);
}

function trak(width: number, height: number): Buffer {
  const tkhd = Buffer.alloc(24 + 52 + 8);
  tkhd.writeUInt32BE(width * 65536, 24 + 52);
  tkhd.writeUInt32BE(height * 65536, 24 + 56);
  const hdlr = Buffer.alloc(25);
  hdlr.write('vide', 8, 'latin1');
  return box('trak', Buffer.concat([box('tkhd', tkhd), box('mdia', box('hdlr', hdlr))]));
}

/** A faststart MP4 (`ftyp`, `moov`, `mdat`) of `durationMs` (timescale 1000) at `width`×`height`. */
export function buildMp4(
  o: { durationMs?: number; width?: number; height?: number; mdatBytes?: number } = {},
): Buffer {
  const moov = box(
    'moov',
    Buffer.concat([mvhd(1000, o.durationMs ?? 12_345), trak(o.width ?? 1280, o.height ?? 720)]),
  );
  return Buffer.concat([ftyp('isom'), moov, box('mdat', Buffer.alloc(o.mdatBytes ?? 4096, 0xab))]);
}
