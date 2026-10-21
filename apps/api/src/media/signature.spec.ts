import { S3_VIDEO_MIME_TYPES } from '@nibras/contracts';
import { describe, expect, it } from 'vitest';
import { EXE_BYTES, MP4_BYTES, PDF_BYTES, PNG_BYTES } from '../../test/media/fixtures';
import { assertSignature, detectSignature, SIGNATURE_BYTES } from './signature';

const reject = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    return error as { getStatus(): number; code: string; details: unknown };
  }
  throw new Error('expected a rejection');
};

describe('file signatures (SP3 T7, AC-MED-04)', () => {
  it('detects PDF, PNG, MP4 and an executable from their first bytes', async () => {
    expect(await detectSignature(PDF_BYTES)).toEqual({ mime: 'application/pdf', ext: 'pdf' });
    expect(await detectSignature(PNG_BYTES)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(await detectSignature(MP4_BYTES.subarray(0, SIGNATURE_BYTES))).toMatchObject({
      mime: 'video/mp4',
    });
    expect(await detectSignature(EXE_BYTES)).toMatchObject({ mime: 'application/x-msdownload' });
    expect(await detectSignature(Buffer.from('just some text'))).toBeNull();
  });

  it('accepts what the kind allows and returns the detected type (the declared one is advisory)', async () => {
    await expect(assertSignature('PDF', 'application/pdf', PDF_BYTES)).resolves.toMatchObject({
      mime: 'application/pdf',
    });
    await expect(assertSignature('IMAGE', 'image/jpeg', PNG_BYTES)).resolves.toMatchObject({
      mime: 'image/png',
    });
    await expect(
      assertSignature('VIDEO', 'video/mp4', MP4_BYTES, S3_VIDEO_MIME_TYPES),
    ).resolves.toMatchObject({ mime: 'video/mp4' });
    await expect(assertSignature('FILE', 'application/pdf', PNG_BYTES)).resolves.toMatchObject({
      mime: 'image/png',
    });
  });

  it('MZ declared as a PDF → 415 INVALID_FILE_SIGNATURE; unknown bytes → 415 with detected null', async () => {
    const exe = await reject(assertSignature('PDF', 'application/pdf', EXE_BYTES));
    expect(exe.getStatus()).toBe(415);
    expect(exe.code).toBe('INVALID_FILE_SIGNATURE');
    expect(exe.details).toEqual({ detected: 'application/x-msdownload', kind: 'PDF' });
    const text = await reject(assertSignature('IMAGE', 'image/png', Buffer.from('hello')));
    expect(text.getStatus()).toBe(415);
    expect(text.details).toEqual({ detected: null, kind: 'IMAGE' });
  });

  it('bytes of another kind → 422 MEDIA_KIND_MISMATCH (a PDF declared image/png, a PNG as a video)', async () => {
    const pdf = await reject(assertSignature('IMAGE', 'image/png', PDF_BYTES));
    expect(pdf.getStatus()).toBe(422);
    expect(pdf.code).toBe('MEDIA_KIND_MISMATCH');
    expect(pdf.details).toEqual({ detected: 'application/pdf', kind: 'IMAGE' });
    const png = await reject(assertSignature('VIDEO', 'video/mp4', PNG_BYTES, S3_VIDEO_MIME_TYPES));
    expect(png.code).toBe('MEDIA_KIND_MISMATCH');
  });
});
