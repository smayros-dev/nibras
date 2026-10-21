import { INLINE_URL_TTL_S, PLAYBACK_TOKENS_PER_HOUR, PLAYBACK_TTL_S } from '@nibras/contracts';
import type { PrismaClient } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestContext } from '../helpers/app';
import {
  addMember,
  createCourse,
  createEnrollment,
  createLesson,
  createMediaAsset,
  createModule,
  createPersonalWorkspace,
  createStudent,
  createUser,
} from '../helpers/factories';
import { agentOf, meCourses, meLesson, textCourse } from './helpers';

describe('learn — lesson access, playback and download (SP3 T10, §4.6, Review Focus 7)', () => {
  let ctx: TestContext;
  let db: PrismaClient;

  beforeAll(async () => {
    ctx = await createTestApp();
    ({ db } = ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  const expiresIn = (iso: string) => (new Date(iso).getTime() - Date.now()) / 1000;

  it('not enrolled → 404; REVOKED → 403 ENROLLMENT_REVOKED; DRAFT or unpublished course → 403 COURSE_NOT_AVAILABLE and gone from /me/courses, enrollment and progress untouched (Review Focus 7, AC-CRS-02); consent-pending membership → 403 GUARDIAN_CONSENT_REQUIRED; a lesson of another workspace where the user is not enrolled → 404', async () => {
    const teacher = await createUser();
    const workspace = await createPersonalWorkspace(teacher);
    const { user: student } = await createStudent({ workspace });
    const a = await agentOf(ctx, student);
    const { course, lessons } = await textCourse(workspace, teacher, { lessons: 2 });
    const [l1] = lessons;

    // Not enrolled: the course and its lessons do not exist for him.
    await a.get(meCourses(`/${course.id}`)).expect(404);
    await a.get(meLesson(l1!.id)).expect(404);
    await a.post(meLesson(l1!.id, '/opened')).expect(404);
    await a.get(meCourses('/not-a-uuid')).expect(404);
    await a.get(meLesson('not-a-uuid')).expect(404);

    const enrollment = await createEnrollment(course, student);
    await a.get(meCourses(`/${course.id}`)).expect(200);
    await a.get(meLesson(l1!.id)).expect(200);
    await a.post(meLesson(l1!.id, '/complete')).expect(200);
    const before = await db.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    expect(before.progressPercent).toBe(50);

    // Unpublished (DRAFT again): refused everywhere, nothing touched.
    await db.course.update({ where: { id: course.id }, data: { status: 'DRAFT' } });
    for (const url of [
      meCourses(`/${course.id}`),
      meLesson(l1!.id),
      meLesson(l1!.id, '/playback'),
      meLesson(l1!.id, '/download'),
    ]) {
      await a
        .get(url)
        .expect(403)
        .expect(({ body }) => expect(body.code).toBe('COURSE_NOT_AVAILABLE'));
    }
    await a
      .post(meLesson(l1!.id, '/uncomplete'))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('COURSE_NOT_AVAILABLE'));
    expect((await a.get(meCourses()).expect(200)).body.items).toEqual([]);
    const after = await db.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    expect(after).toEqual(before);
    expect(
      await db.lessonProgress.findFirstOrThrow({
        where: { lessonId: l1!.id, studentUserId: student.id },
      }),
    ).toMatchObject({ status: 'COMPLETED' });

    // Soft-deleted: same answer.
    await db.course.update({
      where: { id: course.id },
      data: { status: 'ARCHIVED', deletedAt: new Date() },
    });
    await a
      .get(meLesson(l1!.id))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('COURSE_NOT_AVAILABLE'));

    // Revoked enrollment.
    const other = await textCourse(workspace, teacher);
    await createEnrollment(other.course, student, { status: 'REVOKED' });
    await a
      .get(meCourses(`/${other.course.id}`))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('ENROLLMENT_REVOKED'));
    await a
      .post(meLesson(other.lessons[0]!.id, '/opened'))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('ENROLLMENT_REVOKED'));

    // A minor waiting for the guardian's consent.
    const { user: minor } = await createStudent({
      workspace,
      minor: true,
      status: 'PENDING_GUARDIAN_CONSENT',
    });
    const m = await agentOf(ctx, minor);
    const third = await textCourse(workspace, teacher, { student: minor });
    await m
      .get(meLesson(third.lessons[0]!.id))
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe('GUARDIAN_CONSENT_REQUIRED');
        expect(body.details).toMatchObject({ status: 'PENDING_GUARDIAN_CONSENT' });
      });
    await m.post(meLesson(third.lessons[0]!.id, '/complete')).expect(403);
    expect((await m.get(meCourses()).expect(200)).body.items).toEqual([]);

    // A PENDING_APPROVAL membership.
    const { user: pending } = await createStudent({ workspace, status: 'PENDING_APPROVAL' });
    const fourth = await textCourse(workspace, teacher, { student: pending });
    await (
      await agentOf(ctx, pending)
    )
      .get(meCourses(`/${fourth.course.id}`))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('MEMBERSHIP_INACTIVE'));
  });

  it('cross-workspace: a lesson or course of workspace B is 404 for a student of A, even as a member of B; his enrollment in A never opens B', async () => {
    const teacherA = await createUser();
    const a = await createPersonalWorkspace(teacherA);
    const teacherB = await createUser();
    const b = await createPersonalWorkspace(teacherB);
    const { user: student } = await createStudent({ workspace: a });
    const inA = await textCourse(a, teacherA, { student });
    const inB = await textCourse(b, teacherB);
    const pdfB = await createMediaAsset(b, teacherB, { kind: 'PDF' });
    const pdfLessonB = await createLesson(inB.module, { type: 'PDF', mediaAsset: pdfB });
    const s = await agentOf(ctx, student);

    const probe = async () => {
      await s.get(meCourses(`/${inB.course.id}`)).expect(404);
      for (const lid of [inB.lessons[0]!.id, pdfLessonB.id]) {
        await s.get(meLesson(lid)).expect(404);
        await s.get(meLesson(lid, '/playback')).expect(404);
        await s.get(meLesson(lid, '/download')).expect(404);
        for (const action of ['opened', 'complete', 'uncomplete']) {
          await s.post(meLesson(lid, `/${action}`)).expect(404);
        }
      }
    };
    await probe();
    // Also a member of B, still not enrolled there.
    await addMember(b, student, 'STUDENT');
    await probe();

    const items = (await s.get(meCourses()).expect(200)).body.items as { course: { id: string } }[];
    expect(items.map((i) => i.course.id)).toEqual([inA.course.id]);
    expect(await db.lessonProgress.count({ where: { workspaceId: b.id } })).toBe(0);
    expect(await db.enrollment.count({ where: { workspaceId: b.id } })).toBe(0);
  });

  it('playback: enrolled student gets a 2 h MP4/HLS grant for a video and a 5 min inline URL for a PDF; download refused unless allowDownload (AC-MED-05 issuance side, AC-MED-06); PROCESSING → playback null and 409 MEDIA_NOT_READY; TEXT images signed', async () => {
    const teacher = await createUser();
    const workspace = await createPersonalWorkspace(teacher);
    const { user: student } = await createStudent({ workspace });
    const course = await createCourse(workspace, teacher, { status: 'PUBLISHED' });
    const module = await createModule(course);
    const video = await createMediaAsset(workspace, teacher, { kind: 'VIDEO', durationS: 600 });
    const pdf = await createMediaAsset(workspace, teacher, { kind: 'PDF' });
    const processing = await createMediaAsset(workspace, teacher, {
      kind: 'VIDEO',
      status: 'PROCESSING',
    });
    const image = await createMediaAsset(workspace, teacher, { kind: 'IMAGE' });
    const videoLesson = await createLesson(module, { type: 'VIDEO', mediaAsset: video });
    const pdfLesson = await createLesson(module, { type: 'PDF', mediaAsset: pdf });
    const pendingLesson = await createLesson(module, { type: 'VIDEO', mediaAsset: processing });
    const textLesson = await createLesson(module, {
      type: 'TEXT',
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Figure' }] },
          { type: 'image', attrs: { mediaId: image.id, alt: 'Figure' } },
        ],
      },
    });
    await createEnrollment(course, student);
    const s = await agentOf(ctx, student);

    const detail = await s.get(meLesson(videoLesson.id)).expect(200);
    expect(detail.body).toMatchObject({
      lesson: { id: videoLesson.id, type: 'VIDEO', media: { status: 'READY', durationS: 600 } },
      course: { id: course.id, title: course.title },
      module: { id: module.id },
      content: null,
      previous: null,
      next: { lessonId: pdfLesson.id },
    });
    expect(detail.body.playback.kind).toBe('MP4');
    expect(expiresIn(detail.body.playback.expiresAt)).toBeGreaterThan(PLAYBACK_TTL_S - 10);
    const refresh = await s.get(meLesson(videoLesson.id, '/playback')).expect(200);
    expect(refresh.body.url).toContain(`X-Amz-Expires=${PLAYBACK_TTL_S}`);
    await s
      .get(meLesson(videoLesson.id, '/download'))
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('MEDIA_KIND_MISMATCH'));

    const pdfGrant = await s.get(meLesson(pdfLesson.id, '/playback')).expect(200);
    expect(pdfGrant.body).toMatchObject({ kind: 'PDF', allowDownload: false });
    expect(pdfGrant.body.url).toContain(`X-Amz-Expires=${INLINE_URL_TTL_S}`);
    expect(expiresIn(pdfGrant.body.expiresAt)).toBeLessThanOrEqual(INLINE_URL_TTL_S);
    await s
      .get(meLesson(pdfLesson.id, '/download'))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('DOWNLOAD_NOT_ALLOWED'));
    await db.lesson.update({ where: { id: pdfLesson.id }, data: { allowDownload: true } });
    const download = await s.get(meLesson(pdfLesson.id, '/download')).expect(200);
    expect(download.body).toMatchObject({ filename: pdf.originalFilename });
    expect(download.body.url).toContain('attachment');

    const pending = await s.get(meLesson(pendingLesson.id)).expect(200);
    expect(pending.body.playback).toBeNull();
    expect(pending.body.lesson.media.status).toBe('PROCESSING');
    await s
      .get(meLesson(pendingLesson.id, '/playback'))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('MEDIA_NOT_READY'));
    await s
      .post(meLesson(pendingLesson.id, '/opened'))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('MEDIA_NOT_READY'));

    const text = await s.get(meLesson(textLesson.id)).expect(200);
    expect(text.body.playback).toBeNull();
    expect(text.body.content.type).toBe('doc');
    expect(Object.keys(text.body.images)).toEqual([image.id]);
    expect(text.body.next).toBeNull();
    await s
      .get(meLesson(textLesson.id, '/playback'))
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('MEDIA_KIND_MISMATCH'));

    // Issuance is logged with ids only, never the URL.
    expect(JSON.stringify(ctx.logs.lines())).not.toContain('X-Amz-Signature');
  });

  it(`the ${PLAYBACK_TOKENS_PER_HOUR + 1}st playback request in an hour → 429 RATE_LIMITED`, async () => {
    const teacher = await createUser();
    const workspace = await createPersonalWorkspace(teacher);
    const { user: student } = await createStudent({ workspace });
    const course = await createCourse(workspace, teacher, { status: 'PUBLISHED' });
    const module = await createModule(course);
    const pdf = await createMediaAsset(workspace, teacher, { kind: 'PDF' });
    const lesson = await createLesson(module, { type: 'PDF', mediaAsset: pdf });
    await createEnrollment(course, student);
    const s = await agentOf(ctx, student);
    for (let i = 0; i < PLAYBACK_TOKENS_PER_HOUR; i += 1) {
      await s.get(meLesson(lesson.id, '/playback')).expect(200);
    }
    await s
      .get(meLesson(lesson.id, '/playback'))
      .expect(429)
      .expect(({ body }) => expect(body.code).toBe('RATE_LIMITED'));
  });
});
