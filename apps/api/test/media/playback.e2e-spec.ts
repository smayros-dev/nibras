import { INLINE_URL_TTL_S, PLAYBACK_TOKENS_PER_HOUR, PLAYBACK_TTL_S } from '@nibras/contracts';
import type { PrismaClient, User } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createMediaAsset, createPersonalWorkspace, createUser } from '../helpers/factories';
import { mediaUrl, uploadThroughApi } from '../helpers/media';
import { MP4_BYTES, PDF_BYTES } from './fixtures';

const verifiedUser = () =>
  createUser({ phoneVerified: true, consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'] });

describe('media playback and download — teacher side (SP3 T7, D-O8)', () => {
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
  /** The worker's job (T8): the processed asset turns READY. */
  const markReady = (id: string) =>
    db.mediaAsset.update({ where: { id }, data: { status: 'READY', readyAt: new Date() } });
  const expiresIn = (iso: string) => (new Date(iso).getTime() - Date.now()) / 1000;

  it('teacher playback: PDF inline URL 5 min, MP4 presigned 2 h on the s3 provider; download attachment; not READY → 409; no presigned URL in the logs', async () => {
    const teacher = await verifiedUser();
    const workspace = await createPersonalWorkspace(teacher);
    const a = await agent(teacher);

    const pdf = await uploadThroughApi(a, workspace.id, {
      kind: 'PDF',
      filename: 'Chapitre 1.pdf',
      mimeType: 'application/pdf',
      bytes: PDF_BYTES,
    });
    expect(pdf.complete.status).toBe(200);
    // PROCESSING: nothing to play yet.
    await a
      .get(mediaUrl(workspace.id, `/${pdf.mediaId}/playback`))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('MEDIA_NOT_READY'));
    await markReady(pdf.mediaId);

    const inline = await a.get(mediaUrl(workspace.id, `/${pdf.mediaId}/playback`)).expect(200);
    expect(inline.body).toMatchObject({ kind: 'PDF', allowDownload: true });
    expect(inline.body.url).toContain(`X-Amz-Expires=${INLINE_URL_TTL_S}`);
    expect(expiresIn(inline.body.expiresAt)).toBeGreaterThan(INLINE_URL_TTL_S - 10);
    expect(expiresIn(inline.body.expiresAt)).toBeLessThanOrEqual(INLINE_URL_TTL_S);
    let file = await fetch(inline.body.url);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toMatch(/^inline/);
    expect(file.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await file.arrayBuffer()).equals(PDF_BYTES)).toBe(true);

    const download = await a.get(mediaUrl(workspace.id, `/${pdf.mediaId}/download`)).expect(200);
    expect(download.body).toMatchObject({ filename: 'Chapitre 1.pdf' });
    expect(expiresIn(download.body.expiresAt)).toBeLessThanOrEqual(INLINE_URL_TTL_S);
    file = await fetch(download.body.url);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toMatch(/^attachment; filename=/);

    const video = await uploadThroughApi(a, workspace.id, {
      kind: 'VIDEO',
      filename: 'cours.mp4',
      mimeType: 'video/mp4',
      bytes: MP4_BYTES,
    });
    expect(video.complete.status).toBe(200);
    await markReady(video.mediaId);
    const mp4 = await a.get(mediaUrl(workspace.id, `/${video.mediaId}/playback`)).expect(200);
    expect(mp4.body.kind).toBe('MP4');
    expect(mp4.body.url).toContain(`X-Amz-Expires=${PLAYBACK_TTL_S}`);
    expect(expiresIn(mp4.body.expiresAt)).toBeGreaterThan(PLAYBACK_TTL_S - 10);
    expect(expiresIn(mp4.body.expiresAt)).toBeLessThanOrEqual(PLAYBACK_TTL_S);
    file = await fetch(mp4.body.url);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('video/mp4');
    // Download is a PDF-only action; an image has no playback.
    await a
      .get(mediaUrl(workspace.id, `/${video.mediaId}/download`))
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('MEDIA_KIND_MISMATCH'));
    const image = await createMediaAsset(workspace, teacher, { kind: 'IMAGE' });
    await a.get(mediaUrl(workspace.id, `/${image.id}/playback`)).expect(422);

    // Issuance is logged with ids only (D13), never the URL (bearer secret).
    const issued = ctx.logs.lines().filter((l) => l.msg === 'media.playback_issued');
    expect(issued).toHaveLength(2);
    expect(issued[0]).toMatchObject({
      mediaId: pdf.mediaId,
      userId: teacher.id,
      workspaceId: workspace.id,
      kind: 'PDF',
      expiresAt: inline.body.expiresAt,
    });
    const logs = JSON.stringify(ctx.logs.lines());
    expect(logs).not.toContain('X-Amz-Signature');
    expect(logs).not.toContain(inline.body.url);
    expect(
      await db.auditLog.count({
        where: { entityId: pdf.mediaId, action: { contains: 'playback' } },
      }),
    ).toBe(0);
  });

  it(`the ${PLAYBACK_TOKENS_PER_HOUR + 1}st token in an hour → 429 RATE_LIMITED and a warn log`, async () => {
    const teacher = await verifiedUser();
    const workspace = await createPersonalWorkspace(teacher);
    const pdf = await createMediaAsset(workspace, teacher, { kind: 'PDF' });
    const a = await agent(teacher);
    const url = mediaUrl(workspace.id, `/${pdf.id}/playback`);
    for (let i = 0; i < PLAYBACK_TOKENS_PER_HOUR; i += 1) await a.get(url).expect(200);
    const res = await a.get(url).expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(res.body.details.retryAfterS).toBeGreaterThan(3500);
    const warn = ctx.logs.lines().filter((l) => l.msg === 'media.playback_rate_exceeded');
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatchObject({ level: 40, userId: teacher.id, mediaId: pdf.id });
    expect(ctx.logs.lines().filter((l) => l.msg === 'media.playback_issued')).toHaveLength(
      PLAYBACK_TOKENS_PER_HOUR,
    );
    expect(JSON.stringify(ctx.logs.lines())).not.toContain('X-Amz-Signature');
  });
});
