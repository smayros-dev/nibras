import { describe, expect, it } from 'vitest';

import { FakeVideoProvider } from './fake';

const NOW = new Date('2026-10-19T10:00:00.000Z');
const input = {
  workspaceId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  mediaId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
  filename: 'a.mov',
  mimeType: 'video/quicktime',
  sizeBytes: 10,
  maxBytes: 100,
  maxDurationS: 60,
  ttlS: 3600,
};

describe('FakeVideoProvider', () => {
  it('records TUS uploads and answers scripted assets (PROCESSING by default)', async () => {
    const fake = new FakeVideoProvider({ now: () => NOW });
    expect(fake.name).toBe('CLOUDFLARE_STREAM');
    const upload = await fake.createDirectUpload(input);
    expect(upload).toMatchObject({ mode: 'TUS', expiresAt: new Date(NOW.getTime() + 3600_000) });
    expect(fake.uploads).toEqual([upload]);
    if (upload.mode !== 'TUS') return;
    const ref = { providerAssetId: upload.providerAssetId };
    expect(await fake.getAsset(ref)).toEqual({ status: 'PROCESSING' });
    fake.assets.set(upload.providerAssetId, { status: 'READY', durationS: 30 });
    expect(await fake.getAsset(ref)).toEqual({ status: 'READY', durationS: 30 });
  });

  it('signPlayback returns https://video.test/{id}?exp=…; delete records the id', async () => {
    const fake = new FakeVideoProvider({ now: () => NOW });
    const grant = await fake.signPlayback({ providerAssetId: 'abc' }, { ttlS: 60 });
    expect(grant).toEqual({
      kind: 'HLS',
      url: `https://video.test/abc?exp=${NOW.getTime() / 1000 + 60}`,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    await fake.delete({ providerAssetId: 'abc' });
    expect(fake.deleted).toEqual(['abc']);
  });

  it('nextWebhook builds a request verifyWebhook accepts, with a stable eventId per body', () => {
    const fake = new FakeVideoProvider();
    const req = fake.nextWebhook([{ providerAssetId: 'abc', state: 'READY', durationS: 5 }]);
    const first = fake.verifyWebhook(req);
    expect(first).toMatchObject({
      ok: true,
      events: [{ providerAssetId: 'abc', state: 'READY', durationS: 5 }],
    });
    expect(fake.verifyWebhook(req)).toEqual(first);
    expect(fake.verifyWebhook({ rawBody: req.rawBody, headers: {} })).toEqual({
      ok: false,
      reason: 'MISSING_SIGNATURE',
    });
    expect(
      fake.verifyWebhook({ rawBody: req.rawBody, headers: { 'webhook-signature': 'forged' } }),
    ).toEqual({ ok: false, reason: 'INVALID_SIGNATURE' });
  });

  it('can play the S3 provider (S3_MULTIPART uploads, MP4 playback)', async () => {
    const fake = new FakeVideoProvider({ name: 'S3' });
    const upload = await fake.createDirectUpload({ ...input, mimeType: 'video/mp4' });
    expect(upload.mode).toBe('S3_MULTIPART');
    expect((await fake.signPlayback({ storageKey: 'k' })).kind).toBe('MP4');
    expect(fake.verifyWebhook(fake.nextWebhook([]))).toEqual({ ok: false, reason: 'NO_WEBHOOKS' });
  });
});
