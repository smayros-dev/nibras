import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  collectImageIds,
  type CourseStructure,
  type CreateLessonInput,
  type CreateModuleInput,
  type LessonDetail,
  type LessonMedia,
  type LessonSummary,
  type ModuleWithLessons,
  type RichTextDoc,
  type UnlockRule,
  type UpdateLessonInput,
  type UpdateModuleInput,
} from '@nibras/contracts';
import {
  Prisma,
  tenantDb,
  withTenantTx,
  type GuardedClient,
  type LessonType,
  type TenantTx,
} from '@nibras/db';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { assertVersion } from '../common/if-match';
import {
  bumpCourseVersion,
  courseNotFound,
  isUuid,
  loadCourseForWrite,
  mediaScopeFilter,
  ownerFilter,
  type CourseCtx,
  type LockedCourse,
} from '../courses/course-access';
import { DB } from '../db/db.module';
import { readSettings } from '../workspaces/workspace-settings.service';
import { validationFailed } from '../workspaces/workspaces.service';
import { RichTextService } from './rich-text.service';

const MEDIA_SELECT = {
  id: true,
  kind: true,
  status: true,
  failureReason: true,
  durationS: true,
  pageCount: true,
  width: true,
  height: true,
  thumbnailUrl: true,
} satisfies Prisma.MediaAssetSelect;

const LESSON_INCLUDE = { mediaAsset: { select: MEDIA_SELECT } } satisfies Prisma.LessonInclude;

type LessonRow = Prisma.LessonGetPayload<{ include: typeof LESSON_INCLUDE }>;

const MODULE_INCLUDE = {
  lessons: { orderBy: { position: 'asc' }, include: LESSON_INCLUDE },
} satisfies Prisma.ModuleInclude;

type ModuleRow = Prisma.ModuleGetPayload<{ include: typeof MODULE_INCLUDE }>;

/** A response and the course version it leaves (the controller's `ETag`). */
export interface Versioned<T> {
  value: T;
  courseVersion: number;
}

/** Module fields of `PATCH …/modules/{mid}`, in audit order. */
const MODULE_KEYS = ['title', 'description', 'isOptional', 'unlockRule'] as const;

/** Lesson fields of `PATCH …/lessons/{lid}`, in audit order. */
const LESSON_KEYS = [
  'title',
  'description',
  'isRequired',
  'estimatedMinutes',
  'allowDownload',
  'mediaAssetId',
  'content',
] as const;

/** The audit placeholder of a rich-text document: named, never copied (T5 rule). */
const RICH_TEXT = '[rich text]';

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The media kind a lesson type needs. */
const MEDIA_KIND_OF: Partial<Record<LessonType, 'VIDEO' | 'PDF'>> = { VIDEO: 'VIDEO', PDF: 'PDF' };

/** `If-Match` is optional on create/delete: checked when given (D8 requires it on PATCH/reorder). */
function assertVersionIfGiven(current: number, expected: number | null): void {
  if (expected !== null) assertVersion(current, expected);
}

/** The ordered `ids` must be exactly the current set (no partial, foreign or extra id). */
function assertSameSet(current: readonly string[], ids: readonly string[], what: string): void {
  const set = new Set(current);
  if (ids.length !== current.length || !ids.every((id) => set.has(id))) {
    throw validationFailed('ids', `Must list every ${what} exactly once`);
  }
}

function toMedia(row: LessonRow['mediaAsset']): LessonMedia | null {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    failureReason: row.failureReason,
    durationS: row.durationS,
    pageCount: row.pageCount,
    width: row.width,
    height: row.height,
    thumbnailUrl: row.thumbnailUrl,
  };
}

function toLesson(row: LessonRow): LessonSummary {
  return {
    id: row.id,
    moduleId: row.moduleId,
    title: row.title,
    description: row.description,
    // SP3 creates only the MVP types (the P1 ones have no route yet).
    type: row.type as LessonSummary['type'],
    position: row.position,
    isRequired: row.isRequired,
    estimatedMinutes: row.estimatedMinutes,
    allowDownload: row.allowDownload,
    mediaAssetId: row.mediaAssetId,
    media: toMedia(row.mediaAsset),
    hasContent: row.content !== null,
    version: row.version,
  };
}

