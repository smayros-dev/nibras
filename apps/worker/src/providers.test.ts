import {
  CloudflareStreamProvider,
  InMemoryStorageProvider,
  S3StorageProvider,
  S3VideoProvider,
} from '@nibras/providers';
import { describe, expect, it } from 'vitest';

import { createStorageProvider, createVideoProvider } from './providers';

describe('worker provider factories', () => {
  it('builds the S3 storage provider on S3_BUCKET', () => {
    const storage = createStorageProvider({
      S3_ENDPOINT: 'http://localhost:9000',
      S3_PUBLIC_ENDPOINT: undefined,
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY: 'minioadmin',
      S3_SECRET_KEY: 'minioadmin',
      S3_BUCKET: 'nibras-dev',
      S3_FORCE_PATH_STYLE: true,
    });
    expect(storage).toBeInstanceOf(S3StorageProvider);
    expect(storage.bucket).toBe('nibras-dev');
  });

  it('VIDEO_PROVIDER=s3 → S3 passthrough', () => {
    expect(
      createVideoProvider({ VIDEO_PROVIDER: 's3' }, new InMemoryStorageProvider()),
    ).toBeInstanceOf(S3VideoProvider);
  });

  it('VIDEO_PROVIDER=cloudflare_stream → adapter that never signs nor verifies in the worker', async () => {
    const video = createVideoProvider(
      {
        VIDEO_PROVIDER: 'cloudflare_stream',
        CLOUDFLARE_ACCOUNT_ID: '023e105f4ecef8ad9ca31a8372d0c353',
        CLOUDFLARE_STREAM_API_TOKEN: 'token',
      },
      new InMemoryStorageProvider(),
    );
    expect(video).toBeInstanceOf(CloudflareStreamProvider);
    await expect(video.signPlayback({ providerAssetId: 'a'.repeat(32) })).rejects.toThrow(/worker/);
    // Webhooks are verified by the API; the worker holds no webhook secret, so nothing verifies.
    const body = Buffer.from('{}');
    expect(
      video.verifyWebhook({ rawBody: body, headers: { 'webhook-signature': 'time=1,sig1=00' } }).ok,
    ).toBe(false);
  });
});
