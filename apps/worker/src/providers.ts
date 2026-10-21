import { randomBytes } from 'node:crypto';

import {
  CloudflareStreamProvider,
  S3StorageProvider,
  S3VideoProvider,
  SmtpEmailProvider,
  type EmailProvider,
  type StorageProvider,
  type VideoProvider,
} from '@nibras/providers';

import type { WorkerEnv } from './env';

/** `EmailProvider` (SMTP from the env; `InMemoryEmailProvider` in tests via `overrideProvider`). */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
/** `S3StorageProvider` on `S3_BUCKET` (same bucket as the API). */
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
/** `VideoProvider` picked by `VIDEO_PROVIDER` (`getAsset` / `delete` in the media jobs). */
export const VIDEO_PROVIDER_TOKEN = Symbol('VIDEO_PROVIDER_TOKEN');

export function createEmailProvider(
  env: Pick<WorkerEnv, 'SMTP_URL' | 'EMAIL_FROM'>,
): EmailProvider {
  return new SmtpEmailProvider({ smtpUrl: env.SMTP_URL, from: env.EMAIL_FROM });
}

export function createStorageProvider(
  env: Pick<
    WorkerEnv,
    | 'S3_ENDPOINT'
    | 'S3_PUBLIC_ENDPOINT'
    | 'S3_REGION'
    | 'S3_ACCESS_KEY'
    | 'S3_SECRET_KEY'
    | 'S3_BUCKET'
    | 'S3_FORCE_PATH_STYLE'
  >,
): S3StorageProvider {
  return new S3StorageProvider({
    endpoint: env.S3_ENDPOINT,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    bucket: env.S3_BUCKET,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
}

/**
 * The worker's video provider. On Cloudflare it only calls `getAsset` and `delete`, so it holds
 * the account id and API token alone: playback signing throws, and the webhook secret is a random
 * value nothing knows (verification always fails — the API verifies webhooks before queuing them).
 */
export function createVideoProvider(
  env: Pick<WorkerEnv, 'VIDEO_PROVIDER' | 'CLOUDFLARE_ACCOUNT_ID' | 'CLOUDFLARE_STREAM_API_TOKEN'>,
  storage: StorageProvider,
): VideoProvider {
  switch (env.VIDEO_PROVIDER) {
    case 's3':
      return new S3VideoProvider(storage);
    case 'cloudflare_stream': {
      const need = (name: 'CLOUDFLARE_ACCOUNT_ID' | 'CLOUDFLARE_STREAM_API_TOKEN'): string => {
        const value = env[name];
        if (!value) throw new Error(`${name} is required when VIDEO_PROVIDER=cloudflare_stream`);
        return value;
      };
      const unused = 'not-available-in-the-worker';
      return new CloudflareStreamProvider({
        accountId: need('CLOUDFLARE_ACCOUNT_ID'),
        apiToken: need('CLOUDFLARE_STREAM_API_TOKEN'),
        webhookSecret: randomBytes(32).toString('hex'),
        signingKeyId: unused,
        signingKeyPem: unused,
        customerSubdomain: 'worker.invalid',
        signJwt: () =>
          Promise.reject(new Error('the worker never signs Cloudflare playback tokens (API only)')),
      });
    }
  }
}
