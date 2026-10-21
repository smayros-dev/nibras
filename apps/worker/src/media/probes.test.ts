import { describe, expect, it } from 'vitest';

import { buildPdf, ENCRYPTED_PDF_BYTES, PNG_1X1, pngHeader } from '../../test/fixtures/media';
import { probeImage } from './image';
import { probePdf } from './pdf';

/** A PDF whose page tree points back at itself (hostile: an endless traversal). */
function cyclicPdf(): Buffer {
  const src = buildPdf(1).toString('latin1').replace('/Kids [3 0 R]', '/Kids [2 0 R 3 0 R]');
  return Buffer.from(src, 'latin1');
}

describe('probePdf (pdf-lib 1.17.1)', () => {
  it('counts the pages of a well-formed document', async () => {
    await expect(probePdf(buildPdf(3))).resolves.toEqual({ ok: true, pageCount: 3 });
  });

  it('refuses encrypted, corrupt, empty and cyclic documents without throwing', async () => {
    await expect(probePdf(ENCRYPTED_PDF_BYTES)).resolves.toEqual({
      ok: false,
      reason: 'ENCRYPTED',
    });
    await expect(probePdf(Buffer.from('%PDF-1.7\n\u0000\u0000garbage'))).resolves.toEqual({
      ok: false,
      reason: 'INVALID_SIGNATURE',
    });
    await expect(probePdf(buildPdf(0))).resolves.toEqual({
      ok: false,
      reason: 'INVALID_SIGNATURE',
    });
    await expect(probePdf(cyclicPdf())).resolves.toMatchObject({ ok: expect.any(Boolean) });
  });
});

describe('probeImage (image-size 2.0.4)', () => {
  it('reads PNG headers', () => {
    expect(probeImage(PNG_1X1)).toEqual({ ok: true, width: 1, height: 1 });
    expect(probeImage(pngHeader(800, 600))).toEqual({ ok: true, width: 800, height: 600 });
  });

  it('refuses other formats, truncated headers and absurd sizes', () => {
    const gif = Buffer.from('474946383961010001000000', 'hex'); // GIF89a 1×1
    expect(probeImage(gif)).toEqual({ ok: false, reason: 'INVALID_SIGNATURE' });
    expect(probeImage(PNG_1X1.subarray(0, 12))).toEqual({ ok: false, reason: 'INVALID_SIGNATURE' });
    expect(probeImage(pngHeader(1_000_000, 1))).toEqual({ ok: false, reason: 'INVALID_SIGNATURE' });
    expect(probeImage(pngHeader(0, 10))).toEqual({ ok: false, reason: 'INVALID_SIGNATURE' });
  });
});
