import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { MEDIA_MIME_TYPES, PLAYBACK_TTL_S, WEBHOOK_TOLERANCE_S } from '@nibras/contracts';

import {
  assertUploadAccepted,
  headerValue,
  VideoProviderError,
  type CreateDirectUploadInput,
  type DirectUpload,
  type PlaybackGrant,
  type VideoAssetInfo,
  type VideoAssetRef,
  type VideoProvider,
  type VideoWebhookEvent,
  type WebhookRequest,
  type WebhookVerification,
} from './types';

/** Signs the playback token (RS256, `kid` header); the API injects one built on `jose`. */
export type SignJwt = (
  payload: Record<string, unknown>,
  kid: string,
  pem: string,
) => Promise<string>;

export interface CloudflareStreamOptions {
  accountId: string;
  apiToken: string;
  webhookSecret: string;
  signingKeyId: string;
  signingKeyPem: string;
  /** `customer-<code>.cloudflarestream.com` (a bare host name; `https://` is tolerated). */
  customerSubdomain: string;
  signJwt: SignJwt;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  /** Per-request timeout. */
  timeoutMs?: number;
}

const API_BASE = 'https://api.cloudflare.com/client/v4/accounts';
const UID = /^[0-9a-f]{32}$/i;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const MAX_ERROR_BODY = 2048;
const MAX_SIGNATURE_HEADER = 512;
const SIG_HEX = /^[0-9a-f]{64}$/i;
const TIME = /^\d{1,12}$/;

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');

