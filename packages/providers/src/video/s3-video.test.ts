import { MEDIA_LIMITS, PLAYBACK_TTL_S, S3_VIDEO_MIME_TYPES } from '@nibras/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { isStorageKeyOf } from '../storage/keys';
import { InMemoryStorageProvider } from '../storage/in-memory';
import { buildMp4 } from './fixtures/mp4-fixture';
import { S3VideoProvider } from './s3-video';
import { UnsupportedVideoError } from './types';

const wid = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const mediaId = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const NOW = new Date('2026-10-19T10:00:00.000Z');

const input = {
  workspaceId: wid,
  mediaId,
  filename: 'Cours 1 — intro.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 1000,
  maxBytes: MEDIA_LIMITS.VIDEO.maxBytes,
  maxDurationS: MEDIA_LIMITS.VIDEO.maxDurationS,
  ttlS: 3600,
};

describe('S3VideoProvider', () => {
  let storage: InMemoryStorageProvider;
  let video: S3VideoProvider;

  beforeEach(() => {
    storage = new InMemoryStorageProvider({ now: () => NOW });
    video = new S3VideoProvider(storage, { now: () => NOW });
  });

  it('is the S3 provider and accepts only mp4 and webm', () => {
    expect(video.name).toBe('S3');
    expect(video.acceptedMimeTypes).toEqual(S3_VIDEO_MIME_TYPES);
  });

  it('createDirectUpload returns S3_MULTIPART with a key under the workspace', async () => {
    const upload = await video.createDirectUpload(input);
    expect(upload.mode).toBe('S3_MULTIPART');
    if (upload.mode !== 'S3_MULTIPART') return;
    expect(isStorageKeyOf(upload.storageKey, wid)).toBe(true);
    expect(upload.storageKey).toMatch(new RegExp(`^w/${wid}/video/${mediaId}/`));
    expect(upload.uploadId).toBeTruthy();
    expect(upload.expiresAt.getTime()).toBe(NOW.getTime() + 3600_000);
    // the multipart upload exists in the store
    await expect(storage.listParts(upload.storageKey, upload.uploadId)).resolves.toEqual([]);
  });

  it('createDirectUpload refuses another mime type and a size above the limit', async () => {
    for (const mimeType of ['video/quicktime', 'video/x-matroska', 'application/pdf']) {
      await expect(video.createDirectUpload({ ...input, mimeType })).rejects.toBeInstanceOf(
        UnsupportedVideoError,
      );
    }
    await expect(
      video.createDirectUpload({ ...input, sizeBytes: input.maxBytes + 1 }),
    ).rejects.toBeInstanceOf(UnsupportedVideoError);
    // the declared type is matched case-insensitively
    await expect(
      video.createDirectUpload({ ...input, mimeType: 'Video/MP4' }),
    ).resolves.toBeTruthy();
  });

  it('getAsset of a stored mp4 → READY with duration, dimensions and size', async () => {
    const key = `w/${wid}/video/${mediaId}/a.mp4`;
    const body = buildMp4({
      moovFirst: false,
      timescale: 1000,
      duration: 12_345,
      width: 1280,
      height: 720,
      mdatBytes: 50_000,
    });
    storage.putObject(key, body, 'video/mp4');
    expect(await video.getAsset({ storageKey: key })).toEqual({
      status: 'READY',
      durationS: 12,
      width: 1280,
      height: 720,
      sizeBytes: body.length,
    });
  });

  it('getAsset of a webm → READY with null metadata (no WebM probe)', async () => {
    const key = `w/${wid}/video/${mediaId}/a.webm`;
    storage.putObject(key, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]), 'video/webm');
    expect(await video.getAsset({ storageKey: key })).toEqual({
      status: 'READY',
      durationS: null,
      width: null,
      height: null,
      sizeBytes: 7,
    });
  });

  it('getAsset of a missing object → FAILED PROVIDER_ERROR; of a stored non-mp4 → FAILED INVALID_SIGNATURE', async () => {
    expect(await video.getAsset({ storageKey: `w/${wid}/video/${mediaId}/x.mp4` })).toEqual({
      status: 'FAILED',
      failureReason: 'PROVIDER_ERROR',
    });
    const key = `w/${wid}/video/${mediaId}/fake.mp4`;
    storage.putObject(key, Buffer.from('MZ\x90\x00 not a video'), 'video/mp4');
    expect(await video.getAsset({ storageKey: key })).toMatchObject({
      status: 'FAILED',
      failureReason: 'INVALID_SIGNATURE',
    });
  });

  it('getAsset without a storage key throws', async () => {
    await expect(video.getAsset({ providerAssetId: 'x' })).rejects.toThrow(/storageKey/);
  });

  it('signPlayback → kind MP4, an inline presigned URL, expiresAt = now + ttl (default 2 h)', async () => {
    const key = `w/${wid}/video/${mediaId}/a.mp4`;
    const grant = await video.signPlayback({ storageKey: key }, { ttlS: 600 });
    expect(grant.kind).toBe('MP4');
    expect(grant.expiresAt.getTime()).toBe(NOW.getTime() + 600_000);
    const url = new URL(grant.url);
    expect(url.pathname).toBe(`/${key}`);
    expect(url.searchParams.get('disposition')).toBe('inline');
    expect(url.searchParams.get('exp')).toBe(String(NOW.getTime() / 1000 + 600));

    const byDefault = await video.signPlayback({ storageKey: key });
    expect(byDefault.expiresAt.getTime()).toBe(NOW.getTime() + PLAYBACK_TTL_S * 1000);
  });

  it('delete removes the object and is idempotent; a ref without key is a no-op', async () => {
    const key = `w/${wid}/video/${mediaId}/a.mp4`;
    storage.putObject(key, Buffer.from('x'), 'video/mp4');
    await video.delete({ storageKey: key });
    expect(storage.objects.has(key)).toBe(false);
    await expect(video.delete({ storageKey: key })).resolves.toBeUndefined();
    await expect(video.delete({})).resolves.toBeUndefined();
  });

  it('verifyWebhook → { ok: false, reason: NO_WEBHOOKS }', () => {
    expect(video.verifyWebhook({ rawBody: Buffer.from('{}'), headers: {} })).toEqual({
      ok: false,
      reason: 'NO_WEBHOOKS',
    });
  });
});
