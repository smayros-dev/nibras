import {
  MEDIA_PROCESS_JOB,
  MEDIA_DELETE_JOB,
  QUEUES,
  UPLOAD_PART_SIZE_BYTES,
  mediaDeleteJobId,
  mediaProcessJobId,
} from '@nibras/contracts';
import type { PrismaClient, User, Workspace } from '@nibras/db';
import { FakeVideoProvider } from '@nibras/providers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VIDEO_PROVIDER_TOKEN } from '../../src/media/tokens';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import {
  createCourse,
  createLesson,
  createMediaAsset,
  createModule,
  createOrganization,
  createPersonalWorkspace,
  createUser,
} from '../helpers/factories';
import { expectQuotaInvariant } from '../helpers/invariants';
import { createTicket, mediaUrl, partBytes, putPart, uploadThroughApi } from '../helpers/media';
import { EXE_BYTES, MP4_BYTES, PDF_BYTES, PNG_BYTES, padTo } from './fixtures';

const GiB = 1024 ** 3;

const verifiedUser = (o: Parameters<typeof createUser>[0] = {}) =>
  createUser({ phoneVerified: true, consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'], ...o });

describe('media uploads — S3 multipart, resume, complete checks, deletion (SP3 T7)', () => {
  let ctx: TestContext;
  let http: TestAgent;
  let db: PrismaClient;

  beforeAll(async () => {
    ctx = await createTestApp();
    ({ http, db } = ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  const agent = async (user: User) => as(http, (await loginAs(ctx, user)).cookie);

  async function teacherSpace(): Promise<{ teacher: User; workspace: Workspace }> {
    const teacher = await verifiedUser();
    const workspace = await createPersonalWorkspace(teacher);
    return { teacher, workspace };
  }

  const asset = (id: string) => db.mediaAsset.findUniqueOrThrow({ where: { id } });
  const usedBytes = async (wid: string) =>
    (await db.workspace.findUniqueOrThrow({ where: { id: wid } })).storageUsedBytes;

  it('PDF multipart: ticket → parts PUT → complete → PROCESSING, media.process job, quota committed with the actual size (AC-MED-07 data side)', async () => {
    const { teacher, workspace } = await teacherSpace();
    const a = await agent(teacher);
    const ticket = await createTicket(a, workspace.id, {
      kind: 'PDF',
      filename: 'Cours 1 — algèbre.pdf',
      mimeType: 'application/pdf',
      bytes: PDF_BYTES,
    });
    expect(ticket).toMatchObject({
      mode: 'S3_MULTIPART',
      partSizeBytes: UPLOAD_PART_SIZE_BYTES,
      partCount: 1,
    });
    expect(ticket.parts.map((p) => p.partNumber)).toEqual([1]);
    expect(ticket.parts[0]!.url).toContain('X-Amz-Signature');
    const expires = new Date(ticket.expiresAt).getTime() - Date.now();
    expect(expires).toBeGreaterThan(3500_000);
    expect(expires).toBeLessThanOrEqual(3600_000);

    let row = await asset(ticket.mediaId);
    expect(row).toMatchObject({
      status: 'UPLOADING',
      provider: 'S3',
      kind: 'PDF',
      ownerUserId: teacher.id,
      originalFilename: 'Cours 1 — algèbre.pdf',
      sizeBytes: BigInt(PDF_BYTES.length),
      countedBytes: 0n,
    });
    expect(row.storageKey).toBe(`w/${workspace.id}/pdf/${ticket.mediaId}/Cours_1_algebre.pdf`);
    expect(row.uploadId).toBeTruthy();
    // The declared size is reserved while UPLOADING (spec D17).
    const storage = await a.get(`/api/v1/workspaces/${workspace.id}/storage`).expect(200);
    expect(storage.body).toMatchObject({ usedBytes: '0', reservedBytes: String(PDF_BYTES.length) });

    const etag = await putPart(ticket.parts[0]!.url, PDF_BYTES);
    const done = await a
      .post(mediaUrl(workspace.id, `/${ticket.mediaId}/complete`))
      .send({ parts: [{ partNumber: 1, etag }] })
      .expect(200);
    expect(done.body).toMatchObject({
      id: ticket.mediaId,
      status: 'PROCESSING',
      kind: 'PDF',
      mimeType: 'application/pdf',
      sizeBytes: String(PDF_BYTES.length),
      usedBy: [],
    });

    row = await asset(ticket.mediaId);
    expect(row).toMatchObject({
      status: 'PROCESSING',
      uploadId: null,
      countedBytes: BigInt(PDF_BYTES.length),
    });
    expect(row.processingStartedAt).toBeInstanceOf(Date);
    expect(await usedBytes(workspace.id)).toBe(BigInt(PDF_BYTES.length));
    await expectQuotaInvariant(db, workspace.id);
    expect(await ctx.storage.head(row.storageKey!)).toMatchObject({ sizeBytes: PDF_BYTES.length });
    expect(ctx.queue.jobs).toEqual([
      {
        queue: QUEUES.media,
        name: MEDIA_PROCESS_JOB,
        data: { mediaId: ticket.mediaId, workspaceId: workspace.id },
        opts: { jobId: mediaProcessJobId(ticket.mediaId) },
      },
    ]);
    const audit = await db.auditLog.findMany({
      where: { entityId: ticket.mediaId },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((r) => r.action)).toEqual(['media.upload_created', 'media.completed']);

    // A second complete is refused: the upload is no longer pending.
    await a
      .post(mediaUrl(workspace.id, `/${ticket.mediaId}/complete`))
      .send({})
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('UPLOAD_NOT_PENDING'));
  });

  it('resume: after uploading part 1 of 2 the state endpoint lists it and signs only part 2; completing works (AC-MED-01)', async () => {
    const { teacher, workspace } = await teacherSpace();
    const a = await agent(teacher);
    const bytes = padTo(PDF_BYTES, UPLOAD_PART_SIZE_BYTES + 1000);
    const ticket = await createTicket(a, workspace.id, {
      kind: 'PDF',
      filename: 'long.pdf',
      mimeType: 'application/pdf',
      bytes,
    });
    expect(ticket.partCount).toBe(2);
    expect(ticket.parts.map((p) => p.partNumber)).toEqual([1, 2]);

    // The connection drops after part 1.
    const etag1 = await putPart(ticket.parts[0]!.url, partBytes(bytes, ticket.partSizeBytes, 1));

    const state = await a.get(mediaUrl(workspace.id, `/${ticket.mediaId}/upload`)).expect(200);
    expect(state.body).toMatchObject({
      mediaId: ticket.mediaId,
      mode: 'S3_MULTIPART',
      partSizeBytes: UPLOAD_PART_SIZE_BYTES,
      partCount: 2,
      uploaded: [{ partNumber: 1, etag: etag1, size: UPLOAD_PART_SIZE_BYTES }],
    });
    expect(state.body.parts.map((p: { partNumber: number }) => p.partNumber)).toEqual([2]);
    expect((await asset(ticket.mediaId)).status).toBe('UPLOADING');

    await putPart(state.body.parts[0].url, partBytes(bytes, ticket.partSizeBytes, 2));
    // No ETags sent: the API completes with the parts the store lists.
    const done = await a
      .post(mediaUrl(workspace.id, `/${ticket.mediaId}/complete`))
      .send({})
      .expect(200);
    expect(done.body).toMatchObject({ status: 'PROCESSING', sizeBytes: String(bytes.length) });
    expect(await usedBytes(workspace.id)).toBe(BigInt(bytes.length));
    await expectQuotaInvariant(db, workspace.id);
  });

  it('signature: bytes MZ declared application/pdf → 415 INVALID_FILE_SIGNATURE, object gone, asset FAILED; a PDF declared image/png → 422 MEDIA_KIND_MISMATCH (Review Focus 3, AC-MED-04)', async () => {
    const { teacher, workspace } = await teacherSpace();
    const a = await agent(teacher);

    const exe = await uploadThroughApi(a, workspace.id, {
      kind: 'PDF',
      filename: 'cours.pdf',
      mimeType: 'application/pdf',
      bytes: EXE_BYTES,
    });
    expect(exe.complete.status).toBe(415);
    expect(exe.complete.body).toMatchObject({
      code: 'INVALID_FILE_SIGNATURE',
      details: { detected: 'application/x-msdownload' },
    });
    let row = await asset(exe.mediaId);
    expect(row).toMatchObject({
      status: 'FAILED',
      failureReason: 'INVALID_SIGNATURE',
      countedBytes: 0n,
    });
    expect(await ctx.storage.head(row.storageKey!)).toBeNull();

    const disguised = await uploadThroughApi(a, workspace.id, {
      kind: 'IMAGE',
      filename: 'photo.png',
      mimeType: 'image/png',
      bytes: PDF_BYTES,
    });
    expect(disguised.complete.status).toBe(422);
    expect(disguised.complete.body).toMatchObject({
      code: 'MEDIA_KIND_MISMATCH',
      details: { detected: 'application/pdf', kind: 'IMAGE' },
    });
    row = await asset(disguised.mediaId);
    expect(row).toMatchObject({ status: 'FAILED', failureReason: 'INVALID_SIGNATURE' });
    expect(await ctx.storage.head(row.storageKey!)).toBeNull();

    // The declared type is advisory: a PNG declared image/jpeg is stored as what it is.
    const png = await uploadThroughApi(a, workspace.id, {
      kind: 'IMAGE',
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      bytes: PNG_BYTES,
    });
    expect(png.complete.status).toBe(200);
    expect(png.complete.body).toMatchObject({ status: 'PROCESSING', mimeType: 'image/png' });

    expect(await usedBytes(workspace.id)).toBe(BigInt(PNG_BYTES.length));
    await expectQuotaInvariant(db, workspace.id);
    expect(ctx.queue.jobs.map((j) => (j.data as { mediaId: string }).mediaId)).toEqual([
      png.mediaId,
    ]);
  });

  it('quota: three parallel 4 GiB video tickets on a 10 GiB workspace → the third is 402 with the usage; a complete that overshoots → 402, object deleted (Review Focus 2)', async () => {
    const { teacher, workspace } = await teacherSpace();
    await db.workspace.update({
      where: { id: workspace.id },
      data: { storageQuotaBytes: BigInt(10 * GiB) },
    });
    const a = await agent(teacher);
    const declare = () =>
      a.post(mediaUrl(workspace.id, '/uploads')).send({
        kind: 'VIDEO',
        filename: 'cours.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 4 * GiB,
      });
    const results = await Promise.all([declare(), declare(), declare()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 402]);
    const refused = results.find((r) => r.status === 402)!;
    expect(refused.body).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      details: {
        usedBytes: '0',
        reservedBytes: String(8 * GiB),
        quotaBytes: String(10 * GiB),
        requestedBytes: String(4 * GiB),
      },
    });
    expect(await db.mediaAsset.count({ where: { workspaceId: workspace.id } })).toBe(2);
    const storage = await a.get(`/api/v1/workspaces/${workspace.id}/storage`).expect(200);
    expect(storage.body.reservedBytes).toBe(String(8 * GiB));

    // Room at ticket time, none left at complete time (the quota was lowered meanwhile).
    const other = await teacherSpace();
    const b = await agent(other.teacher);
    const ticket = await createTicket(b, other.workspace.id, {
      kind: 'PDF',
      filename: 'cours.pdf',
      mimeType: 'application/pdf',
      bytes: PDF_BYTES,
    });
    await db.workspace.update({
      where: { id: other.workspace.id },
      data: { storageQuotaBytes: 10n },
    });
    const etag = await putPart(ticket.parts[0]!.url, PDF_BYTES);
    const res = await b
      .post(mediaUrl(other.workspace.id, `/${ticket.mediaId}/complete`))
      .send({ parts: [{ partNumber: 1, etag }] })
      .expect(402);
    expect(res.body).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      details: {
        usedBytes: '0',
        reservedBytes: '0',
        quotaBytes: '10',
        requestedBytes: String(PDF_BYTES.length),
      },
    });
    const row = await asset(ticket.mediaId);
    expect(row).toMatchObject({
      status: 'FAILED',
      failureReason: 'QUOTA_EXCEEDED',
      countedBytes: 0n,
    });
    expect(await ctx.storage.head(row.storageKey!)).toBeNull();
    expect(await usedBytes(other.workspace.id)).toBe(0n);
    await expectQuotaInvariant(db, other.workspace.id);
    await expectQuotaInvariant(db, workspace.id);
    expect(ctx.queue.jobs).toEqual([]);
  });

  it('limits and mime: VIDEO over 4 GiB → 422; video/x-matroska on the s3 provider → 422; uploads need a verified teacher (TEACHER_NOT_VERIFIED); a student → 403', async () => {
    const { teacher, workspace } = await teacherSpace();
    const a = await agent(teacher);
    const post = (body: Record<string, unknown>) =>
      a.post(mediaUrl(workspace.id, '/uploads')).send({
        kind: 'VIDEO',
        filename: 'cours.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 1000,
        ...body,
      });

    const big = await post({ sizeBytes: 4 * GiB + 1 }).expect(422);
    expect(big.body.code).toBe('VALIDATION_FAILED');
    expect(big.body.details.issues[0].path).toEqual(['sizeBytes']);
    const mkv = await post({ mimeType: 'video/x-matroska', filename: 'cours.mkv' }).expect(422);
    expect(mkv.body.code).toBe('VALIDATION_FAILED');
    expect(mkv.body.details.issues[0].path).toEqual(['mimeType']);
    await post({ kind: 'PDF', mimeType: 'image/png' }).expect(422);
    await post({ kind: 'RECORDING' }).expect(422);
    await post({ kind: 'IMAGE', mimeType: 'image/png', sizeBytes: 5 * 1024 * 1024 + 1 }).expect(
      422,
    );

    const unverified = await createUser();
    const w2 = await createPersonalWorkspace(unverified);
    const u = await agent(unverified);
    await u
      .post(mediaUrl(w2.id, '/uploads'))
      .send({ kind: 'PDF', filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10 })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('TEACHER_NOT_VERIFIED'));

    const owner = await verifiedUser({ totpSecret: 'JBSWY3DPEHPK3PXP' });
    const student = await createUser();
    const { workspace: org } = await createOrganization({ owner, students: [student] });
    const s = await agent(student);
    await s
      .get(mediaUrl(org.id))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('PERMISSION_DENIED'));
    expect(await db.mediaAsset.count()).toBe(0);
  });

  it('delete: referenced by a lesson of a published course → 409 MEDIA_IN_USE with the lessons (AC-MED-08); unreferenced READY → DELETING + media.delete job; UPLOADING → removed at once', async () => {
    const { teacher, workspace } = await teacherSpace();
    const a = await agent(teacher);
    const used = await createMediaAsset(workspace, teacher, { kind: 'PDF' });
    const course = await createCourse(workspace, teacher, {
      status: 'PUBLISHED',
      title: 'Physique',
    });
    const module = await createModule(course);
    const lesson = await createLesson(module, {
      type: 'PDF',
      mediaAsset: used,
      title: 'Chapitre 1',
    });

    const detail = await a.get(mediaUrl(workspace.id, `/${used.id}`)).expect(200);
    expect(detail.body.usedBy).toEqual([
      {
        lessonId: lesson.id,
        lessonTitle: 'Chapitre 1',
        courseId: course.id,
        courseTitle: 'Physique',
        courseStatus: 'PUBLISHED',
      },
    ]);
    const conflict = await a.delete(mediaUrl(workspace.id, `/${used.id}`)).expect(409);
    expect(conflict.body).toMatchObject({
      code: 'MEDIA_IN_USE',
      details: {
        lessons: [{ lessonId: lesson.id, courseId: course.id, courseStatus: 'PUBLISHED' }],
      },
    });
    expect((await asset(used.id)).status).toBe('READY');

    const free = await createMediaAsset(workspace, teacher, { kind: 'IMAGE' });
    await a.delete(mediaUrl(workspace.id, `/${free.id}`)).expect(204);
    const deleting = await asset(free.id);
    expect(deleting.status).toBe('DELETING');
    expect(deleting.deletedAt).toBeInstanceOf(Date);
    expect(ctx.queue.jobs).toEqual([
      {
        queue: QUEUES.media,
        name: MEDIA_DELETE_JOB,
        data: { mediaId: free.id, workspaceId: workspace.id },
        opts: { jobId: mediaDeleteJobId(free.id) },
      },
    ]);
    // Idempotent: a second DELETE succeeds and re-enqueues under the same job id (BullMQ keeps
    // one live job per id), in case the first enqueue was lost.
    await a.delete(mediaUrl(workspace.id, `/${free.id}`)).expect(204);
    expect(ctx.queue.jobs.map((j) => j.opts?.jobId)).toEqual([
      mediaDeleteJobId(free.id),
      mediaDeleteJobId(free.id),
    ]);
    expect(await db.auditLog.count({ where: { action: 'media.deleted', entityId: free.id } })).toBe(
      1,
    );

    const ticket = await createTicket(a, workspace.id, {
      kind: 'VIDEO',
      filename: 'v.mp4',
      mimeType: 'video/mp4',
      bytes: MP4_BYTES,
    });
    const pending = await asset(ticket.mediaId);
    await a.delete(mediaUrl(workspace.id, `/${ticket.mediaId}`)).expect(204);
    expect(await db.mediaAsset.findUnique({ where: { id: ticket.mediaId } })).toBeNull();
    await expect(ctx.storage.listParts(pending.storageKey!, pending.uploadId!)).rejects.toThrow();
    const storage = await a.get(`/api/v1/workspaces/${workspace.id}/storage`).expect(200);
    expect(storage.body.reservedBytes).toBe('0');
    await a.get(mediaUrl(workspace.id, `/${ticket.mediaId}`)).expect(404);
  });

  it('list and scope: newest first, kind/status filters, cursor; another teacher of the organisation sees none of them (404)', async () => {
    const owner = await verifiedUser({ totpSecret: 'JBSWY3DPEHPK3PXP' });
    const t1 = await verifiedUser();
    const t2 = await verifiedUser();
    const { workspace } = await createOrganization({ owner, teachers: [t1, t2] });
    const pdf = await createMediaAsset(workspace, t1, { kind: 'PDF' });
    const image = await createMediaAsset(workspace, t1, { kind: 'IMAGE' });
    const failed = await createMediaAsset(workspace, t1, { kind: 'VIDEO', status: 'FAILED' });
    const mine = await createMediaAsset(workspace, t2, { kind: 'PDF' });

    const a = await agent(t1);
    const all = await a.get(mediaUrl(workspace.id)).expect(200);
    expect(all.body.items.map((m: { id: string }) => m.id)).toEqual([failed.id, image.id, pdf.id]);
    expect(all.body.nextCursor).toBeNull();
    const pdfs = await a.get(mediaUrl(workspace.id)).query({ kind: 'PDF' }).expect(200);
    expect(pdfs.body.items.map((m: { id: string }) => m.id)).toEqual([pdf.id]);
    const ready = await a.get(mediaUrl(workspace.id)).query({ status: 'READY' }).expect(200);
    expect(ready.body.items).toHaveLength(2);
    const page = await a.get(mediaUrl(workspace.id)).query({ limit: 2 }).expect(200);
    expect(page.body.nextCursor).toBe(image.id);
    const next = await a
      .get(mediaUrl(workspace.id))
      .query({ limit: 2, cursor: page.body.nextCursor })
      .expect(200);
    expect(next.body.items.map((m: { id: string }) => m.id)).toEqual([pdf.id]);
    await a
      .get(mediaUrl(workspace.id))
      .query({ cursor: mine.id })
      .expect(422)
      .expect(({ body }) => expect(body.details.issues[0].path).toEqual(['cursor']));

    const b = await agent(t2);
    await b.get(mediaUrl(workspace.id, `/${pdf.id}`)).expect(404);
    await b.delete(mediaUrl(workspace.id, `/${pdf.id}`)).expect(404);
    await b.get(mediaUrl(workspace.id, `/${pdf.id}/playback`)).expect(404);
    const theirs = await b.get(mediaUrl(workspace.id)).expect(200);
    expect(theirs.body.items.map((m: { id: string }) => m.id)).toEqual([mine.id]);
  });
});

