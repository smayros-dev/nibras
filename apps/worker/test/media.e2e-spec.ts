import { Test } from '@nestjs/testing';
import {
  HOURLY_SCHEDULER_PATTERN,
  MEDIA_CLEANUP_JOB,
  MEDIA_CLEANUP_SCHEDULER_ID,
  MEDIA_DELETE_JOB,
  MEDIA_PROCESS_JOB,
  MEDIA_WEBHOOK_PROCESS_JOB,
  QUEUES,
  UPLOAD_ABANDON_AFTER_MS,
  defaultWorkspaceSettings,
  mediaDeleteJobId,
  mediaProcessJobId,
  webhookProcessJobId,
} from '@nibras/contracts';
import {
  resetDatabase,
  systemPrisma,
  type MediaAsset,
  type Prisma,
  type User,
  type Workspace,
} from '@nibras/db';
import {
  FakeVideoProvider,
  InMemoryEmailProvider,
  S3StorageProvider,
  storageKeyFor,
  type VideoWebhookEvent,
} from '@nibras/providers';
import { Queue, type Job } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { EMAIL_PROVIDER, STORAGE_PROVIDER, VIDEO_PROVIDER_TOKEN } from '../src/providers';
import { ProcessorRegistry } from '../src/queues';
import { SCHEDULERS, Schedulers } from '../src/schedulers';
import { WorkerModule } from '../src/worker.module';
import {
  BROKEN_PDF_BYTES,
  ENCRYPTED_PDF_BYTES,
  PDF_BYTES,
  PNG_1X1,
  buildMp4,
  pngHeader,
} from './fixtures/media';
import { obliterateAllQueues, redisOpts } from './redis';

const db = systemPrisma();
const HOUR = 3600 * 1000;

let n = 0;
async function teacherWorkspace(o: { locale?: User['locale'] } = {}) {
  n += 1;
  const owner = await db.user.create({
    data: {
      email: `media-${n}-${Date.now()}@example.com`,
      firstName: 'Amel',
      lastName: 'Teacher',
      locale: o.locale ?? 'fr',
    },
  });
  const ws = await db.workspace.create({
    data: {
      type: 'PERSONAL',
      name: `Media ws ${n}`,
      slug: `media-ws-${n}-${Date.now()}`,
      ownerUserId: owner.id,
      defaultTimezone: 'Africa/Tunis',
      defaultLocale: 'fr',
      storageQuotaBytes: 10n * 1024n * 1024n * 1024n,
      settings: { ...defaultWorkspaceSettings('Africa/Tunis') },
    },
  });
  await db.membership.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
  });
  return { owner, ws };
}

type AssetInput = Partial<Prisma.MediaAssetUncheckedCreateInput> &
  Pick<Prisma.MediaAssetUncheckedCreateInput, 'kind' | 'status'>;

/**
 * A media row as the API leaves it; `countedBytes` is added to the workspace usage (what the
 * API's `complete` does), so the quota invariant holds from the start.
 */
async function asset(ws: Workspace, owner: User, data: AssetInput): Promise<MediaAsset> {
  const created = await db.mediaAsset.create({
    data: {
      workspaceId: ws.id,
      ownerUserId: owner.id,
      provider: 'S3',
      originalFilename: 'cours.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000n,
      ...data,
    },
  });
  if (created.countedBytes > 0n) {
    await db.workspace.update({
      where: { id: ws.id },
      data: { storageUsedBytes: { increment: created.countedBytes } },
    });
  }
  return created;
}

/** `storageUsedBytes` = Σ `countedBytes` of the workspace's assets (spec D17). */
async function expectQuotaInvariant(wid: string): Promise<void> {
  const { storageUsedBytes } = await db.workspace.findUniqueOrThrow({
    where: { id: wid },
    select: { storageUsedBytes: true },
  });
  const counted = await db.mediaAsset.aggregate({
    where: { workspaceId: wid },
    _sum: { countedBytes: true },
  });
  expect(storageUsedBytes, `workspace ${wid}: storageUsedBytes = Σ countedBytes`).toBe(
    counted._sum.countedBytes ?? 0n,
  );
}

