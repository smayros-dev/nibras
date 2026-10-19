import { describe, expect, it } from 'vitest';
import {
  INLINE_URL_TTL_S,
  MEDIA_FAILURE_REASONS,
  MEDIA_KINDS,
  MEDIA_LIMITS,
  MEDIA_MIME_TYPES,
  PLAYBACK_TOKENS_PER_HOUR,
  PLAYBACK_TTL_S,
  PROCESSING_TIMEOUT_MS,
  S3_VIDEO_MIME_TYPES,
  UPLOAD_ABANDON_AFTER_MS,
  UPLOAD_MODES,
  UPLOAD_PART_SIZE_BYTES,
  UPLOAD_PARTS_PER_BATCH,
  UPLOAD_URL_TTL_S,
  WEBHOOK_TOLERANCE_S,
  kindForMime,
  partCount,
  sanitizeFilename,
} from './media-constants';

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

describe('media constants', () => {
  it('spells the limits (D-P15) and timings as the plan does', () => {
    expect(MEDIA_KINDS).toEqual(['VIDEO', 'PDF', 'IMAGE', 'FILE', 'RECORDING']);
    expect(MEDIA_LIMITS.VIDEO).toEqual({ maxBytes: 4 * GiB, maxDurationS: 14400 });
    expect(MEDIA_LIMITS.PDF.maxBytes).toBe(50 * MiB);
    expect(MEDIA_LIMITS.IMAGE.maxBytes).toBe(5 * MiB);
    expect(MEDIA_LIMITS.FILE.maxBytes).toBe(10 * MiB);
    expect(S3_VIDEO_MIME_TYPES).toEqual(['video/mp4', 'video/webm']);
    for (const m of S3_VIDEO_MIME_TYPES) expect(MEDIA_MIME_TYPES.VIDEO).toContain(m);
    expect(MEDIA_MIME_TYPES.PDF).toEqual(['application/pdf']);
    expect(MEDIA_MIME_TYPES.IMAGE).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(UPLOAD_PART_SIZE_BYTES).toBe(8 * MiB);
    expect(UPLOAD_URL_TTL_S).toBe(3600);
    expect(UPLOAD_PARTS_PER_BATCH).toBe(100);
    expect(PLAYBACK_TTL_S).toBe(7200);
    expect(INLINE_URL_TTL_S).toBe(300);
    expect(PLAYBACK_TOKENS_PER_HOUR).toBe(30);
    expect(UPLOAD_ABANDON_AFTER_MS).toBe(24 * 3600 * 1000);
    expect(PROCESSING_TIMEOUT_MS).toBe(6 * 3600 * 1000);
    expect(WEBHOOK_TOLERANCE_S).toBe(300);
    expect(MEDIA_FAILURE_REASONS).toEqual([
      'ABANDONED',
      'TIMEOUT',
      'PROVIDER_ERROR',
      'INVALID_SIGNATURE',
      'ENCRYPTED',
      'QUOTA_EXCEEDED',
      'SIZE_MISMATCH',
    ]);
    expect(UPLOAD_MODES).toEqual(['S3_MULTIPART', 'TUS']);
  });

  it('kindForMime maps the allow-listed types only', () => {
    expect(kindForMime('application/pdf')).toBe('PDF');
    expect(kindForMime('video/mp4')).toBe('VIDEO');
    expect(kindForMime('VIDEO/WEBM')).toBe('VIDEO');
    expect(kindForMime('image/png')).toBe('IMAGE');
    expect(kindForMime('text/html')).toBeNull();
  });

  it('partCount rounds up and is at least 1', () => {
    expect(partCount(8 * MiB + 1, 8 * MiB)).toBe(2);
    expect(partCount(8 * MiB, 8 * MiB)).toBe(1);
    expect(partCount(1, 8 * MiB)).toBe(1);
    expect(partCount(4 * GiB, UPLOAD_PART_SIZE_BYTES)).toBe(512);
  });

  it('sanitizeFilename keeps an ASCII name with its extension, ≤ 120 chars, never empty', () => {
    expect(sanitizeFilename('Cours n°1 (été).PDF')).toBe('Cours_n_1_ete_.PDF');
    expect(sanitizeFilename('rapport.pdf')).toBe('rapport.pdf');
    const dots = sanitizeFilename('…');
    expect(dots.length).toBeGreaterThan(0);
    expect(dots.length).toBeLessThanOrEqual(120);
    expect(sanitizeFilename('')).not.toBe('');
    expect(sanitizeFilename('درس.pdf')).toMatch(/^[A-Za-z0-9._-]+\.pdf$/);
    const long = sanitizeFilename(`${'a'.repeat(300)}.mp4`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('.mp4')).toBe(true);
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('/');
  });
});