function requireUid(ref: VideoAssetRef): string {
  const uid = ref.providerAssetId;
  if (!uid || !UID.test(uid)) throw new Error('CloudflareStreamProvider needs a providerAssetId');
  return uid;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const positiveInt = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

/** Cloudflare's video object (API `result` and webhook body) → our state and metadata. */
function mapVideo(video: Record<string, unknown>): Omit<VideoWebhookEvent, 'providerAssetId'> {
  const status = isRecord(video.status) ? video.status : {};
  const state =
    video.readyToStream === true ? 'READY' : status.state === 'error' ? 'FAILED' : 'PROCESSING';
  const input = isRecord(video.input) ? video.input : {};
  const out: Omit<VideoWebhookEvent, 'providerAssetId'> = {
    state,
    durationS:
      typeof video.duration === 'number' && Number.isFinite(video.duration) && video.duration >= 0
        ? Math.round(video.duration)
        : null,
    width: positiveInt(input.width),
    height: positiveInt(input.height),
  };
  if (typeof video.size === 'number' && Number.isSafeInteger(video.size) && video.size >= 0) {
    out.sizeBytes = video.size;
  }
  if (typeof video.thumbnail === 'string' && video.thumbnail.startsWith('https://')) {
    out.thumbnailUrl = video.thumbnail;
  }
  if (state === 'FAILED') {
    out.failureReason = 'PROVIDER_ERROR';
    if (typeof status.errorReasonCode === 'string' && status.errorReasonCode !== '') {
      out.providerErrorCode = status.errorReasonCode.slice(0, 100);
    }
  }
  return out;
}

/**
 * Cloudflare Stream adapter (`VIDEO_PROVIDER=cloudflare_stream`, D-P1; spec §6): tus direct
 * creator uploads, signed HLS manifests, HMAC-verified webhooks. Secrets live in `#private`
 * fields (absent from `inspect`/`JSON.stringify`) and are never put in errors or logs. Unit
 * tested with a `fetch` stub only: CI never calls Cloudflare.
 */
export class CloudflareStreamProvider implements VideoProvider {
  readonly name = 'CLOUDFLARE_STREAM' as const;
  readonly acceptedMimeTypes: readonly string[] = MEDIA_MIME_TYPES.VIDEO;
  readonly #accountId: string;
  readonly #apiToken: string;
  readonly #webhookSecret: string;
  readonly #signingKeyId: string;
  readonly #signingKeyPem: string;
  readonly #host: string;
  readonly #signJwt: SignJwt;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => Date;
  readonly #timeoutMs: number;

  constructor(options: CloudflareStreamOptions) {
    for (const key of [
      'accountId',
      'apiToken',
      'webhookSecret',
      'signingKeyId',
      'signingKeyPem',
      'customerSubdomain',
    ] as const) {
      if (!options[key]) throw new Error(`CloudflareStreamProvider: ${key} is required`);
    }
    const host = options.customerSubdomain.replace(/^https:\/\//i, '').replace(/\/$/, '');
    if (!HOST.test(host)) {
      throw new Error('CloudflareStreamProvider: customerSubdomain must be a host name');
    }
    this.#accountId = options.accountId;
    this.#apiToken = options.apiToken;
    this.#webhookSecret = options.webhookSecret;
    this.#signingKeyId = options.signingKeyId;
    this.#signingKeyPem = options.signingKeyPem;
    this.#host = host;
    this.#signJwt = options.signJwt;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? (() => new Date());
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  async createDirectUpload(input: CreateDirectUploadInput): Promise<DirectUpload> {
    assertUploadAccepted(this.acceptedMimeTypes, input);
    const expiresAt = new Date(this.#now().getTime() + input.ttlS * 1000);
    const metadata = [
      `maxDurationSeconds ${b64(String(input.maxDurationS))}`,
      'requiresignedurls',
      `expiry ${b64(expiresAt.toISOString())}`,
      // Our id, not the file name: no user content leaves for the provider.
      `name ${b64(input.mediaId)}`,
    ].join(',');
    const res = await this.#request(`/stream?direct_user=true`, {
      method: 'POST',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(input.sizeBytes),
        'Upload-Metadata': metadata,
      },
    });
    if (!res.ok) throw await this.#error(res);
    const uploadUrl = res.headers.get('location');
    const providerAssetId = res.headers.get('stream-media-id');
    if (!uploadUrl?.startsWith('https://') || !providerAssetId || !UID.test(providerAssetId)) {
      throw new VideoProviderError(res.status, 'tus creation without Location / stream-media-id');
    }
    return { mode: 'TUS', uploadUrl, providerAssetId, expiresAt };
  }

  async getAsset(ref: VideoAssetRef): Promise<VideoAssetInfo> {
    const uid = requireUid(ref);
    const res = await this.#request(`/stream/${uid}`, { method: 'GET' });
    if (res.status === 404) return { status: 'FAILED', failureReason: 'PROVIDER_ERROR' };
    if (!res.ok) throw await this.#error(res);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new VideoProviderError(res.status, 'invalid JSON');
    }
    if (!isRecord(body) || !isRecord(body.result)) {
      throw new VideoProviderError(res.status, 'unexpected response shape');
    }
    const { state, ...rest } = mapVideo(body.result);
    return { status: state, ...rest };
  }

  async signPlayback(ref: VideoAssetRef, options: { ttlS?: number } = {}): Promise<PlaybackGrant> {
    const uid = requireUid(ref);
    const ttlS = options.ttlS ?? PLAYBACK_TTL_S;
    const nowMs = this.#now().getTime();
    const token = await this.#signJwt(
      { sub: uid, kid: this.#signingKeyId, exp: Math.floor(nowMs / 1000) + ttlS },
      this.#signingKeyId,
      this.#signingKeyPem,
    );
    const base = `https://${this.#host}/${token}`;
    return {
      kind: 'HLS',
      url: `${base}/manifest/video.m3u8`,
      thumbnailUrl: `${base}/thumbnails/thumbnail.jpg`,
      expiresAt: new Date(nowMs + ttlS * 1000),
    };
  }

  async delete(ref: VideoAssetRef): Promise<void> {
    if (!ref.providerAssetId) return;
    const uid = requireUid(ref);
    const res = await this.#request(`/stream/${uid}`, { method: 'DELETE' });
    if (res.status === 404) return;
    if (!res.ok) throw await this.#error(res);
  }

  /**
   * `Webhook-Signature: time=<unix s>,sig1=<hex HMAC-SHA256(secret, "<time>.<raw body>")>`;
   * `|now − time| ≤ WEBHOOK_TOLERANCE_S`; constant-time comparison; `eventId` = sha256(body).
   */
  verifyWebhook(req: WebhookRequest): WebhookVerification {
    const header = headerValue(req.headers, 'webhook-signature');
    if (!header) return { ok: false, reason: 'MISSING_SIGNATURE' };
    if (header.length > MAX_SIGNATURE_HEADER) return { ok: false, reason: 'INVALID_SIGNATURE' };

    const fields = new Map<string, string>();
    for (const pair of header.split(',')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) return { ok: false, reason: 'INVALID_SIGNATURE' };
      const key = pair.slice(0, eq).trim();
      if (fields.has(key)) return { ok: false, reason: 'INVALID_SIGNATURE' };
      fields.set(key, pair.slice(eq + 1).trim());
    }
    const time = fields.get('time');
    const sig1 = fields.get('sig1');
    if (!time || !TIME.test(time) || !sig1 || !SIG_HEX.test(sig1)) {
      return { ok: false, reason: 'INVALID_SIGNATURE' };
    }

    const nowS = (req.now ?? this.#now()).getTime() / 1000;
    if (Math.abs(nowS - Number(time)) > WEBHOOK_TOLERANCE_S) {
      return { ok: false, reason: 'INVALID_TIME' };
    }

    const expected = createHmac('sha256', this.#webhookSecret)
      .update(`${time}.`)
      .update(req.rawBody)
      .digest();
    const given = Buffer.from(sig1, 'hex'); // 32 bytes: SIG_HEX checked the length
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return { ok: false, reason: 'INVALID_SIGNATURE' };
    }

    let video: unknown;
    try {
      video = JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      return { ok: false, reason: 'INVALID_PAYLOAD' };
    }
    if (!isRecord(video) || typeof video.uid !== 'string' || !UID.test(video.uid)) {
      return { ok: false, reason: 'INVALID_PAYLOAD' };
    }
    return {
      ok: true,
      eventId: createHash('sha256').update(req.rawBody).digest('hex'),
      events: [{ providerAssetId: video.uid, ...mapVideo(video) }],
    };
  }

  async #request(path: string, init: { method: string; headers?: Record<string, string> }) {
    try {
      return await this.#fetch(`${API_BASE}/${encodeURIComponent(this.#accountId)}${path}`, {
        method: init.method,
        headers: { ...init.headers, Authorization: `Bearer ${this.#apiToken}` },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      // Never wrap the original error: its cause could carry the request (and the token).
      throw new VideoProviderError(0, error instanceof Error ? error.name : 'fetch failed');
    }
  }

  async #error(res: Response): Promise<VideoProviderError> {
    const text = await res.text().catch(() => '');
    return new VideoProviderError(res.status, text.slice(0, MAX_ERROR_BODY));
  }
}