/** A BullMQ-like job whose `progress` survives between runs (stored as a copy, like Redis). */
function fakeJob<T>(name: string, id: string, data: T) {
  const job = {
    name,
    id,
    data,
    attemptsMade: 0,
    progress: 0 as unknown,
    updateProgress(p: unknown) {
      job.progress = structuredClone(p);
      return Promise.resolve();
    },
  };
  return job;
}

function run(registry: ProcessorRegistry, job: { name: string }) {
  return registry.dispatch(QUEUES.media, job as unknown as Job);
}

async function boot(video?: FakeVideoProvider) {
  const email = new InMemoryEmailProvider();
  let builder = Test.createTestingModule({
    imports: [WorkerModule.register(loadEnv(), createLogger('silent'))],
  })
    .overrideProvider(EMAIL_PROVIDER)
    .useValue(email);
  if (video) builder = builder.overrideProvider(VIDEO_PROVIDER_TOKEN).useValue(video);
  const moduleRef = await builder.compile();
  await moduleRef.init();
  await moduleRef.get(Schedulers).ready;
  return {
    moduleRef,
    email,
    registry: moduleRef.get(ProcessorRegistry),
    storage: moduleRef.get<S3StorageProvider>(STORAGE_PROVIDER),
  };
}

/** Refuses any bucket but this package's derived test bucket (`nibras-…-worker-test`). */
function assertTestBucket(storage: S3StorageProvider): void {
  if (storage.bucket !== process.env.S3_BUCKET_TEST || !/-worker(-test)?$/.test(storage.bucket)) {
    throw new Error(`refusing to use bucket "${storage.bucket}" in the worker tests`);
  }
}

/** Stores `bytes` under `key` through a one-part multipart upload (what the API's complete leaves). */
async function putObject(
  storage: S3StorageProvider,
  key: string,
  bytes: Buffer,
  mimeType: string,
): Promise<void> {
  const { uploadId } = await storage.createMultipartUpload(key, mimeType);
  const url = await storage.signPartUrl(key, uploadId, 1, 600);
  const res = await fetch(url, { method: 'PUT', body: bytes });
  expect(res.status).toBe(200);
  await storage.completeMultipart(key, uploadId, [
    { partNumber: 1, etag: res.headers.get('etag')!, size: bytes.length },
  ]);
}

/** A `PROCESSING` S3 asset whose object is stored (the state `complete` leaves). */
async function processingAsset(
  storage: S3StorageProvider,
  ws: Workspace,
  owner: User,
  o: { kind: 'PDF' | 'IMAGE' | 'VIDEO'; bytes: Buffer; mimeType: string; filename: string },
): Promise<MediaAsset> {
  const id = crypto.randomUUID();
  const key = storageKeyFor({
    workspaceId: ws.id,
    kind: o.kind,
    mediaId: id,
    filename: o.filename,
  });
  await putObject(storage, key, o.bytes, o.mimeType);
  return asset(ws, owner, {
    id,
    kind: o.kind,
    status: 'PROCESSING',
    storageKey: key,
    originalFilename: o.filename,
    mimeType: o.mimeType,
    sizeBytes: BigInt(o.bytes.length),
    countedBytes: BigInt(o.bytes.length),
    processingStartedAt: new Date(),
  });
}

const processJob = (a: MediaAsset) =>
  fakeJob(MEDIA_PROCESS_JOB, mediaProcessJobId(a.id), {
    mediaId: a.id,
    workspaceId: a.workspaceId,
  });

const reload = (id: string) => db.mediaAsset.findUnique({ where: { id } });

