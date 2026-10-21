import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspect } from 'node:util';

import { MEDIA_LIMITS, MEDIA_MIME_TYPES, PLAYBACK_TTL_S } from '@nibras/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { CloudflareStreamProvider, type CloudflareStreamOptions } from './cloudflare-stream';
import { UnsupportedVideoError, VideoProviderError } from './types';

const fixture = (name: string) => resolve(__dirname, 'fixtures/cloudflare', name);
const json = (name: string) => JSON.parse(readFileSync(fixture(name), 'utf8')) as unknown;

const NOW = new Date('2026-10-19T10:00:00.000Z');
const NOW_S = NOW.getTime() / 1000; // 1792404000
const UID = 'ea95132c15732412d22c1476fa83f27a';
const SECRETS = {
  apiToken: 'cf-api-token-SECRET',
  webhookSecret: 'test-secret',
  signingKeyPem: '-----BEGIN PRIVATE KEY-----\nPEM-SECRET\n-----END PRIVATE KEY-----',
};

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  hasSignal: boolean;
}

function stubFetch(responder: (req: Recorded) => Response) {
  const requests: Recorded[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    const req: Recorded = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      hasSignal: init?.signal instanceof AbortSignal,
    };
    requests.push(req);
    return Promise.resolve(responder(req));
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function decodeMetadata(header: string): Record<string, string | true> {
  return Object.fromEntries(
    header.split(',').map((pair) => {
      const [key, value] = pair.trim().split(' ');
      return [key!, value === undefined ? true : Buffer.from(value, 'base64').toString('utf8')];
    }),
  );
}

describe('CloudflareStreamProvider', () => {
  let signed: Array<{ payload: Record<string, unknown>; kid: string; pem: string }>;
  let options: CloudflareStreamOptions;

  beforeEach(() => {
    signed = [];
    options = {
      accountId: 'acc123',
      ...SECRETS,
      signingKeyId: 'kid-1',
      customerSubdomain: 'customer-f33zs165nr7gyfy4.cloudflarestream.com',
      signJwt: (payload, kid, pem) => {
        signed.push({ payload, kid, pem });
        return Promise.resolve('JWT');
      },
      now: () => NOW,
    };
  });

  const provider = (fetch: typeof globalThis.fetch) =>
    new CloudflareStreamProvider({ ...options, fetch });

  const uploadInput = {
    workspaceId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    mediaId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
    filename: 'Leçon 1.mov',
    mimeType: 'video/quicktime',
    sizeBytes: 4_190_963,
    maxBytes: MEDIA_LIMITS.VIDEO.maxBytes,
    maxDurationS: MEDIA_LIMITS.VIDEO.maxDurationS,
    ttlS: 3600,
  };

  it('is the Cloudflare provider and accepts the whole VIDEO mime list', () => {
    const cf = provider(stubFetch(() => jsonResponse({})).fetch);
    expect(cf.name).toBe('CLOUDFLARE_STREAM');
    expect(cf.acceptedMimeTypes).toEqual(MEDIA_MIME_TYPES.VIDEO);
  });

  it('createDirectUpload posts a tus creation and returns Location + stream-media-id', async () => {
    const created = json('direct-upload.json') as {
      status: number;
      headers: Record<string, string>;
    };
    const { fetch, requests } = stubFetch(
      () => new Response(null, { status: created.status, headers: created.headers }),
    );
    const upload = await provider(fetch).createDirectUpload(uploadInput);

    expect(upload).toEqual({
      mode: 'TUS',
      uploadUrl: created.headers.location,
      providerAssetId: UID,
      expiresAt: new Date(NOW.getTime() + 3600_000),
    });
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req!.method).toBe('POST');
    expect(req!.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc123/stream?direct_user=true',
    );
    expect(req!.headers.authorization).toBe(`Bearer ${SECRETS.apiToken}`);
    expect(req!.headers['tus-resumable']).toBe('1.0.0');
    expect(req!.headers['upload-length']).toBe('4190963');
    expect(req!.hasSignal).toBe(true);
    const meta = decodeMetadata(req!.headers['upload-metadata']!);
    expect(meta).toEqual({
      maxDurationSeconds: '14400',
      requiresignedurls: true,
      expiry: '2026-10-19T11:00:00.000Z',
      name: uploadInput.mediaId,
    });
  });

  it('createDirectUpload refuses an unaccepted mime type or an oversized file without calling the API', async () => {
    const { fetch, requests } = stubFetch(() => jsonResponse({}));
    const cf = provider(fetch);
    await expect(
      cf.createDirectUpload({ ...uploadInput, mimeType: 'application/pdf' }),
    ).rejects.toBeInstanceOf(UnsupportedVideoError);
    await expect(
      cf.createDirectUpload({ ...uploadInput, sizeBytes: uploadInput.maxBytes + 1 }),
    ).rejects.toBeInstanceOf(UnsupportedVideoError);
    expect(requests).toHaveLength(0);
  });

  it('createDirectUpload maps an API error to VideoProviderError without leaking the token', async () => {
    const { fetch } = stubFetch(() =>
      jsonResponse(
        { success: false, errors: [{ code: 10000, message: 'Authentication error' }] },
        403,
      ),
    );
    const error = await provider(fetch)
      .createDirectUpload(uploadInput)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VideoProviderError);
    expect((error as VideoProviderError).status).toBe(403);
    expect((error as VideoProviderError).body).toContain('Authentication error');
    expect(inspect(error)).not.toContain(SECRETS.apiToken);
  });

  it('createDirectUpload without Location or stream-media-id is a provider error', async () => {
    const { fetch } = stubFetch(() => new Response(null, { status: 201 }));
    await expect(provider(fetch).createDirectUpload(uploadInput)).rejects.toBeInstanceOf(
      VideoProviderError,
    );
  });

  it('signPlayback builds https://{sub}/{jwt}/manifest/video.m3u8 with kid, sub and exp = now + ttl', async () => {
    const cf = provider(stubFetch(() => jsonResponse({})).fetch);
    const grant = await cf.signPlayback({ providerAssetId: UID }, { ttlS: PLAYBACK_TTL_S });
    expect(grant).toEqual({
      kind: 'HLS',
      url: 'https://customer-f33zs165nr7gyfy4.cloudflarestream.com/JWT/manifest/video.m3u8',
      thumbnailUrl:
        'https://customer-f33zs165nr7gyfy4.cloudflarestream.com/JWT/thumbnails/thumbnail.jpg',
      expiresAt: new Date(NOW.getTime() + PLAYBACK_TTL_S * 1000),
    });
    expect(signed).toEqual([
      {
        payload: { sub: UID, kid: 'kid-1', exp: NOW_S + PLAYBACK_TTL_S },
        kid: 'kid-1',
        pem: SECRETS.signingKeyPem,
      },
    ]);
  });

  it('signPlayback without a provider asset id throws', async () => {
    const cf = provider(stubFetch(() => jsonResponse({})).fetch);
    await expect(cf.signPlayback({ storageKey: 'w/x' }, { ttlS: 60 })).rejects.toThrow(
      /providerAssetId/,
    );
  });

  it('getAsset maps readyToStream / error states', async () => {
    const ready = provider(stubFetch(() => jsonResponse(json('asset-ready.json'))).fetch);
    expect(await ready.getAsset({ providerAssetId: UID })).toEqual({
      status: 'READY',
      durationS: 755,
      width: 1920,
      height: 1080,
      sizeBytes: 4_190_963,
      thumbnailUrl: `https://customer-f33zs165nr7gyfy4.cloudflarestream.com/${UID}/thumbnails/thumbnail.jpg`,
    });

    const failed = provider(stubFetch(() => jsonResponse(json('asset-error.json'))).fetch);
    expect(await failed.getAsset({ providerAssetId: UID })).toEqual({
      status: 'FAILED',
      failureReason: 'PROVIDER_ERROR',
      providerErrorCode: 'ERR_NON_VIDEO',
      durationS: null,
      width: null,
      height: null,
      sizeBytes: 1024,
      thumbnailUrl: `https://customer-f33zs165nr7gyfy4.cloudflarestream.com/${UID}/thumbnails/thumbnail.jpg`,
    });

    const processing = structuredClone(json('asset-ready.json')) as {
      result: { readyToStream: boolean; status: { state: string } };
    };
    processing.result.readyToStream = false;
    processing.result.status.state = 'inprogress';
    const inProgress = provider(stubFetch(() => jsonResponse(processing)).fetch);
    expect(await inProgress.getAsset({ providerAssetId: UID })).toMatchObject({
      status: 'PROCESSING',
    });
  });

  it('getAsset sends the bearer token to /stream/{uid}; 404 → FAILED; 500 → VideoProviderError', async () => {
    const { fetch, requests } = stubFetch(() => jsonResponse({ success: false }, 404));
    expect(await provider(fetch).getAsset({ providerAssetId: UID })).toEqual({
      status: 'FAILED',
      failureReason: 'PROVIDER_ERROR',
    });
    expect(requests[0]!.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/acc123/stream/${UID}`,
    );
    expect(requests[0]!.headers.authorization).toBe(`Bearer ${SECRETS.apiToken}`);

    const err = provider(stubFetch(() => new Response('boom', { status: 500 })).fetch);
    await expect(err.getAsset({ providerAssetId: UID })).rejects.toBeInstanceOf(VideoProviderError);
    const bad = provider(stubFetch(() => new Response('not json', { status: 200 })).fetch);
    await expect(bad.getAsset({ providerAssetId: UID })).rejects.toBeInstanceOf(VideoProviderError);
  });

  it('an asset id is path-encoded and refused when it is not a Cloudflare uid', async () => {
    const { fetch, requests } = stubFetch(() => jsonResponse({}));
    await expect(provider(fetch).getAsset({ providerAssetId: '../../tokens' })).rejects.toThrow(
      /providerAssetId/,
    );
    await expect(provider(fetch).delete({ providerAssetId: 'a/b' })).rejects.toThrow(
      /providerAssetId/,
    );
    expect(requests).toHaveLength(0);
  });

  it('delete sends DELETE /stream/{uid} and is idempotent on 404', async () => {
    const { fetch, requests } = stubFetch((req) =>
      req.method === 'DELETE' && requests.length === 1
        ? new Response(null, { status: 200 })
        : jsonResponse({ success: false }, 404),
    );
    const cf = provider(fetch);
    await cf.delete({ providerAssetId: UID });
    await cf.delete({ providerAssetId: UID });
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `DELETE https://api.cloudflare.com/client/v4/accounts/acc123/stream/${UID}`,
      `DELETE https://api.cloudflare.com/client/v4/accounts/acc123/stream/${UID}`,
    ]);
    await expect(cf.delete({})).resolves.toBeUndefined();
    const failing = provider(stubFetch(() => new Response('x', { status: 503 })).fetch);
    await expect(failing.delete({ providerAssetId: UID })).rejects.toBeInstanceOf(
      VideoProviderError,
    );
  });

  describe('verifyWebhook', () => {
    const rawBody = readFileSync(fixture('webhook-ready.json'));
    // Fixed vector: HMAC-SHA256('test-secret', '1792404000.' + rawBody) and sha256(rawBody).
    const SIG = '28509b8d1aae03b0be8b59b7f112f57e53aee81b1779c1cb7a776e92f10c6ab4';
    const BODY_SHA256 = 'b5615cb043d87c30274137509c7297581dce80a0d5859fa58e1a8722e7fc3bdd';
    const header = (time: number, sig: string) => ({
      'webhook-signature': `time=${time},sig1=${sig}`,
    });
    let cf: CloudflareStreamProvider;

    beforeEach(() => {
      cf = provider(stubFetch(() => jsonResponse({})).fetch);
    });

    it('the fixed vector matches an independent computation', () => {
      expect(
        createHmac('sha256', 'test-secret').update(`${NOW_S}.`).update(rawBody).digest('hex'),
      ).toBe(SIG);
      expect(createHash('sha256').update(rawBody).digest('hex')).toBe(BODY_SHA256);
    });

    it('valid signature → ok with eventId = sha256(body) and the mapped event', () => {
      expect(cf.verifyWebhook({ rawBody, headers: header(NOW_S, SIG) })).toEqual({
        ok: true,
        eventId: BODY_SHA256,
        events: [
          {
            providerAssetId: UID,
            state: 'READY',
            durationS: 755,
            width: 1920,
            height: 1080,
            sizeBytes: 4_190_963,
            thumbnailUrl: `https://customer-f33zs165nr7gyfy4.cloudflarestream.com/${UID}/thumbnails/thumbnail.jpg`,
          },
        ],
      });
    });

    it('accepts the edges of the ±300 s window, an explicit now and a mixed-case header name', () => {
      for (const skew of [-300, 300]) {
        const t = NOW_S + skew;
        const sig = createHmac('sha256', 'test-secret')
          .update(`${t}.`)
          .update(rawBody)
          .digest('hex');
        expect(cf.verifyWebhook({ rawBody, headers: header(t, sig) }).ok).toBe(true);
      }
      expect(
        cf.verifyWebhook({
          rawBody,
          headers: { 'Webhook-Signature': `time=${NOW_S},sig1=${SIG.toUpperCase()}` },
          now: new Date(NOW.getTime() + 299_000),
        }).ok,
      ).toBe(true);
    });

    it('stale time → INVALID_TIME', () => {
      for (const skew of [-301, 301, -86_400]) {
        const t = NOW_S + skew;
        const sig = createHmac('sha256', 'test-secret')
          .update(`${t}.`)
          .update(rawBody)
          .digest('hex');
        expect(cf.verifyWebhook({ rawBody, headers: header(t, sig) })).toEqual({
          ok: false,
          reason: 'INVALID_TIME',
        });
      }
    });

    it('wrong sig → INVALID_SIGNATURE (other secret, other body, other time, wrong length, garbage)', () => {
      const other = createHmac('sha256', 'other').update(`${NOW_S}.`).update(rawBody).digest('hex');
      const cases: Array<{ body: Buffer; headers: Record<string, string> }> = [
        { body: rawBody, headers: header(NOW_S, other) },
        { body: Buffer.concat([rawBody, Buffer.from(' ')]), headers: header(NOW_S, SIG) },
        { body: rawBody, headers: header(NOW_S + 1, SIG) },
        { body: rawBody, headers: header(NOW_S, SIG.slice(0, 62)) },
        { body: rawBody, headers: header(NOW_S, `${SIG}00`) },
        { body: rawBody, headers: header(NOW_S, 'zz'.repeat(32)) },
        { body: rawBody, headers: { 'webhook-signature': `sig1=${SIG}` } },
        { body: rawBody, headers: { 'webhook-signature': `time=abc,sig1=${SIG}` } },
        { body: rawBody, headers: { 'webhook-signature': `time=${NOW_S}` } },
        { body: rawBody, headers: { 'webhook-signature': 'garbage' } },
        {
          body: rawBody,
          headers: { 'webhook-signature': `time=${NOW_S},sig1=${SIG},`.repeat(200) },
        },
      ];
      for (const { body, headers } of cases) {
        expect(cf.verifyWebhook({ rawBody: body, headers })).toEqual({
          ok: false,
          reason: 'INVALID_SIGNATURE',
        });
      }
    });

    it('missing header → MISSING_SIGNATURE', () => {
      for (const headers of [{}, { 'webhook-signature': undefined }, { 'webhook-signature': '' }]) {
        expect(cf.verifyWebhook({ rawBody, headers })).toEqual({
          ok: false,
          reason: 'MISSING_SIGNATURE',
        });
      }
    });

    it('a correctly signed body that is not a video object → INVALID_PAYLOAD', () => {
      for (const text of ['not json', '[]', '{"uid":42}', '{"status":{}}']) {
        const body = Buffer.from(text);
        const sig = createHmac('sha256', 'test-secret')
          .update(`${NOW_S}.`)
          .update(body)
          .digest('hex');
        expect(cf.verifyWebhook({ rawBody: body, headers: header(NOW_S, sig) })).toEqual({
          ok: false,
          reason: 'INVALID_PAYLOAD',
        });
      }
    });

    it('maps an error webhook to FAILED and an in-progress one to PROCESSING', () => {
      const sign = (obj: unknown) => {
        const body = Buffer.from(JSON.stringify(obj));
        const sig = createHmac('sha256', 'test-secret')
          .update(`${NOW_S}.`)
          .update(body)
          .digest('hex');
        return cf.verifyWebhook({ rawBody: body, headers: header(NOW_S, sig) });
      };
      expect(
        sign({
          uid: UID,
          readyToStream: false,
          status: { state: 'error', errorReasonCode: 'ERR_DURATION_EXCEED_CONSTRAINT' },
        }),
      ).toMatchObject({
        ok: true,
        events: [
          {
            providerAssetId: UID,
            state: 'FAILED',
            failureReason: 'PROVIDER_ERROR',
            providerErrorCode: 'ERR_DURATION_EXCEED_CONSTRAINT',
          },
        ],
      });
      expect(sign({ uid: UID, readyToStream: false, status: { state: 'queued' } })).toMatchObject({
        ok: true,
        events: [{ providerAssetId: UID, state: 'PROCESSING' }],
      });
    });
  });

  it('secrets never appear when the provider is inspected or serialised', () => {
    const cf = provider(stubFetch(() => jsonResponse({})).fetch);
    const dumped = `${inspect(cf, { depth: 10, showHidden: true })} ${JSON.stringify(cf)}`;
    for (const secret of Object.values(SECRETS)) expect(dumped).not.toContain(secret);
  });

  it('refuses incomplete options', () => {
    for (const key of [
      'accountId',
      'apiToken',
      'webhookSecret',
      'signingKeyId',
      'signingKeyPem',
      'customerSubdomain',
    ] as const) {
      expect(() => new CloudflareStreamProvider({ ...options, [key]: '' })).toThrow(key);
    }
    expect(
      () => new CloudflareStreamProvider({ ...options, customerSubdomain: 'evil.com/path' }),
    ).toThrow(/customerSubdomain/);
  });
});
