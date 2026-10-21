import type { Course, Module, PrismaClient, User, Workspace } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { expectStructureInvariant } from '../helpers/invariants';

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const image = (mediaId: string) => ({ type: 'image', attrs: { mediaId, alt: 'Figure' } });

describe('structure: lessons — typed content, media rules, rich text (SP3 T6)', () => {
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
  const ws = (wid: string, path: string) => `/api/v1/workspaces/${wid}${path}`;
  const version = async (cid: string) =>
    (await db.course.findUniqueOrThrow({ where: { id: cid } })).version;

  async function setup(): Promise<{
    teacher: User;
    workspace: Workspace;
    course: Course;
    module: Module;
  }> {
    const teacher = await createUser();
    const workspace = await createPersonalWorkspace(teacher);
    const course = await createCourse(workspace, teacher);
    const module = await createModule(course);
    return { teacher, workspace, course, module };
  }

  it("VIDEO/PDF need a media of the right kind and workspace: wrong kind → 422 MEDIA_KIND_MISMATCH, FAILED media → 409 MEDIA_NOT_READY, PROCESSING accepted, B's media → 404 (Review Focus 5)", async () => {
    const { teacher, workspace, course, module } = await setup();
    const other = await createUser();
    const otherWs = await createPersonalWorkspace(other);
    const foreignVideo = await createMediaAsset(otherWs, other, { kind: 'VIDEO' });
    const pdf = await createMediaAsset(workspace, teacher, { kind: 'PDF' });
    const failed = await createMediaAsset(workspace, teacher, { kind: 'VIDEO', status: 'FAILED' });
    const uploading = await createMediaAsset(workspace, teacher, {
      kind: 'VIDEO',
      status: 'UPLOADING',
    });
    const processing = await createMediaAsset(workspace, teacher, {
      kind: 'VIDEO',
      status: 'PROCESSING',
    });
    const deleted = await createMediaAsset(workspace, teacher, { kind: 'VIDEO' });
    await db.mediaAsset.update({
      where: { id: deleted.id },
      data: { deletedAt: new Date(), status: 'DELETING' },
    });
    const a = await agent(teacher);
    const url = ws(workspace.id, `/modules/${module.id}/lessons`);
    const video = (mediaAssetId: string) => ({ type: 'VIDEO', title: 'Vidéo', mediaAssetId });

    await a
      .post(url)
      .send(video(pdf.id))
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('MEDIA_KIND_MISMATCH'));
    await a
      .post(url)
      .send({ type: 'PDF', title: 'PDF', mediaAssetId: processing.id })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('MEDIA_KIND_MISMATCH'));
    for (const m of [failed, uploading]) {
      await a
        .post(url)
        .send(video(m.id))
        .expect(409)
        .expect(({ body }) => expect(body.code).toBe('MEDIA_NOT_READY'));
    }
    for (const id of [foreignVideo.id, deleted.id, '0190a0a0-0000-7000-8000-000000000000']) {
      await a
        .post(url)
        .send(video(id))
        .expect(404)
        .expect(({ body }) => expect(body.code).toBe('NOT_FOUND'));
    }
    expect(await db.lesson.count()).toBe(0);
    expect(await version(course.id)).toBe(1);

    const res = await a.post(url).send(video(processing.id)).expect(201).expect('ETag', '"2"');
    expect(res.body).toMatchObject({
      moduleId: module.id,
      type: 'VIDEO',
      title: 'Vidéo',
      position: 1,
      isRequired: true,
      allowDownload: false,
      mediaAssetId: processing.id,
      media: { id: processing.id, kind: 'VIDEO', status: 'PROCESSING', failureReason: null },
      hasContent: false,
      content: null,
      images: {},
      version: 1,
    });
    expect((await db.module.findUniqueOrThrow({ where: { id: module.id } })).version).toBe(2);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'lesson.created' } });
    expect(audit).toMatchObject({ entityType: 'Lesson', entityId: res.body.id });
    expect(audit.after).toMatchObject({
      type: 'VIDEO',
      moduleId: module.id,
      mediaAssetId: processing.id,
    });

    // PATCH to another workspace's media → 404, untouched.
    await a
      .patch(ws(workspace.id, `/lessons/${res.body.id}`))
      .set('If-Match', '"2"')
      .send({ mediaAssetId: foreignVideo.id })
      .expect(404);
    expect((await db.lesson.findUniqueOrThrow({ where: { id: res.body.id } })).mediaAssetId).toBe(
      processing.id,
    );
    await expectStructureInvariant(db, course.id);
  });

  it('scope own: an org TEACHER uses only his own uploads; the organisation OWNER (scope all) sees and uses everything', async () => {
    const S = 'JBSWY3DPEHPK3PXP';
    const owner = await createUser({ totpSecret: S });
    const teacher = await createUser();
    const teacher2 = await createUser();
    const { workspace } = await createOrganization({ owner, teachers: [teacher, teacher2] });
    const course = await createCourse(workspace, teacher);
    const module = await createModule(course);
    const mine = await createMediaAsset(workspace, teacher, { kind: 'PDF' });
    const theirs = await createMediaAsset(workspace, teacher2, { kind: 'PDF' });
    const a = await agent(teacher);
    const url = ws(workspace.id, `/modules/${module.id}/lessons`);

    await a.post(url).send({ type: 'PDF', title: 'Leur PDF', mediaAssetId: theirs.id }).expect(404);
    const created = await a
      .post(url)
      .send({ type: 'PDF', title: 'Mon PDF', mediaAssetId: mine.id })
      .expect(201);

    // Another teacher's course is not found, nor its module or lessons.
    const b = await agent(teacher2);
    await b.get(ws(workspace.id, `/lessons/${created.body.id}`)).expect(404);
    await b.post(url).send({ type: 'PDF', title: 'X', mediaAssetId: theirs.id }).expect(404);
    await b.get(ws(workspace.id, `/courses/${course.id}/structure`)).expect(404);
    // The organisation OWNER (scope `all`) reads it and may attach any media of the workspace.
    const o = await agent(owner);
    await o.get(ws(workspace.id, `/lessons/${created.body.id}`)).expect(200);
    await o.post(url).send({ type: 'PDF', title: 'Leur PDF', mediaAssetId: theirs.id }).expect(201);
    await expectStructureInvariant(db, course.id);
  });

  it('TEXT content: whitelist refuses an iframe node and a javascript: link; images must be READY IMAGE assets of the workspace; the detail returns images as presigned URLs', async () => {
    const { teacher, workspace, course, module } = await setup();
    const other = await createUser();
    const otherWs = await createPersonalWorkspace(other);
    const foreignImage = await createMediaAsset(otherWs, other, { kind: 'IMAGE' });
    const img = await createMediaAsset(workspace, teacher, { kind: 'IMAGE' });
    const pendingImg = await createMediaAsset(workspace, teacher, {
      kind: 'IMAGE',
      status: 'PROCESSING',
    });
    const pdf = await createMediaAsset(workspace, teacher, { kind: 'PDF' });
    const a = await agent(teacher);
    const url = ws(workspace.id, `/modules/${module.id}/lessons`);
    const text = (content: unknown) => ({ type: 'TEXT', title: 'Texte', content });

    await a
      .post(url)
      .send(text(doc({ type: 'iframe', attrs: { src: 'https://evil.example' } })))
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
    const jsLink = {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'clic',
          marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
        },
      ],
    };
    await a
      .post(url)
      .send(text(doc(jsLink)))
      .expect(422);
    // An image given by URL instead of a media id.
    await a
      .post(url)
      .send(text(doc({ type: 'image', attrs: { src: 'https://evil.example/x.png' } })))
      .expect(422);
    // A TEXT lesson takes no media.
    await a
      .post(url)
      .send({ ...text(doc(para('a'))), mediaAssetId: img.id })
      .expect(422);

    for (const id of [foreignImage.id, pendingImg.id, pdf.id]) {
      const res = await a
        .post(url)
        .send(text(doc(para('Voir :'), image(id))))
        .expect(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details.issues[0].path).toEqual(['content']);
      expect(JSON.stringify(res.body)).not.toContain(foreignImage.id);
    }
    expect(await db.lesson.count()).toBe(0);

    const content = doc(para('Voir :'), image(img.id));
    const created = await a.post(url).send(text(content)).expect(201);
    expect(created.body).toMatchObject({
      type: 'TEXT',
      content,
      hasContent: true,
      media: null,
      mediaAssetId: null,
    });
    expect(Object.keys(created.body.images)).toEqual([img.id]);
    expect(created.body.images[img.id]).toMatch(/X-Amz-Signature=/);
    expect(created.body.images[img.id]).toContain(img.storageKey!);
    // The rich text is named, not copied, in the audit row.
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'lesson.created' } });
    expect(JSON.stringify(audit.after)).not.toContain('Voir');

    const detail = await a
      .get(ws(workspace.id, `/lessons/${created.body.id}`))
      .expect(200)
      .expect('ETag', '"2"');
    expect(detail.body.content).toEqual(content);
    expect(detail.body.images[img.id]).toMatch(/X-Amz-Signature=/);

    // PATCH: the new content is checked the same way.
    await a
      .patch(ws(workspace.id, `/lessons/${created.body.id}`))
      .set('If-Match', '"2"')
      .send({ content: doc(image(foreignImage.id)) })
      .expect(422);
    const updated = await a
      .patch(ws(workspace.id, `/lessons/${created.body.id}`))
      .set('If-Match', '"2"')
      .send({ content: doc(para('Nouveau texte')), title: 'Texte 2' })
      .expect(200)
      .expect('ETag', '"3"');
    expect(updated.body).toMatchObject({ title: 'Texte 2', images: {}, version: 2 });
    const upd = await db.auditLog.findFirstOrThrow({ where: { action: 'lesson.updated' } });
    expect(upd.before).toMatchObject({ title: 'Texte', content: '[rich text]' });
    expect(upd.after).toMatchObject({ title: 'Texte 2', content: '[rich text]' });
    await expectStructureInvariant(db, course.id);
  });

  it('PDF allowDownload defaults from workspace settings; type is immutable (422); fields foreign to the type → 422; delete renumbers and keeps the media', async () => {
    const { teacher, workspace, course, module } = await setup();
    const pdf = await createMediaAsset(workspace, teacher, { kind: 'PDF' });
    const pdf2 = await createMediaAsset(workspace, teacher, { kind: 'PDF' });
    const video = await createMediaAsset(workspace, teacher, { kind: 'VIDEO' });
    const a = await agent(teacher);
    const url = ws(workspace.id, `/modules/${module.id}/lessons`);

    const off = await a
      .post(url)
      .send({ type: 'PDF', title: 'PDF 1', mediaAssetId: pdf.id })
      .expect(201);
    expect(off.body.allowDownload).toBe(false);
    await db.workspace.update({
      where: { id: workspace.id },
      data: {
        settings: {
          ...(workspace.settings as Record<string, unknown>),
          default_pdf_download: true,
        },
      },
    });
    const on = await a
      .post(url)
      .send({ type: 'PDF', title: 'PDF 2', mediaAssetId: pdf.id })
      .expect(201);
    expect(on.body.allowDownload).toBe(true);
    const explicit = await a
      .post(url)
      .send({ type: 'PDF', title: 'PDF 3', mediaAssetId: pdf2.id, allowDownload: false })
      .expect(201);
    expect(explicit.body.allowDownload).toBe(false);
    const vid = await a
      .post(url)
      .send({ type: 'VIDEO', title: 'Vidéo', mediaAssetId: video.id })
      .expect(201);
    expect(vid.body.allowDownload).toBe(false);
    let v = await version(course.id);
    expect(v).toBe(5);

    const lesson = (id: string) => ws(workspace.id, `/lessons/${id}`);
    await a.patch(lesson(on.body.id)).set('If-Match', `"${v}"`).send({ type: 'VIDEO' }).expect(422);
    await a
      .patch(lesson(vid.body.id))
      .set('If-Match', `"${v}"`)
      .send({ allowDownload: true })
      .expect(422)
      .expect(({ body }) => expect(body.details.issues[0].path).toEqual(['allowDownload']));
    await a
      .patch(lesson(vid.body.id))
      .set('If-Match', `"${v}"`)
      .send({ content: doc(para('x')) })
      .expect(422)
      .expect(({ body }) => expect(body.details.issues[0].path).toEqual(['content']));
    await a
      .patch(lesson(on.body.id))
      .set('If-Match', `"${v}"`)
      .send({ mediaAssetId: video.id })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('MEDIA_KIND_MISMATCH'));
    await a.patch(lesson(on.body.id)).send({ allowDownload: false }).expect(428);
    await a
      .patch(lesson(on.body.id))
      .set('If-Match', `"${v - 1}"`)
      .send({ allowDownload: false })
      .expect(409);
    expect(await version(course.id)).toBe(v);

    const patched = await a
      .patch(lesson(on.body.id))
      .set('If-Match', `"${v}"`)
      .send({ allowDownload: false, mediaAssetId: pdf2.id, isRequired: false })
      .expect(200)
      .expect('ETag', `"${v + 1}"`);
    expect(patched.body).toMatchObject({
      allowDownload: false,
      mediaAssetId: pdf2.id,
      isRequired: false,
      version: 2,
    });
    v += 1;

    // DELETE renumbers the module's lessons; the media rows stay.
    await a
      .delete(lesson(off.body.id))
      .expect(204)
      .expect('ETag', `"${v + 1}"`);
    const rows = await db.lesson.findMany({
      where: { moduleId: module.id },
      orderBy: { position: 'asc' },
    });
    expect(rows.map((r) => [r.id, r.position])).toEqual([
      [on.body.id, 1],
      [explicit.body.id, 2],
      [vid.body.id, 3],
    ]);
    expect(await db.mediaAsset.count({ where: { id: pdf.id, deletedAt: null } })).toBe(1);
    // A stale If-Match on DELETE is a conflict.
    await a.delete(lesson(vid.body.id)).set('If-Match', `"${v}"`).expect(409);
    const del = await db.auditLog.findFirstOrThrow({ where: { action: 'lesson.deleted' } });
    expect(del).toMatchObject({ entityType: 'Lesson', entityId: off.body.id });
    await a.get(lesson(off.body.id)).expect(404);
    await expectStructureInvariant(db, course.id);
  });

  it('a deleted course hides its lessons; structure lists media statuses', async () => {
    const { teacher, workspace, course, module } = await setup();
    const failed = await createMediaAsset(workspace, teacher, { kind: 'VIDEO', status: 'FAILED' });
    await db.mediaAsset.update({
      where: { id: failed.id },
      data: { failureReason: 'INVALID_SIGNATURE' },
    });
    const l = await createLesson(module, { type: 'VIDEO', mediaAsset: failed });
    const a = await agent(teacher);
    const res = await a.get(ws(workspace.id, `/courses/${course.id}/structure`)).expect(200);
    expect(res.body).toMatchObject({
      courseId: course.id,
      version: 1,
      status: 'DRAFT',
      sequentialLessons: false,
      modules: [
        {
          id: module.id,
          position: 1,
          unlockRule: { type: 'NONE' },
          lessons: [
            {
              id: l.id,
              type: 'VIDEO',
              media: { id: failed.id, status: 'FAILED', failureReason: 'INVALID_SIGNATURE' },
            },
          ],
        },
      ],
    });
    await db.course.update({ where: { id: course.id }, data: { deletedAt: new Date() } });
    await a.get(ws(workspace.id, `/lessons/${l.id}`)).expect(404);
    await a.get(ws(workspace.id, `/courses/${course.id}/structure`)).expect(404);
    await a
      .post(ws(workspace.id, `/modules/${module.id}/lessons`))
      .send({ type: 'TEXT', title: 'X', content: doc(para('x')) })
      .expect(404);
  });
});