describe('media.process (spec §4.3, AC-MED-02/07)', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    ctx = await boot();
    assertTestBucket(ctx.storage);
    await ctx.storage.ensureBucket();
  });

  afterAll(async () => {
    await ctx?.moduleRef.close();
    await obliterateAllQueues();
  });

  beforeEach(async () => {
    await obliterateAllQueues();
    await resetDatabase(db);
    await ctx.storage.emptyBucket();
    ctx.email.clear();
  });

  it('process: PDF → READY with pageCount 2; encrypted PDF → FAILED ENCRYPTED + email media.failed to the owner; PNG → width/height; MP4 → duration from the probe; READY asset → no-op', async () => {
    const { owner, ws } = await teacherWorkspace();
    const { storage, registry, email } = ctx;

    const pdf = await processingAsset(storage, ws, owner, {
      kind: 'PDF',
      bytes: PDF_BYTES,
      mimeType: 'application/pdf',
      filename: 'cours.pdf',
    });
    await run(registry, processJob(pdf));
    const pdfAfter = await reload(pdf.id);
    expect(pdfAfter).toMatchObject({
      status: 'READY',
      pageCount: 2,
      failureReason: null,
      mimeType: 'application/pdf',
    });
    expect(pdfAfter!.readyAt).toBeInstanceOf(Date);

    const locked = await processingAsset(storage, ws, owner, {
      kind: 'PDF',
      bytes: ENCRYPTED_PDF_BYTES,
      mimeType: 'application/pdf',
      filename: 'secret.pdf',
    });
    await run(registry, processJob(locked));
    expect(await reload(locked.id)).toMatchObject({ status: 'FAILED', failureReason: 'ENCRYPTED' });
    const failed = email.findByTemplate('media.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.to).toBe(owner.email);
    expect(failed[0]!.params).toMatchObject({
      firstName: 'Amel',
      filename: 'secret.pdf',
      reason: 'ENCRYPTED',
    });
    expect(failed[0]!.params.link).toMatch(new RegExp(`/fr/app/w/${ws.id}/courses$`));
    const audit = await db.auditLog.findMany({ where: { entityId: locked.id } });
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'media.failed',
        actorRole: 'SYSTEM',
        workspaceId: ws.id,
        requestId: `job:${mediaProcessJobId(locked.id)}`,
      }),
    ]);

    const broken = await processingAsset(storage, ws, owner, {
      kind: 'PDF',
      bytes: BROKEN_PDF_BYTES,
      mimeType: 'application/pdf',
      filename: 'broken.pdf',
    });
    await run(registry, processJob(broken));
    expect(await reload(broken.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'INVALID_SIGNATURE',
    });

    const png = await processingAsset(storage, ws, owner, {
      kind: 'IMAGE',
      bytes: PNG_1X1,
      mimeType: 'image/png',
      filename: 'pixel.png',
    });
    await run(registry, processJob(png));
    expect(await reload(png.id)).toMatchObject({ status: 'READY', width: 1, height: 1 });

    const big = await processingAsset(storage, ws, owner, {
      kind: 'IMAGE',
      bytes: pngHeader(1920, 1080),
      mimeType: 'image/png',
      filename: 'cover.png',
    });
    await run(registry, processJob(big));
    expect(await reload(big.id)).toMatchObject({ status: 'READY', width: 1920, height: 1080 });

    const mp4 = await processingAsset(storage, ws, owner, {
      kind: 'VIDEO',
      bytes: buildMp4({ durationMs: 30_000, width: 640, height: 360 }),
      mimeType: 'video/mp4',
      filename: 'intro.mp4',
    });
    await run(registry, processJob(mp4));
    expect(await reload(mp4.id)).toMatchObject({
      status: 'READY',
      durationS: 30,
      width: 640,
      height: 360,
    });

    // Over 4 h → FAILED SIZE_MISMATCH (D-P15, checked at READY).
    const long = await processingAsset(storage, ws, owner, {
      kind: 'VIDEO',
      bytes: buildMp4({ durationMs: (4 * 3600 + 1) * 1000 }),
      mimeType: 'video/mp4',
      filename: 'long.mp4',
    });
    await run(registry, processJob(long));
    expect(await reload(long.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'SIZE_MISMATCH',
    });

    // A second run (BullMQ retry, duplicate) on a READY / FAILED asset changes nothing.
    const before = await reload(pdf.id);
    ctx.email.clear();
    await run(registry, processJob(pdf));
    await run(registry, processJob(locked));
    expect(await reload(pdf.id)).toEqual(before);
    expect(ctx.email.sent).toHaveLength(0);
    await expectQuotaInvariant(ws.id);
  });

  it('process: a failed email fails the job; the retry sends it once (progress), never re-processing', async () => {
    const { owner, ws } = await teacherWorkspace({ locale: 'ar' });
    const locked = await processingAsset(ctx.storage, ws, owner, {
      kind: 'PDF',
      bytes: ENCRYPTED_PDF_BYTES,
      mimeType: 'application/pdf',
      filename: 'secret.pdf',
    });
    const job = processJob(locked);
    ctx.email.failFor(owner.email);
    await expect(run(ctx.registry, job)).rejects.toThrow();
    expect(await reload(locked.id)).toMatchObject({ status: 'FAILED', failureReason: 'ENCRYPTED' });
    ctx.email.clear();
    await run(ctx.registry, job);
    await run(ctx.registry, job);
    const sent = ctx.email.findByTemplate('media.failed');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.locale).toBe('ar');
  });

  it('process: an asset no longer PROCESSING (deleted meanwhile, or another workspace in the payload) is left alone', async () => {
    const { owner, ws } = await teacherWorkspace();
    const other = await teacherWorkspace();
    const pdf = await processingAsset(ctx.storage, ws, owner, {
      kind: 'PDF',
      bytes: PDF_BYTES,
      mimeType: 'application/pdf',
      filename: 'cours.pdf',
    });
    await run(
      ctx.registry,
      fakeJob(MEDIA_PROCESS_JOB, 'x', { mediaId: pdf.id, workspaceId: other.ws.id }),
    );
    expect(await reload(pdf.id)).toMatchObject({ status: 'PROCESSING' });
    await db.mediaAsset.update({ where: { id: pdf.id }, data: { status: 'DELETING' } });
    await run(ctx.registry, processJob(pdf));
    expect(await reload(pdf.id)).toMatchObject({ status: 'DELETING', pageCount: null });
    await run(
      ctx.registry,
      fakeJob(MEDIA_PROCESS_JOB, 'y', { mediaId: 'not-a-uuid', workspaceId: ws.id }),
    );
  });

  it('delete: provider delete then row removal and quota release; a provider failure leaves DELETING and throws', async () => {
    const { owner, ws } = await teacherWorkspace();
    const pdf = await processingAsset(ctx.storage, ws, owner, {
      kind: 'PDF',
      bytes: PDF_BYTES,
      mimeType: 'application/pdf',
      filename: 'cours.pdf',
    });
    const keep = await processingAsset(ctx.storage, ws, owner, {
      kind: 'IMAGE',
      bytes: PNG_1X1,
      mimeType: 'image/png',
      filename: 'keep.png',
    });
    await db.mediaAsset.update({
      where: { id: pdf.id },
      data: { status: 'DELETING', deletedAt: new Date() },
    });
    const job = fakeJob(MEDIA_DELETE_JOB, mediaDeleteJobId(pdf.id), {
      mediaId: pdf.id,
      workspaceId: ws.id,
    });

    const spy = vi.spyOn(ctx.storage, 'delete').mockRejectedValueOnce(new Error('S3 down'));
    await expect(run(ctx.registry, job)).rejects.toThrow();
    expect(await reload(pdf.id)).toMatchObject({ status: 'DELETING' });
    expect(await ctx.storage.head(pdf.storageKey!)).not.toBeNull();
    spy.mockRestore();

    await run(ctx.registry, job);
    expect(await reload(pdf.id)).toBeNull();
    expect(await ctx.storage.head(pdf.storageKey!)).toBeNull();
    const { storageUsedBytes } = await db.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    expect(storageUsedBytes).toBe(keep.countedBytes);
    await expectQuotaInvariant(ws.id);

    // Not DELETING (the API never enqueued it, or a retry after success) → no-op.
    await run(
      ctx.registry,
      fakeJob(MEDIA_DELETE_JOB, 'k', { mediaId: keep.id, workspaceId: ws.id }),
    );
    expect(await reload(keep.id)).toMatchObject({ status: 'PROCESSING' });
    await run(ctx.registry, job);
  });

  it('cleanup: UPLOADING older than 24 h → FAILED ABANDONED and the multipart aborted; PROCESSING older than 6 h → FAILED TIMEOUT + email (AC-MED-03)', async () => {
    const { owner, ws } = await teacherWorkspace();
    const old = new Date(Date.now() - UPLOAD_ABANDON_AFTER_MS - HOUR);
    const id = crypto.randomUUID();
    const key = storageKeyFor({ workspaceId: ws.id, kind: 'PDF', mediaId: id, filename: 'a.pdf' });
    const { uploadId } = await ctx.storage.createMultipartUpload(key, 'application/pdf');
    const abandoned = await asset(ws, owner, {
      id,
      kind: 'PDF',
      status: 'UPLOADING',
      storageKey: key,
      uploadId,
      createdAt: old,
    });
    const fresh = await asset(ws, owner, { kind: 'PDF', status: 'UPLOADING' });
    const stuck = await asset(ws, owner, {
      kind: 'PDF',
      status: 'PROCESSING',
      originalFilename: 'lent.pdf',
      countedBytes: 1000n,
      processingStartedAt: new Date(Date.now() - 7 * HOUR),
    });
    const recent = await asset(ws, owner, {
      kind: 'PDF',
      status: 'PROCESSING',
      countedBytes: 500n,
      processingStartedAt: new Date(Date.now() - HOUR),
    });

    const result = await run(ctx.registry, fakeJob(MEDIA_CLEANUP_JOB, 'cleanup:1', {}));
    expect(result).toEqual({ abandoned: 1, timedOut: 1, reconciled: 0 });
    expect(await reload(abandoned.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'ABANDONED',
      uploadId: null,
    });
    await expect(ctx.storage.listParts(key, uploadId)).rejects.toThrow();
    expect(await reload(fresh.id)).toMatchObject({ status: 'UPLOADING' });
    expect(await reload(stuck.id)).toMatchObject({ status: 'FAILED', failureReason: 'TIMEOUT' });
    expect(await reload(recent.id)).toMatchObject({ status: 'PROCESSING' });

    const mails = ctx.email.findByTemplate('media.failed');
    expect(mails).toHaveLength(1);
    expect(mails[0]!.params).toMatchObject({ filename: 'lent.pdf', reason: 'TIMEOUT' });
    const audits = await db.auditLog.findMany({
      where: { action: 'media.failed' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.entityId).sort()).toEqual([abandoned.id, stuck.id].sort());
    expect(audits.every((a) => a.actorRole === 'SYSTEM' && a.workspaceId === ws.id)).toBe(true);
    await expectQuotaInvariant(ws.id);

    // A second hourly run finds nothing to do.
    ctx.email.clear();
    expect(await run(ctx.registry, fakeJob(MEDIA_CLEANUP_JOB, 'cleanup:2', {}))).toEqual({
      abandoned: 0,
      timedOut: 0,
      reconciled: 0,
    });
    expect(ctx.email.sent).toHaveLength(0);
  });

  it('scheduler media-cleanup-abandoned is upserted hourly', async () => {
    expect(SCHEDULERS).toContainEqual({
      id: MEDIA_CLEANUP_SCHEDULER_ID,
      queue: QUEUES.media,
      jobName: MEDIA_CLEANUP_JOB,
      pattern: HOURLY_SCHEDULER_PATTERN,
    });
    // `beforeEach` obliterated the queues: boot again so the upsert is observable.
    const second = await boot();
    const media = new Queue(QUEUES.media, { connection: redisOpts });
    try {
      const scheduler = await media.getJobScheduler(MEDIA_CLEANUP_SCHEDULER_ID);
      expect(scheduler).toMatchObject({
        key: MEDIA_CLEANUP_SCHEDULER_ID,
        name: MEDIA_CLEANUP_JOB,
        pattern: HOURLY_SCHEDULER_PATTERN,
        tz: 'UTC',
      });
      expect(scheduler?.template?.opts).toMatchObject({ attempts: 3 });
      expect(await media.getJobSchedulersCount()).toBe(1);
    } finally {
      await media.close();
      await second.moduleRef.close();
    }
  });
});