function toModule(row: ModuleRow): ModuleWithLessons {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    position: row.position,
    isOptional: row.isOptional,
    unlockRule: row.unlockRule as UnlockRule,
    version: row.version,
    lessons: row.lessons.map(toLesson),
  };
}

/**
 * Modules and lessons of a course (PRD §8.4.2–8.4.3; spec §4.2). Every write runs in one
 * `withTenantTx`: lock the course row (`loadCourseForWrite`: another workspace's, another
 * teacher's in scope `own`, or a deleted course → `404`), check `If-Match` against the course
 * version, mutate, bump `Course.version` (and `Module.version` for its own and its lessons'
 * changes, `Lesson.version` for its own), then audit. Concurrent writes on one course serialise
 * on the row lock, so two creations under the same `If-Match` give one success and one `409`
 * (Review Focus 1). Positions are renumbered 1..n under deferred unique constraints (D9).
 */
@Injectable()
export class StructureService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'workspace'>,
    private readonly audit: AuditService,
    private readonly richText: RichTextService,
  ) {}

  /** `GET …/courses/{cid}/structure`: modules → lessons (by position) with media statuses. */
  async structure(ctx: CourseCtx, cid: string): Promise<CourseStructure> {
    if (!isUuid(cid)) throw courseNotFound();
    return this.readStructure(tenantDb(ctx.workspaceId), ctx, cid);
  }

  /** `POST …/courses/{cid}/modules`: appended (`position = count + 1`). Audited `module.created`. */
  async createModule(
    ctx: CourseCtx,
    cid: string,
    input: CreateModuleInput,
    expected: number | null,
  ): Promise<Versioned<ModuleWithLessons>> {
    const result = await withTenantTx(ctx.workspaceId, async (tx) => {
      const course = await loadCourseForWrite(tx, ctx, cid);
      assertVersionIfGiven(course.version, expected);
      const position = (await tx.module.count({ where: { courseId: cid } })) + 1;
      const row = await tx.module.create({
        data: {
          workspaceId: ctx.workspaceId,
          courseId: cid,
          title: input.title,
          description: input.description ?? null,
          isOptional: input.isOptional ?? false,
          unlockRule: input.unlockRule,
          position,
        },
        include: MODULE_INCLUDE,
      });
      return { value: toModule(row), courseVersion: await bumpCourseVersion(tx, cid) };
    });
    const m = result.value;
    await this.audit.log({
      action: 'module.created',
      entityType: 'Module',
      entityId: m.id,
      after: {
        courseId: cid,
        title: m.title,
        position: m.position,
        isOptional: m.isOptional,
        unlockRule: m.unlockRule,
      },
    });
    return result;
  }

  /** `PATCH …/modules/{mid}` (`If-Match` required). Audited `module.updated` (changed keys). */
  async updateModule(
    ctx: CourseCtx,
    mid: string,
    input: UpdateModuleInput,
    expected: number | null,
  ): Promise<Versioned<ModuleWithLessons>> {
    const { result, before, after } = await withTenantTx(ctx.workspaceId, async (tx) => {
      const { course, module } = await this.moduleForWrite(tx, ctx, mid);
      assertVersion(course.version, expected);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const data: Prisma.ModuleUncheckedUpdateInput = { version: { increment: 1 } };
      for (const key of MODULE_KEYS) {
        const next = input[key];
        if (next === undefined || sameValue(next, module[key])) continue;
        (data as Record<string, unknown>)[key] = next;
        before[key] = module[key];
        after[key] = next;
      }
      const row = await tx.module.update({ where: { id: mid }, data, include: MODULE_INCLUDE });
      const courseVersion = await bumpCourseVersion(tx, course.id);
      return { result: { value: toModule(row), courseVersion }, before, after };
    });
    await this.audit.log({
      action: 'module.updated',
      entityType: 'Module',
      entityId: mid,
      before,
      after,
    });
    return result;
  }

  /**
   * `DELETE …/modules/{mid}`: its lessons go with it (their media stay: a media is only deleted
   * through its own route); the following modules move up. Audited `module.deleted`.
   */
  async deleteModule(ctx: CourseCtx, mid: string, expected: number | null): Promise<number> {
    const { courseVersion, before } = await withTenantTx(ctx.workspaceId, async (tx) => {
      const { course, module } = await this.moduleForWrite(tx, ctx, mid);
      assertVersionIfGiven(course.version, expected);
      const lessonCount = await tx.lesson.count({ where: { moduleId: mid } });
      await tx.module.delete({ where: { id: mid } });
      await tx.$executeRaw`SET CONSTRAINTS "module_course_position_key" DEFERRED`;
      await tx.module.updateMany({
        where: { courseId: course.id, position: { gt: module.position } },
        data: { position: { decrement: 1 }, version: { increment: 1 } },
      });
      return {
        courseVersion: await bumpCourseVersion(tx, course.id),
        before: {
          courseId: course.id,
          title: module.title,
          position: module.position,
          lessonCount,
        },
      };
    });
    await this.audit.log({ action: 'module.deleted', entityType: 'Module', entityId: mid, before });
    return courseVersion;
  }

  /**
   * `POST …/courses/{cid}/modules/reorder` (`If-Match` required, AC-CRS-04): `ids` = every module
   * of the course once (`422` on `ids` otherwise), renumbered 1..n in one transaction under
   * `SET CONSTRAINTS "module_course_position_key" DEFERRED`. Audited `module.reordered`.
   */
  async reorderModules(
    ctx: CourseCtx,
    cid: string,
    ids: string[],
    expected: number | null,
  ): Promise<Versioned<CourseStructure>> {
    const { result, before } = await withTenantTx(ctx.workspaceId, async (tx) => {
      const course = await loadCourseForWrite(tx, ctx, cid);
      assertVersion(course.version, expected);
      const current = await tx.module.findMany({
        where: { courseId: cid },
        orderBy: { position: 'asc' },
        select: { id: true, position: true },
      });
      assertSameSet(
        current.map((m) => m.id),
        ids,
        'module of the course',
      );
      await tx.$executeRaw`SET CONSTRAINTS "module_course_position_key" DEFERRED`;
      const positions = new Map(current.map((m) => [m.id, m.position]));
      for (const [i, id] of ids.entries()) {
        if (positions.get(id) === i + 1) continue;
        await tx.module.update({
          where: { id },
          data: { position: i + 1, version: { increment: 1 } },
        });
      }
      const courseVersion = await bumpCourseVersion(tx, cid);
      const value = await this.readStructure(tx, ctx, cid);
      return { result: { value, courseVersion }, before: current.map((m) => m.id) };
    });
    await this.audit.log({
      action: 'module.reordered',
      entityType: 'Course',
      entityId: cid,
      before: { ids: before },
      after: { ids },
    });
    return result;
  }

  /**
   * `POST …/modules/{mid}/lessons`: appended. VIDEO / PDF → a media of the workspace the caller
   * may use, of the matching kind (`422 MEDIA_KIND_MISMATCH`), READY or PROCESSING (`409
   * MEDIA_NOT_READY`); unknown, foreign or deleted → `404`. TEXT → whitelisted rich text whose
   * images are READY images of the workspace (`422` on `content`). A PDF's `allowDownload`
   * defaults to the workspace's `default_pdf_download`. Audited `lesson.created`.
   */
  async createLesson(
    ctx: CourseCtx,
    mid: string,
    input: CreateLessonInput,
    expected: number | null,
  ): Promise<Versioned<LessonDetail>> {
    const allowDownload =
      input.type === 'PDF'
        ? (input.allowDownload ?? (await this.defaultPdfDownload(ctx.workspaceId)))
        : false;
    const result = await withTenantTx(ctx.workspaceId, async (tx) => {
      const { course } = await this.moduleForWrite(tx, ctx, mid);
      assertVersionIfGiven(course.version, expected);
      let content: RichTextDoc | undefined;
      if (input.type === 'TEXT') {
        const text = this.richText.validate(input.content, { allowImages: true });
        await this.richText.assertImages(tx, ctx, text.imageIds);
        content = text.doc;
      } else {
        await this.assertLessonMedia(tx, ctx, input.type, input.mediaAssetId);
      }
      const position = (await tx.lesson.count({ where: { moduleId: mid } })) + 1;
      const row = await tx.lesson.create({
        data: {
          workspaceId: ctx.workspaceId,
          moduleId: mid,
          title: input.title,
          description: input.description ?? null,
          type: input.type,
          position,
          isRequired: input.isRequired ?? true,
          estimatedMinutes: input.estimatedMinutes ?? null,
          allowDownload,
          mediaAssetId: input.type === 'TEXT' ? null : input.mediaAssetId,
          content: content as Prisma.InputJsonValue | undefined,
        },
        include: LESSON_INCLUDE,
      });
      await tx.module.update({ where: { id: mid }, data: { version: { increment: 1 } } });
      const courseVersion = await bumpCourseVersion(tx, course.id);
      return { value: await this.toDetail(tx, row), courseVersion };
    });
    const l = result.value;
    await this.audit.log({
      action: 'lesson.created',
      entityType: 'Lesson',
      entityId: l.id,
      after: {
        moduleId: mid,
        title: l.title,
        type: l.type,
        position: l.position,
        isRequired: l.isRequired,
        allowDownload: l.allowDownload,
        ...(l.mediaAssetId !== null && { mediaAssetId: l.mediaAssetId }),
        ...(l.type === 'TEXT' && { content: RICH_TEXT }),
      },
    });
    return result;
  }

  /**
   * `PATCH …/lessons/{lid}` (`If-Match` required): the type is immutable (the schema has no
   * `type`); a field foreign to the type → `422` at that field. A new media or content is checked
   * as at creation (ids the lesson already references stay usable in scope `own`). Audited
   * `lesson.updated` with the changed keys (rich text named, not copied).
   */
  async updateLesson(
    ctx: CourseCtx,
    lid: string,
    input: UpdateLessonInput,
    expected: number | null,
  ): Promise<Versioned<LessonDetail>> {
    const { result, before, after } = await withTenantTx(ctx.workspaceId, async (tx) => {
      const { course, lesson } = await this.lessonForWrite(tx, ctx, lid);
      assertVersion(course.version, expected);
      if (input.content !== undefined && lesson.type !== 'TEXT') {
        throw validationFailed('content', 'Only a TEXT lesson has a content');
      }
      if (input.mediaAssetId !== undefined && lesson.type === 'TEXT') {
        throw validationFailed('mediaAssetId', 'A TEXT lesson has no media');
      }
      if (input.allowDownload !== undefined && lesson.type !== 'PDF') {
        throw validationFailed('allowDownload', 'Only a PDF lesson can be downloadable');
      }
      if (input.mediaAssetId !== undefined && input.mediaAssetId !== lesson.mediaAssetId) {
        const keep = lesson.mediaAssetId ? [lesson.mediaAssetId] : [];
        await this.assertLessonMedia(tx, ctx, lesson.type, input.mediaAssetId, keep);
      }
      let content: RichTextDoc | undefined;
      if (input.content !== undefined) {
        const text = this.richText.validate(input.content, { allowImages: true });
        const keep = lesson.content
          ? collectImageIds(lesson.content as unknown as RichTextDoc)
          : [];
        await this.richText.assertImages(tx, ctx, text.imageIds, keep);
        content = text.doc;
      }
      const next: Record<string, unknown> = { ...input, ...(content && { content }) };
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const data: Prisma.LessonUncheckedUpdateInput = { version: { increment: 1 } };
      for (const key of LESSON_KEYS) {
        const value = next[key];
        if (value === undefined || sameValue(value, lesson[key])) continue;
        (data as Record<string, unknown>)[key] = value;
        before[key] = key === 'content' ? RICH_TEXT : lesson[key];
        after[key] = key === 'content' ? RICH_TEXT : value;
      }
      const row = await tx.lesson.update({ where: { id: lid }, data, include: LESSON_INCLUDE });
      await tx.module.update({
        where: { id: lesson.moduleId },
        data: { version: { increment: 1 } },
      });
      const courseVersion = await bumpCourseVersion(tx, course.id);
      return { result: { value: await this.toDetail(tx, row), courseVersion }, before, after };
    });
    await this.audit.log({
      action: 'lesson.updated',
      entityType: 'Lesson',
      entityId: lid,
      before,
      after,
    });
    return result;
  }

  /**
   * `DELETE …/lessons/{lid}`: the following lessons move up; the media stays (deleted through its
   * own route, `409 MEDIA_IN_USE` while a lesson uses it). Audited `lesson.deleted`.
   */
  async deleteLesson(ctx: CourseCtx, lid: string, expected: number | null): Promise<number> {
    const { courseVersion, before } = await withTenantTx(ctx.workspaceId, async (tx) => {
      const { course, lesson } = await this.lessonForWrite(tx, ctx, lid);
      assertVersionIfGiven(course.version, expected);
      await tx.lesson.delete({ where: { id: lid } });
      await tx.$executeRaw`SET CONSTRAINTS "lesson_module_position_key" DEFERRED`;
      await tx.lesson.updateMany({
        where: { moduleId: lesson.moduleId, position: { gt: lesson.position } },
        data: { position: { decrement: 1 }, version: { increment: 1 } },
      });
      await tx.module.update({
        where: { id: lesson.moduleId },
        data: { version: { increment: 1 } },
      });
      return {
        courseVersion: await bumpCourseVersion(tx, course.id),
        before: {
          moduleId: lesson.moduleId,
          title: lesson.title,
          type: lesson.type,
          position: lesson.position,
          ...(lesson.mediaAssetId !== null && { mediaAssetId: lesson.mediaAssetId }),
        },
      };
    });
    await this.audit.log({ action: 'lesson.deleted', entityType: 'Lesson', entityId: lid, before });
    return courseVersion;
  }

  /**
   * `POST …/modules/{mid}/lessons/reorder` (`If-Match` required, AC-CRS-04): `ids` = every lesson
   * of the module once, renumbered 1..n under `SET CONSTRAINTS "lesson_module_position_key"
   * DEFERRED`. Audited `lesson.reordered`.
   */
  async reorderLessons(
    ctx: CourseCtx,
    mid: string,
    ids: string[],
    expected: number | null,
  ): Promise<Versioned<ModuleWithLessons>> {
    const { result, before } = await withTenantTx(ctx.workspaceId, async (tx) => {
      const { course } = await this.moduleForWrite(tx, ctx, mid);
      assertVersion(course.version, expected);
      const current = await tx.lesson.findMany({
        where: { moduleId: mid },
        orderBy: { position: 'asc' },
        select: { id: true, position: true },
      });
      assertSameSet(
        current.map((l) => l.id),
        ids,
        'lesson of the module',
      );
      await tx.$executeRaw`SET CONSTRAINTS "lesson_module_position_key" DEFERRED`;
      const positions = new Map(current.map((l) => [l.id, l.position]));
      for (const [i, id] of ids.entries()) {
        if (positions.get(id) === i + 1) continue;
        await tx.lesson.update({
          where: { id },
          data: { position: i + 1, version: { increment: 1 } },
        });
      }
      const row = await tx.module.update({
        where: { id: mid },
        data: { version: { increment: 1 } },
        include: MODULE_INCLUDE,
      });
      const courseVersion = await bumpCourseVersion(tx, course.id);
      return {
        result: { value: toModule(row), courseVersion },
        before: current.map((l) => l.id),
      };
    });
    await this.audit.log({
      action: 'lesson.reordered',
      entityType: 'Module',
      entityId: mid,
      before: { ids: before },
      after: { ids },
    });
    return result;
  }

  /** `GET …/lessons/{lid}`: the lesson with its content and 5-minute image URLs. */
  async lesson(ctx: CourseCtx, lid: string): Promise<Versioned<LessonDetail>> {
    if (!isUuid(lid)) throw courseNotFound();
    const client = tenantDb(ctx.workspaceId);
    const row = await client.lesson.findFirst({
      where: { id: lid, module: { course: { deletedAt: null, ...ownerFilter(ctx) } } },
      include: { ...LESSON_INCLUDE, module: { select: { course: { select: { version: true } } } } },
    });
    if (!row) throw courseNotFound();
    return { value: await this.toDetail(client, row), courseVersion: row.module.course.version };
  }

  // ---- helpers ----

  private async readStructure(
    client: Pick<TenantTx, 'course'>,
    ctx: CourseCtx,
    cid: string,
  ): Promise<CourseStructure> {
    const row = await client.course.findFirst({
      where: { id: cid, deletedAt: null, ...ownerFilter(ctx) },
      select: {
        id: true,
        version: true,
        status: true,
        sequentialLessons: true,
        modules: { orderBy: { position: 'asc' }, include: MODULE_INCLUDE },
      },
    });
    if (!row) throw courseNotFound();
    return {
      courseId: row.id,
      version: row.version,
      status: row.status,
      sequentialLessons: row.sequentialLessons,
      modules: row.modules.map(toModule),
    };
  }

  private async toDetail(
    client: Pick<TenantTx, 'mediaAsset'>,
    row: LessonRow,
  ): Promise<LessonDetail> {
    const content = (row.content ?? null) as RichTextDoc | null;
    const images = content ? await this.richText.signImages(client, collectImageIds(content)) : {};
    return { ...toLesson(row), content, images };
  }

  /**
   * The module `mid` with its course row locked: the module is read, its course locked (scope,
   * workspace, `deletedAt`), then the module re-read under the lock (a concurrent delete → `404`).
   */
  private async moduleForWrite(tx: TenantTx, ctx: CourseCtx, mid: string) {
    if (!isUuid(mid)) throw courseNotFound();
    const found = await tx.module.findFirst({ where: { id: mid }, select: { courseId: true } });
    if (!found) throw courseNotFound();
    const course: LockedCourse = await loadCourseForWrite(tx, ctx, found.courseId);
    const module = await tx.module.findFirst({ where: { id: mid, courseId: course.id } });
    if (!module) throw courseNotFound();
    return { course, module };
  }

  /** The lesson `lid` with its course row locked (as `moduleForWrite`). */
  private async lessonForWrite(tx: TenantTx, ctx: CourseCtx, lid: string) {
    if (!isUuid(lid)) throw courseNotFound();
    const found = await tx.lesson.findFirst({
      where: { id: lid },
      select: { module: { select: { courseId: true } } },
    });
    if (!found) throw courseNotFound();
    const course: LockedCourse = await loadCourseForWrite(tx, ctx, found.module.courseId);
    const lesson = await tx.lesson.findFirst({
      where: { id: lid, module: { courseId: course.id } },
    });
    if (!lesson) throw courseNotFound();
    return { course, lesson };
  }

  /**
   * A VIDEO / PDF lesson's media: an undeleted asset of the workspace the caller may use
   * (`mediaScopeFilter`), else `404`; of the type's kind, else `422 MEDIA_KIND_MISMATCH`; READY or
   * PROCESSING (§8.4.4: shown « en cours de traitement »), else `409 MEDIA_NOT_READY`.
   */
  private async assertLessonMedia(
    tx: TenantTx,
    ctx: CourseCtx,
    type: LessonType,
    mediaId: string,
    keep: readonly string[] = [],
  ): Promise<void> {
    const asset = await tx.mediaAsset.findFirst({
      where: { AND: [{ id: mediaId, deletedAt: null }, mediaScopeFilter(ctx, keep)] },
      select: { kind: true, status: true },
    });
    if (!asset) throw courseNotFound();
    const kind = MEDIA_KIND_OF[type];
    if (asset.kind !== kind) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'MEDIA_KIND_MISMATCH',
        'The media does not match the lesson type',
        { expected: kind, kind: asset.kind },
      );
    }
    if (asset.status !== 'READY' && asset.status !== 'PROCESSING') {
      throw new ApiError(HttpStatus.CONFLICT, 'MEDIA_NOT_READY', 'The media is not usable', {
        status: asset.status,
      });
    }
  }

  private async defaultPdfDownload(workspaceId: string): Promise<boolean> {
    const workspace = await this.db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { settings: true, defaultTimezone: true },
    });
    return readSettings(workspace).default_pdf_download;
  }
}
