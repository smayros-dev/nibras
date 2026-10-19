import { generateKeyPairSync } from 'node:crypto';
import {
  CloudflareStreamProvider,
  InMemoryStorageProvider,
  S3StorageProvider,
  S3VideoProvider,
} from '@nibras/providers';
import { decodeProtectedHeader, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { createJoseSignJwt, createStorageProvider, createVideoProvider } from './tokens';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pkcs1 = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const s3Env = {
  S3_ENDPOINT: 'http://localhost:9000',
  S3_PUBLIC_ENDPOINT: undefined,
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'minioadmin',
  S3_SECRET_KEY: 'minioadmin',
  S3_BUCKET: 'nibras-dev',
  S3_FORCE_PATH_STYLE: true,
};

const cloudflareEnv = {
  VIDEO_PROVIDER: 'cloudflare_stream' as const,
  CLOUDFLARE_ACCOUNT_ID: '023e105f4ecef8ad9ca31a8372d0c353',
  CLOUDFLARE_STREAM_API_TOKEN: 'token',
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: 'secret',
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: '8f926b2b01f383510284a74ed8a1d2a7',
  // Cloudflare's `POST /stream/keys` returns the PEM base64-encoded: accepted as is.
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: Buffer.from(pkcs1).toString('base64'),
  CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN: 'customer-abc123.cloudflarestream.com',
};

describe('createJoseSignJwt (Cloudflare playback token)', () => {
  it.each([
    ['PKCS#1 PEM', pkcs1],
    ['PKCS#8 PEM', pkcs8],
    ['base64 of the PEM (Cloudflare API format)', Buffer.from(pkcs1).toString('base64')],
    ['PEM with escaped newlines (single-line env value)', pkcs8.replace(/\n/g, '\\n')],
  ])('signs an RS256 JWT with the kid header from a %s', async (_label, pem) => {
    const sign = createJoseSignJwt(pem);
    const exp = Math.floor(Date.now() / 1000) + 7200;
    const token = await sign({ sub: 'uid', kid: 'key-1', exp }, 'key-1', pem);
    expect(decodeProtectedHeader(token)).toEqual({ alg: 'RS256', kid: 'key-1' });
    const { payload } = await jwtVerify(token, publicKey, { algorithms: ['RS256'] });
    expect(payload).toMatchObject({ sub: 'uid', kid: 'key-1', exp });
  });

  it('refuses an unparseable key at construction (boot), not at the first playback', () => {
    expect(() => createJoseSignJwt('not a key')).toThrow(/CLOUDFLARE_STREAM_SIGNING_KEY_PEM/);
  });
});

describe('provider factories', () => {
  it('builds the S3 storage provider on S3_BUCKET', () => {
    const storage = createStorageProvider(s3Env);
    expect(storage).toBeInstanceOf(S3StorageProvider);
    expect(storage.bucket).toBe('nibras-dev');
  });

  it('VIDEO_PROVIDER=s3 → S3 passthrough over the storage provider', () => {
    const video = createVideoProvider({ VIDEO_PROVIDER: 's3' }, new InMemoryStorageProvider());
    expect(video).toBeInstanceOf(S3VideoProvider);
    expect(video.name).toBe('S3');
  });

  it('VIDEO_PROVIDER=cloudflare_stream → Cloudflare adapter whose playback JWT verifies', async () => {
    const video = createVideoProvider(cloudflareEnv, new InMemoryStorageProvider());
    expect(video).toBeInstanceOf(CloudflareStreamProvider);
    const grant = await video.signPlayback({ providerAssetId: 'a'.repeat(32) });
    expect(grant.kind).toBe('HLS');
    const token = new URL(grant.url).pathname.split('/')[1] as string;
    const { payload } = await jwtVerify(token, publicKey, { algorithms: ['RS256'] });
    expect(payload.sub).toBe('a'.repeat(32));
  });

  it('cloudflare_stream without its secrets fails loudly (env validation normally prevents it)', () => {
    expect(() =>
      createVideoProvider(
        { ...cloudflareEnv, CLOUDFLARE_STREAM_API_TOKEN: undefined },
        new InMemoryStorageProvider(),
      ),
    ).toThrow(/CLOUDFLARE_STREAM_API_TOKEN/);
  });
});