describe('media uploads — tus mode on a Cloudflare-like provider (SP3 T7)', () => {
  let ctx: TestContext;
  const fake = new FakeVideoProvider();

  beforeAll(async () => {
    ctx = await createTestApp({
      overrides: (b) => b.overrideProvider(VIDEO_PROVIDER_TOKEN).useValue(fake),
    });
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    fake.uploads.length = 0;
  });

  it('TUS mode with FakeVideoProvider: the ticket carries uploadUrl and the asset stores providerAssetId; complete is a no-op', async () => {
    const teacher = await verifiedUser();
    const workspace = await createPersonalWorkspace(teacher);
    const a = as(ctx.http, (await loginAs(ctx, teacher)).cookie);
    // Cloudflare transcodes: its wider list accepts Matroska.
    const res = await a
      .post(mediaUrl(workspace.id, '/uploads'))
      .send({
        kind: 'VIDEO',
        filename: 'cours.mkv',
        mimeType: 'video/x-matroska',
        sizeBytes: 50_000_000,
      })
      .expect(201);
    expect(res.body).toEqual({
      mode: 'TUS',
      mediaId: expect.any(String),
      uploadUrl: `https://video.test/tus/${res.body.mediaId}`,
      expiresAt: expect.any(String),
    });
    expect(fake.uploads).toHaveLength(1);
    const upload = fake.uploads[0]!;
    if (upload.mode !== 'TUS') throw new Error('expected a tus upload');
    const row = await ctx.db.mediaAsset.findUniqueOrThrow({ where: { id: res.body.mediaId } });
    expect(row).toMatchObject({
      provider: 'CLOUDFLARE_STREAM',
      providerAssetId: upload.providerAssetId,
      storageKey: null,
      uploadId: null,
      status: 'UPLOADING',
    });

    for (let i = 0; i < 2; i += 1) {
      const done = await a
        .post(mediaUrl(workspace.id, `/${row.id}/complete`))
        .send({})
        .expect(200);
      expect(done.body).toMatchObject({ id: row.id, status: 'UPLOADING' });
    }
    await a
      .get(mediaUrl(workspace.id, `/${row.id}/upload`))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('UPLOAD_NOT_PENDING'));
    expect(ctx.queue.jobs).toEqual([]);

    // A PDF still goes through S3 multipart.
    const pdf = await createTicket(a, workspace.id, {
      kind: 'PDF',
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      bytes: PDF_BYTES,
    });
    expect(pdf.mode).toBe('S3_MULTIPART');
  });
});
