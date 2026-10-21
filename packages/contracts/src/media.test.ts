import { describe, expect, it } from 'vitest';
import {
  CompleteUploadSchema,
  CreateUploadSchema,
  MediaQuerySchema,
  PlaybackSchema,
  UploadTicketSchema,
} from './media';
import { MEDIA_LIMITS } from './media-constants';

const ID = '0192f2a0-0000-7000-8000-000000000001';

describe('media inputs', () => {
  it('CreateUploadSchema accepts a PDF within limits and trims the filename', () => {
    expect(
      CreateUploadSchema.parse({
        kind: 'PDF',
        filename: ' cours.pdf ',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }),
    ).toEqual({ kind: 'PDF', filename: 'cours.pdf', mimeType: 'application/pdf', sizeBytes: 1024 });
  });

  it('CreateUploadSchema refuses VIDEO over 4 GiB, PDF as image/png and the RECORDING kind', () => {
    const over = CreateUploadSchema.safeParse({
      kind: 'VIDEO',
      filename: 'v.mp4',
      mimeType: 'video/mp4',
      sizeBytes: MEDIA_LIMITS.VIDEO.maxBytes + 1,
    });
    expect(over.success).toBe(false);
    expect(over.error?.issues.map((i) => i.path.join('.'))).toContain('sizeBytes');
    expect(
      CreateUploadSchema.safeParse({
        kind: 'VIDEO',
        filename: 'v.mp4',
        mimeType: 'video/mp4',
        sizeBytes: MEDIA_LIMITS.VIDEO.maxBytes,
      }).success,
    ).toBe(true);
    const mime = CreateUploadSchema.safeParse({
      kind: 'PDF',
      filename: 'x.pdf',
      mimeType: 'image/png',
      sizeBytes: 10,
    });
    expect(mime.success).toBe(false);
    expect(mime.error?.issues.map((i) => i.path.join('.'))).toContain('mimeType');
    expect(
      CreateUploadSchema.safeParse({
        kind: 'RECORDING',
        filename: 'r.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 10,
      }).success,
    ).toBe(false);
    expect(
      CreateUploadSchema.safeParse({
        kind: 'IMAGE',
        filename: 'i.png',
        mimeType: 'image/png',
        sizeBytes: 0,
      }).success,
    ).toBe(false);
  });

  it('UploadTicketSchema parses both modes', () => {
    const expiresAt = '2026-10-19T12:00:00.000Z';
    expect(
      UploadTicketSchema.parse({
        mode: 'S3_MULTIPART',
        mediaId: ID,
        partSizeBytes: 8388608,
        partCount: 2,
        parts: [
          { partNumber: 1, url: 'http://localhost:9000/a?p=1' },
          { partNumber: 2, url: 'http://localhost:9000/a?p=2' },
        ],
        expiresAt,
      }).mode,
    ).toBe('S3_MULTIPART');
    expect(
      UploadTicketSchema.parse({
        mode: 'TUS',
        mediaId: ID,
        uploadUrl: 'https://upload.videodelivery.net/tus/abc',
        expiresAt,
      }).mode,
    ).toBe('TUS');
    expect(UploadTicketSchema.safeParse({ mode: 'FTP', mediaId: ID }).success).toBe(false);
  });

  it('CompleteUploadSchema: parts optional, part numbers ≥ 1', () => {
    expect(CompleteUploadSchema.parse({})).toEqual({});
    expect(
      CompleteUploadSchema.safeParse({ parts: [{ partNumber: 0, etag: '"e"' }] }).success,
    ).toBe(false);
    expect(CompleteUploadSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('MediaQuerySchema coerces limit; PlaybackSchema discriminates on kind', () => {
    expect(MediaQuerySchema.parse({ kind: 'PDF' })).toEqual({ kind: 'PDF', limit: 50 });
    expect(
      PlaybackSchema.parse({
        kind: 'PDF',
        url: 'http://x',
        expiresAt: '2026-10-19T12:00:00.000Z',
        allowDownload: false,
      }).kind,
    ).toBe('PDF');
    expect(PlaybackSchema.safeParse({ kind: 'PDF', url: 'http://x', expiresAt: 'x' }).success).toBe(
      false,
    );
  });
});
