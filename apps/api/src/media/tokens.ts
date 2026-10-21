import { createPrivateKey, type KeyObject } from 'node:crypto';
import {
  CloudflareStreamProvider,
  S3StorageProvider,
  S3VideoProvider,
  type SignJwt,
  type StorageProvider,
  type VideoProvider,
} from '@nibras/providers';
import { SignJWT } from 'jose';
import type { Env } from '../config/env';

/** `S3StorageProvider` on `S3_BUCKET` (the test helpers point it at the package's test bucket). */
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
/** `VideoProvider` picked by `VIDEO_PROVIDER` (`s3` passthrough or Cloudflare Stream). */
export const VIDEO_PROVIDER_TOKEN = Symbol('VIDEO_PROVIDER_TOKEN');

type S3Settings = Pick<
  Env,
  | 'S3_ENDPOINT'
  | 'S3_PUBLIC_ENDPOINT'
  | 'S3_REGION'
  | 'S3_ACCESS_KEY'
  | 'S3_SECRET_KEY'
  | 'S3_BUCKET'
  | 'S3_FORCE_PATH_STYLE'
>;

type VideoSettings = Pick<
  Env,
  | 'VIDEO_PROVIDER'
  | 'CLOUDFLARE_ACCOUNT_ID'
  | 'CLOUDFLARE_STREAM_API_TOKEN'
  | 'CLOUDFLARE_STREAM_WEBHOOK_SECRET'
  | 'CLOUDFLARE_STREAM_SIGNING_KEY_ID'
  | 'CLOUDFLARE_STREAM_SIGNING_KEY_PEM'
  | 'CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN'
>;

export function createStorageProvider(e: S3Settings): S3StorageProvider {
  return new S3StorageProvider({
    endpoint: e.S3_ENDPOINT,
    publicEndpoint: e.S3_PUBLIC_ENDPOINT,
    region: e.S3_REGION,
    accessKeyId: e.S3_ACCESS_KEY,
    secretAccessKey: e.S3_SECRET_KEY,
    bucket: e.S3_BUCKET,
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
  });
}

/**
 * The signing key as a `KeyObject`. Accepts a PEM (PKCS#1 `RSA PRIVATE KEY`, as Cloudflare issues
 * it, or PKCS#8), the base64 of that PEM (the `pem` field `POST /stream/keys` returns), and a
 * single-line env value with escaped `\n`.
 */
function parseSigningKey(value: string): KeyObject {
  let pem = value.trim().replace(/\\n/g, '\n');
  if (!pem.includes('-----BEGIN')) pem = Buffer.from(pem, 'base64').toString('utf8');
  try {
    return createPrivateKey(pem);
  } catch {
    // Never echo the value: it is a private key.
    throw new Error(
      'CLOUDFLARE_STREAM_SIGNING_KEY_PEM is not a readable RSA private key (PEM or base64 of a PEM)',
    );
  }
}

/**
 * RS256 signer for the Cloudflare playback token (`jose` `SignJWT`, `kid` header). The key is
 * parsed once, here, so a bad key stops the API at boot rather than at the first playback. The
 * `pem` argument the adapter passes is the same configured value and is ignored.
 */
export function createJoseSignJwt(pem: string): SignJwt {
  const key = parseSigningKey(pem);
  return (payload, kid) => new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid }).sign(key);
}

export function createVideoProvider(e: VideoSettings, storage: StorageProvider): VideoProvider {
  switch (e.VIDEO_PROVIDER) {
    case 's3':
      return new S3VideoProvider(storage);
    case 'cloudflare_stream': {
      // The env schema already requires each one; this guards a direct (test/CLI) call.
      const need = (name: keyof VideoSettings): string => {
        const value = e[name];
        if (!value) throw new Error(`${name} is required when VIDEO_PROVIDER=cloudflare_stream`);
        return value;
      };
      const pem = need('CLOUDFLARE_STREAM_SIGNING_KEY_PEM');
      return new CloudflareStreamProvider({
        accountId: need('CLOUDFLARE_ACCOUNT_ID'),
        apiToken: need('CLOUDFLARE_STREAM_API_TOKEN'),
        webhookSecret: need('CLOUDFLARE_STREAM_WEBHOOK_SECRET'),
        signingKeyId: need('CLOUDFLARE_STREAM_SIGNING_KEY_ID'),
        signingKeyPem: pem,
        customerSubdomain: need('CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN'),
        signJwt: createJoseSignJwt(pem),
      });
    }
  }
}