describe('media jobs on a Cloudflare-like provider (FakeVideoProvider)', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  const video = new FakeVideoProvider();

  beforeAll(async () => {
    ctx = await boot(video);
  });

  afterAll(async () => {
    await ctx?.moduleRef.close();
    await obliterateAllQueues();
  });

  beforeEach(async () => {
    await obliterateAllQueues();
    await resetDatabase(db);
    ctx.email.clear();
    video.assets.clear();
    video.deleted.length = 0;
  });

  const streamAsset = (ws: Workspace, owner: User, data: Partial<AssetInput> = {}) =>
    asset(ws, owner, {
      kind: 'VIDEO',
      status: 'UPLOADING',
      provider: 'CLOUDFLARE_STREAM',
      providerAssetId: crypto.randomUUID().replaceAll('-', ''),
      originalFilename: 'cours.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 5000n,
      ...data,
    });

  async function webhook(events: VideoWebhookEvent[]) {
    const row = await db.webhookEvent.create({
      data: {
        provider: 'cloudflare_stream',
        providerEventId: crypto.randomUUID(),
        payload: { events } as unknown as Prisma.InputJsonValue,
        signatureValid: true,
      },
    });
    return fakeJob(MEDIA_WEBHOOK_PROCESS_JOB, webhookProcessJobId(row.id), {
      webhookEventId: row.id,
    });
  }

  it('webhook process: ready event → READY with duration and sizeBytes counted in the quota; error event → FAILED PROVIDER_ERROR + email; a ready after FAILED is ignored; processedAt set; second run no-op (Review Focus 6)', async () => {
    const { owner, ws } = await teacherWorkspace();
    const a = await streamAsset(ws, owner);
    const b = await streamAsset(ws, owner, { originalFilename: 'raté.mov' });

    const processing = await webhook([
      { providerAssetId: a.providerAssetId!, state: 'PROCESSING' },
    ]);
    await run(ctx.registry, processing);
    expect(await reload(a.id)).toMatchObject({ status: 'PROCESSING' });
    expect((await reload(a.id))!.processingStartedAt).toBeInstanceOf(Date);

    const job = await webhook([
      {
        providerAssetId: a.providerAssetId!,
        state: 'READY',
        durationS: 95,
        width: 1920,
        height: 1080,
        thumbnailUrl: 'https://videodelivery.test/thumb.jpg',
        sizeBytes: 123_456,
      },
      { providerAssetId: b.providerAssetId!, state: 'FAILED', providerErrorCode: 'ERR_DURATION' },
      { providerAssetId: 'unknown-uid', state: 'READY' },
    ]);
    await run(ctx.registry, job);
    expect(await reload(a.id)).toMatchObject({
      status: 'READY',
      durationS: 95,
      width: 1920,
      height: 1080,
      thumbnailUrl: 'https://videodelivery.test/thumb.jpg',
      sizeBytes: 123_456n,
      countedBytes: 123_456n,
    });
    const { storageUsedBytes } = await db.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    expect(storageUsedBytes).toBe(123_456n);
    expect(await reload(b.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'PROVIDER_ERROR',
      countedBytes: 0n,
    });
    const mails = ctx.email.findByTemplate('media.failed');
    expect(mails).toHaveLength(1);
    expect(mails[0]!.params).toMatchObject({ filename: 'raté.mov', reason: 'PROVIDER_ERROR' });
    const event = await db.webhookEvent.findUniqueOrThrow({
      where: { id: job.data.webhookEventId },
    });
    expect(event.processedAt).toBeInstanceOf(Date);

    // Second run of the same job: processedAt is set → nothing (no double count, no 2nd email).
    ctx.email.clear();
    await run(ctx.registry, job);
    expect(ctx.email.sent).toHaveLength(0);
    // A later READY for the FAILED asset is ignored; a duplicate READY for a READY one too.
    const late = await webhook([
      { providerAssetId: b.providerAssetId!, state: 'READY', durationS: 10, sizeBytes: 999 },
      { providerAssetId: a.providerAssetId!, state: 'READY', durationS: 95, sizeBytes: 123_456 },
    ]);
    await run(ctx.registry, late);
    expect(await reload(b.id)).toMatchObject({ status: 'FAILED', countedBytes: 0n });
    expect(await reload(a.id)).toMatchObject({ countedBytes: 123_456n });
    await expectQuotaInvariant(ws.id);
    expect(
      (await db.webhookEvent.findUniqueOrThrow({ where: { id: late.data.webhookEventId } }))
        .processedAt,
    ).toBeInstanceOf(Date);
  });

  it('webhook process: a READY over 4 h is FAILED SIZE_MISMATCH and nothing is counted', async () => {
    const { owner, ws } = await teacherWorkspace();
    const a = await streamAsset(ws, owner);
    await run(
      ctx.registry,
      await webhook([
        { providerAssetId: a.providerAssetId!, state: 'READY', durationS: 14_401, sizeBytes: 10 },
      ]),
    );
    expect(await reload(a.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'SIZE_MISMATCH',
      countedBytes: 0n,
    });
    await expectQuotaInvariant(ws.id);
  });

  it('cleanup: a Cloudflare PROCESSING asset that getAsset reports READY is reconciled instead; one still processing times out; an abandoned tus upload is deleted at the provider', async () => {
    const { owner, ws } = await teacherWorkspace();
    const late = new Date(Date.now() - 7 * HOUR);
    const ready = await streamAsset(ws, owner, { status: 'PROCESSING', processingStartedAt: late });
    const slow = await streamAsset(ws, owner, { status: 'PROCESSING', processingStartedAt: late });
    const gone = await streamAsset(ws, owner, {
      createdAt: new Date(Date.now() - UPLOAD_ABANDON_AFTER_MS - HOUR),
    });
    video.assets.set(ready.providerAssetId!, {
      status: 'READY',
      durationS: 60,
      width: 1280,
      height: 720,
      sizeBytes: 4242,
    });

    const result = await run(ctx.registry, fakeJob(MEDIA_CLEANUP_JOB, 'cleanup:cf', {}));
    expect(result).toEqual({ abandoned: 1, timedOut: 1, reconciled: 1 });
    expect(await reload(ready.id)).toMatchObject({
      status: 'READY',
      durationS: 60,
      countedBytes: 4242n,
    });
    expect(await reload(slow.id)).toMatchObject({ status: 'FAILED', failureReason: 'TIMEOUT' });
    expect(await reload(gone.id)).toMatchObject({ status: 'FAILED', failureReason: 'ABANDONED' });
    expect(video.deleted).toEqual([gone.providerAssetId]);
    expect(ctx.email.findByTemplate('media.failed').map((m) => m.params.reason)).toEqual([
      'TIMEOUT',
    ]);
    await expectQuotaInvariant(ws.id);
  });

  it('delete: a Cloudflare video is deleted at the provider, then its row; quota released', async () => {
    const { owner, ws } = await teacherWorkspace();
    const a = await streamAsset(ws, owner, {
      status: 'DELETING',
      deletedAt: new Date(),
      countedBytes: 777n,
    });
    await run(
      ctx.registry,
      fakeJob(MEDIA_DELETE_JOB, mediaDeleteJobId(a.id), { mediaId: a.id, workspaceId: ws.id }),
    );
    expect(video.deleted).toEqual([a.providerAssetId]);
    expect(await reload(a.id)).toBeNull();
    await expectQuotaInvariant(ws.id);
    const { storageUsedBytes } = await db.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    expect(storageUsedBytes).toBe(0n);
  });
});
