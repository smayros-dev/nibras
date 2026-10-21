import { createHash, createHmac } from 'node:crypto';
import { MEDIA_WEBHOOK_PROCESS_JOB, QUEUES, webhookProcessJobId } from '@nibras/contracts';
import { CloudflareStreamProvider } from '@nibras/providers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VIDEO_PROVIDER_TOKEN } from '../../src/media/tokens';
import { createTestApp, type TestContext } from '../helpers/app';

const SECRET = 'test-secret';
const UID = 'ea95132c15732412d22c1476fa83f27a';
const URL = '/api/v1/webhooks/media/cloudflare_stream';

/** A Cloudflare Stream "video ready" notification (the video object). */
const readyBody = (modified = '2026-10-21T10:00:00.000000Z') =>
  JSON.stringify({
    uid: UID,
    readyToStream: true,
    status: { state: 'ready' },
    duration: 125.5,
    input: { width: 1920, height: 1080 },
    size: 4_200_000,
    modified,
    meta: { name: 'cours.mp4' },
  });

/** `Webhook-Signature: time=…,sig1=…` = HMAC-SHA256(secret, `${time}.${body}`). */
function signature(body: string, time = Math.floor(Date.now() / 1000), secret = SECRET): string {
  const sig1 = createHmac('sha256', secret).update(`${time}.${body}`).digest('hex');
  return `time=${time},sig1=${sig1}`;
}

describe('POST /webhooks/media/{provider} — verified VOD webhooks (SP3 T7, Review Focus 6)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    const cloudflare = new CloudflareStreamProvider({
      accountId: 'account',
      apiToken: 'api-token',
      webhookSecret: SECRET,
      signingKeyId: 'kid',
      signingKeyPem: 'pem',
      customerSubdomain: 'customer-test.cloudflarestream.com',
      signJwt: () => Promise.resolve('JWT'),
    });
    ctx = await createTestApp({
      overrides: (b) => b.overrideProvider(VIDEO_PROVIDER_TOKEN).useValue(cloudflare),
    });
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  const post = (body: string, sig?: string) => {
    const req = ctx.http.post(URL).set('Content-Type', 'application/json');
    return (sig === undefined ? req : req.set('Webhook-Signature', sig)).send(body);
  };

  it('valid signature → 200 + WebhookEvent + one job; replay → 200 duplicate, no second job (AC-MED-02 idempotence)', async () => {
    const body = readyBody();
    const res = await post(body, signature(body)).expect(200);
    expect(res.body).toEqual({ received: true, duplicate: false });
    const events = await ctx.db.webhookEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'cloudflare_stream',
      providerEventId: createHash('sha256').update(body).digest('hex'),
      signatureValid: true,
      processedAt: null,
    });
    expect(events[0]!.payload).toMatchObject({
      events: [
        {
          providerAssetId: UID,
          state: 'READY',
          durationS: 126,
          width: 1920,
          height: 1080,
          sizeBytes: 4_200_000,
        },
      ],
    });
    expect(ctx.queue.jobs).toEqual([
      {
        queue: QUEUES.media,
        name: MEDIA_WEBHOOK_PROCESS_JOB,
        data: { webhookEventId: events[0]!.id },
        opts: { jobId: webhookProcessJobId(events[0]!.id) },
      },
    ]);

    // The provider retries the same body (a fresh signature time): stored once, enqueued once.
    const replay = await post(body, signature(body)).expect(200);
    expect(replay.body).toEqual({ received: true, duplicate: true });
    expect(await ctx.db.webhookEvent.count()).toBe(1);
    expect(ctx.queue.jobs).toHaveLength(1);

    // A later notification of the same video (another `modified`) is a distinct event (D11).
    const later = readyBody('2026-10-21T10:05:00.000000Z');
    await post(later, signature(later)).expect(200);
    expect(await ctx.db.webhookEvent.count()).toBe(2);
    expect(ctx.queue.jobs).toHaveLength(2);
  });

  it('stale time / bad signature / missing header → 401 WEBHOOK_SIGNATURE_INVALID and no row; an unknown provider → 404', async () => {
    const body = readyBody();
    const stale = Math.floor(Date.now() / 1000) - 301;
    const cases: [string | undefined, string][] = [
      [signature(body, stale), 'INVALID_TIME'],
      [signature(body, undefined, 'wrong-secret'), 'INVALID_SIGNATURE'],
      [signature(`${body} `), 'INVALID_SIGNATURE'],
      [undefined, 'MISSING_SIGNATURE'],
    ];
    for (const [sig, reason] of cases) {
      const res = await post(body, sig).expect(401);
      expect(res.body).toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID', details: { reason } });
    }
    await ctx.http
      .post('/api/v1/webhooks/media/mux')
      .set('Content-Type', 'application/json')
      .set('Webhook-Signature', signature(body))
      .send(body)
      .expect(404);
    expect(await ctx.db.webhookEvent.count()).toBe(0);
    expect(ctx.queue.jobs).toEqual([]);
    const rejected = ctx.logs.lines().filter((l) => l.msg === 'media.webhook_rejected');
    expect(rejected.map((l) => l.reason)).toEqual([
      'INVALID_TIME',
      'INVALID_SIGNATURE',
      'INVALID_SIGNATURE',
      'MISSING_SIGNATURE',
    ]);
  });
});

describe('POST /webhooks/media/{provider} on the S3 passthrough provider', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  it('has no webhooks: 404, nothing stored', async () => {
    const body = readyBody();
    for (const provider of ['s3', 'cloudflare_stream']) {
      await ctx.http
        .post(`/api/v1/webhooks/media/${provider}`)
        .set('Content-Type', 'application/json')
        .set('Webhook-Signature', signature(body))
        .send(body)
        .expect(404);
    }
    expect(await ctx.db.webhookEvent.count()).toBe(0);
  });
});
