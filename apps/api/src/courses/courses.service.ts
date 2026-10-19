import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  COURSE_PUBLISHED_NOTIFY_JOB,
  INLINE_URL_TTL_S,
  QUEUES,
  coursePublishedNotifyJobId,
  type CourseDetail,
  type CoursePublishedNotifyJob,
  type CourseSummary,
  type CoursesPage,
  type CoursesQuery,
  type CreateCourseInput,
  type PublishBlocker,
  type UpdateCourseInput,
} from '@nibras/contracts';
import {
  Prisma,
  tenantDb,
  withTenantTx,
  type CourseStatus,
  type GuardedClient,
  type TenantTx,
} from '@nibras/db';
import type { StorageProvider } from '@nibras/providers';
import { PinoLogger } from 'nestjs-pino';
import { AuditService, type AuditAction } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { assertVersion } from '../common/if-match';
import { RequestContext } from '../common/request-context';
import { DB } from '../db/db.module';
import { STORAGE_PROVIDER } from '../media/tokens';
import { QueueService } from '../queue/queue.service';
import { readSettings } from '../workspaces/workspace-settings.service';
import { validationFailed } from '../workspaces/workspaces.service';
import {
  courseNotFound,
  isUuid,
  loadCourseForWrite,
  ownerFilter,
  type CourseCtx,
} from './course-access';

const COURSE_INCLUDE = {
  owner: { select: { firstName: true, lastName: true } },
  cover: { select: { kind: true, status: true, storageKey: true, deletedAt: true } },
  _count: { select: { modules: true, enrollments: { where: { status: 'ACTIVE' } } } },
} satisfies Prisma.CourseInclude;

type CourseRow = Prisma.CourseGetPayload<{ include: typeof COURSE_INCLUDE }>;

/** Lesson count and derived duration of one course. */
interface CourseStats {
  lessonCount: number;
  derivedMinutes: number;
}

/** The lessons of `courseIds` with what their duration derives from. */
const lessonStatsArgs = (courseIds: string[]) =>
  ({
    where: { module: { courseId: { in: courseIds } } },
    select: {
      estimatedMinutes: true,
      module: { select: { courseId: true } },
      mediaAsset: { select: { durationS: true } },
    },
  }) satisfies Prisma.LessonFindManyArgs;

type LessonStatsRow = Prisma.LessonGetPayload<ReturnType<typeof lessonStatsArgs>>;

/** Why a course cannot be published, and its lessons whose media is still processing. */
interface PublishCheck {
  missing: PublishBlocker[];
  lessons: { id: string; title: string }[];
}

/** The status transitions of spec §4.1 (§10.7): allowed source states, target, audit action. */
const TRANSITIONS = {
  publish: { from: ['DRAFT'], to: 'PUBLISHED', action: 'course.published' },
  unpublish: { from: ['PUBLISHED'], to: 'DRAFT', action: 'course.unpublished' },
  archive: { from: ['PUBLISHED'], to: 'ARCHIVED', action: 'course.archived' },
  restore: { from: ['ARCHIVED'], to: 'PUBLISHED', action: 'course.restored' },
} as const satisfies Record<
  string,
  { from: readonly CourseStatus[]; to: CourseStatus; action: AuditAction }
>;

export type CourseTransition = keyof typeof TRANSITIONS;

/** The `PATCH` fields, in audit order. */
const UPDATABLE_KEYS = [
  'title',
  'description',
  'category',
  'level',
  'language',
  'estimatedMinutes',
  'sequentialLessons',
  'coverMediaId',
] as const satisfies readonly (keyof UpdateCourseInput)[];

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function statusInvalid(status: CourseStatus, details: Record<string, unknown>): ApiError {
  return new ApiError(
    HttpStatus.CONFLICT,
    'COURSE_STATUS_INVALID',
    'The course is not in a state that allows this action',
    { status, ...details },
  );
}

/** Minutes a lesson counts for: its own estimate, else its media's duration rounded up. */
function lessonMinutes(l: LessonStatsRow): number {
  if (l.estimatedMinutes !== null) return l.estimatedMinutes;
  const seconds = l.mediaAsset?.durationS;
  return seconds ? Math.ceil(seconds / 60) : 0;
}

/**
 * Courses of a workspace (PRD §8.4.1, §10.7; spec §4.1): CRUD with optimistic locking, the
 * status machine DRAFT ⇄ PUBLISHED → ARCHIVED → PUBLISHED, soft deletion and reassignment. Every
 * query runs through `tenantDb(wid)` / `withTenantTx(wid)` (a course of another workspace is
 * `404`), filtered on `deletedAt: null` and, in scope `own`, on `ownerUserId = me`. Writes lock
 * the course row (`loadCourseForWrite`) and bump `Course.version` in the same transaction.
 */
@Injectable()
export class CoursesService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'workspace'>,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(CoursesService.name);
  }

  /**
   * `GET /workspaces/{wid}/courses`: newest first (`createdAt` desc, `id` desc) with Prisma's
   * cursor on the course id (compared in SQL, so microsecond timestamps never skip a row);
   * `status` filter, `q` = case-insensitive substring of the title. A cursor outside the filtered
   * scope (another workspace's, another teacher's in scope `own`, deleted) → `422`.
   */
  async list(ctx: CourseCtx, q: CoursesQuery): Promise<CoursesPage> {
    const client = tenantDb(ctx.workspaceId);
    const and: Prisma.CourseWhereInput[] = [{ deletedAt: null }, ownerFilter(ctx)];
    if (q.status) and.push({ status: q.status });
    if (q.q) and.push({ title: { contains: q.q, mode: 'insensitive' } });
    const where: Prisma.CourseWhereInput = { AND: and };
    if (q.cursor !== undefined) {
      const row = await client.course.findFirst({
        where: { AND: [where, { id: q.cursor }] },
        select: { id: true },
      });
      if (!row) throw validationFailed('cursor', 'Unknown cursor');
    }
    const rows = await client.course.findMany({
      where,
      include: COURSE_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor !== undefined && { cursor: { id: q.cursor }, skip: 1 }),
    });
    const items = rows.slice(0, q.limit);
    const stats = this.toStats(
      items.length === 0
        ? []
        : await client.lesson.findMany(lessonStatsArgs(items.map((c) => c.id))),
    );
    return {
      items: await Promise.all(items.map((c) => this.toSummary(c, stats.get(c.id)))),
      nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null,
    };
  }

  /** `GET …/courses/{cid}`: the course with its publication check (`ETag` set by the controller). */
  get(ctx: CourseCtx, cid: string): Promise<CourseDetail> {
    if (!isUuid(cid)) throw courseNotFound();
    return withTenantTx(ctx.workspaceId, (tx) => this.detail(tx, ctx, cid));
  }

  /**
   * `POST /workspaces/{wid}/courses` (`course.create`): a `DRAFT` owned by the caller, version 1;
   * `sequentialLessons` defaults to the workspace's `default_sequential_lessons`. A cover must be
   * a READY image of the workspace (`422` otherwise). Audited `course.created`.
   */
  async create(ctx: CourseCtx, input: CreateCourseInput): Promise<CourseDetail> {
    const workspace = await this.db.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { settings: true, defaultTimezone: true },
    });
    const settings = readSettings(workspace);
    const course = await withTenantTx(ctx.workspaceId, async (tx) => {
      if (input.coverMediaId) await this.assertCover(tx, ctx, input.coverMediaId);
      const created = await tx.course.create({
        data: {
          workspaceId: ctx.workspaceId,
          ownerUserId: ctx.userId,
          title: input.title,
          description: input.description,
          category: input.category ?? null,
          level: input.level ?? null,
          language: input.language,
          estimatedMinutes: input.estimatedMinutes ?? null,
          sequentialLessons: input.sequentialLessons ?? settings.default_sequential_lessons,
          coverMediaId: input.coverMediaId ?? null,
        },
      });
      return this.detail(tx, ctx, created.id);
    });
    await this.audit.log({
      action: 'course.created',
      entityType: 'Course',
      entityId: course.id,
      after: {
        title: course.title,
        status: course.status,
        ownerUserId: course.ownerUserId,
        language: course.language,
        sequentialLessons: course.sequentialLessons,
      },
    });
    return course;
  }

  /**
   * `PATCH …/courses/{cid}` with `If-Match` (D8): lock, `428`/`409` on a missing/stale version,
   * apply, `version + 1`. Audited `course.updated` with the changed keys (the rich-text
   * description is named, not copied).
   */
  async update(
    ctx: CourseCtx,
    cid: string,
    input: UpdateCourseInput,
    expectedVersion: number | null,
  ): Promise<CourseDetail> {
    const { course, before, after } = await withTenantTx(ctx.workspaceId, async (tx) => {
      const locked = await loadCourseForWrite(tx, ctx, cid);
      assertVersion(locked.version, expectedVersion);
      const current = await tx.course.findUniqueOrThrow({ where: { id: cid } });
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const data: Prisma.CourseUncheckedUpdateInput = {};
      for (const key of UPDATABLE_KEYS) {
        const next = input[key];
        if (next === undefined || sameValue(next, current[key])) continue;
        if (key === 'description') {
          data.description = next as Prisma.InputJsonValue;
          before.description = current.description === null ? null : '[rich text]';
          after.description = '[rich text]';
          continue;
        }
        if (key === 'coverMediaId' && next !== null) {
          await this.assertCover(tx, ctx, next as string);
        }
        (data as Record<string, unknown>)[key] = next;
        before[key] = current[key];
        after[key] = next;
      }
      data.version = { increment: 1 };
      await tx.course.update({ where: { id: cid }, data });
      return { course: await this.detail(tx, ctx, cid), before, after };
    });
    await this.audit.log({
      action: 'course.updated',
      entityType: 'Course',
      entityId: cid,
      before,
      after,
    });
    return course;
  }

  /**
   * `POST …/courses/{cid}/{publish|unpublish|archive|restore}` (spec §4.1). A source state the
   * transition does not start from → `409 COURSE_STATUS_INVALID { status, allowed }`. `publish`
   * also needs ≥ 1 module and ≥ 1 lesson that is TEXT or whose media is READY, checked under the
   * row lock (`422 COURSE_NOT_PUBLISHABLE { missing, lessons }`), and enqueues one
   * `course.published_notify` per published version. Each transition bumps the version and is
   * audited with before/after `{ status }`; `unpublish` keeps enrollments and progress.
   */
  async transition(ctx: CourseCtx, cid: string, name: CourseTransition): Promise<CourseDetail> {
    const t = TRANSITIONS[name];
    const { course, from } = await withTenantTx(ctx.workspaceId, async (tx) => {
      const locked = await loadCourseForWrite(tx, ctx, cid);
      if (!(t.from as readonly CourseStatus[]).includes(locked.status)) {
        throw statusInvalid(locked.status, { allowed: t.from });
      }
      if (name === 'publish') {
        const check = await this.publishCheck(tx, cid);
        if (check.missing.length > 0) {
          throw new ApiError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'COURSE_NOT_PUBLISHABLE',
            'The course has no lesson ready to be published',
            check,
          );
        }
      }
      const now = new Date();
      await tx.course.update({
        where: { id: cid },
        data: {
          status: t.to,
          version: { increment: 1 },
          ...(name === 'publish' && { publishedAt: now }),
          ...(name === 'archive' && { archivedAt: now }),
          ...(name === 'restore' && { archivedAt: null }),
        },
      });
      return { course: await this.detail(tx, ctx, cid), from: locked.status };
    });
    await this.audit.log({
      action: t.action,
      entityType: 'Course',
      entityId: cid,
      before: { status: from },
      after: { status: t.to },
    });
    if (name === 'publish') await this.enqueuePublished(ctx.workspaceId, cid, course.version);
    return course;
  }

  /**
   * `DELETE …/courses/{cid}` (`course.delete`, PRD §8.4.1): only a DRAFT or ARCHIVED course
   * (`PUBLISHED` → `409 COURSE_STATUS_INVALID` with `hint: 'ARCHIVE_FIRST'`) without ACTIVE
   * enrollment (`409 COURSE_HAS_ACTIVE_ENROLLMENTS { count }`, AC-CRS-05). Soft: `deletedAt = now`,
   * purged after 30 days by the worker. Audited `course.deleted`.
   */
  async remove(ctx: CourseCtx, cid: string): Promise<void> {
    const { status, deletedAt } = await withTenantTx(ctx.workspaceId, async (tx) => {
      const locked = await loadCourseForWrite(tx, ctx, cid);
      if (locked.status === 'PUBLISHED') {
        throw statusInvalid(locked.status, { hint: 'ARCHIVE_FIRST' });
      }
      const count = await tx.enrollment.count({ where: { courseId: cid, status: 'ACTIVE' } });
      if (count > 0) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'COURSE_HAS_ACTIVE_ENROLLMENTS',
          'The course still has active enrollments',
          { count },
        );
      }
      const deletedAt = new Date();
      await tx.course.update({ where: { id: cid }, data: { deletedAt } });
      return { status: locked.status, deletedAt };
    });
    await this.audit.log({
      action: 'course.deleted',
      entityType: 'Course',
      entityId: cid,
      before: { status },
      after: { deletedAt },
    });
  }

  /**
   * `POST …/courses/{cid}/reassign` (`course.reassign`): organisations only (`409
   * NOT_AN_ORGANIZATION`); the new owner must be an ACTIVE TEACHER, or an ACTIVE ADMIN/OWNER with
   * `canTeach`, of this workspace (`422` on `ownerUserId` otherwise). Bumps the version; audited
   * `course.reassigned` with before/after `{ ownerUserId }`. The current owner → unchanged.
   */
  async reassign(ctx: CourseCtx, cid: string, ownerUserId: string): Promise<CourseDetail> {
    const { course, before } = await withTenantTx(ctx.workspaceId, async (tx) => {
      const locked = await loadCourseForWrite(tx, ctx, cid);
      if (RequestContext.get()?.workspace?.type !== 'ORGANIZATION') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'NOT_AN_ORGANIZATION',
          'Only an organisation reassigns courses',
        );
      }
      const target = isUuid(ownerUserId)
        ? await tx.membership.findFirst({
            where: {
              userId: ownerUserId,
              status: 'ACTIVE',
              OR: [{ role: 'TEACHER' }, { role: { in: ['OWNER', 'ADMIN'] }, canTeach: true }],
            },
            select: { id: true },
          })
        : null;
      if (!target) {
        throw validationFailed('ownerUserId', 'The new owner must teach in this workspace');
      }
      if (locked.ownerUserId === ownerUserId) {
        return { course: await this.detail(tx, ctx, cid), before: null };
      }
      await tx.course.update({
        where: { id: cid },
        data: { ownerUserId, version: { increment: 1 } },
      });
      // Only scope `all` holds course.reassign: the course stays readable after the change.
      return { course: await this.detail(tx, ctx, cid), before: locked.ownerUserId };
    });
    if (before !== null) {
      await this.audit.log({
        action: 'course.reassigned',
        entityType: 'Course',
        entityId: cid,
        before: { ownerUserId: before },
        after: { ownerUserId },
      });
    }
    return course;
  }

  // ---- helpers ----

  /** The detail of a live course in the caller's scope, read inside `tx`; else `404`. */
  private async detail(tx: TenantTx, ctx: CourseCtx, cid: string): Promise<CourseDetail> {
    const row = await tx.course.findFirst({
      where: { id: cid, deletedAt: null, ...ownerFilter(ctx) },
      include: COURSE_INCLUDE,
    });
    if (!row) throw courseNotFound();
    const stats = this.toStats(await tx.lesson.findMany(lessonStatsArgs([cid])));
    const check = await this.publishCheck(tx, cid);
    const summary = await this.toSummary(row, stats.get(cid));
    return {
      ...summary,
      description: (row.description ?? null) as CourseDetail['description'],
      estimatedMinutesOverride: row.estimatedMinutes,
      coverMediaId: row.coverMediaId,
      sequentialLessons: row.sequentialLessons,
      isCertifying: row.isCertifying,
      deletedAt: null,
      canPublish: row.status === 'DRAFT' && check.missing.length === 0,
      publishBlockers: check.missing,
    };
  }

  /**
   * Publication precondition (spec §4.1): a module, and a lesson that is TEXT or whose media is
   * READY. `lessons` = the lessons whose media is still PROCESSING (shown to the teacher).
   */
  private async publishCheck(tx: TenantTx, courseId: string): Promise<PublishCheck> {
    const modules = await tx.module.count({ where: { courseId } });
    if (modules === 0) return { missing: ['NO_MODULE'], lessons: [] };
    const ready = await tx.lesson.count({
      where: {
        module: { courseId },
        OR: [{ type: 'TEXT' }, { mediaAsset: { status: 'READY', deletedAt: null } }],
      },
    });
    if (ready > 0) return { missing: [], lessons: [] };
    const lessons = await tx.lesson.findMany({
      where: { module: { courseId }, mediaAsset: { status: 'PROCESSING' } },
      select: { id: true, title: true },
      orderBy: [{ module: { position: 'asc' } }, { position: 'asc' }],
    });
    return { missing: ['NO_READY_LESSON'], lessons };
  }

  /** Lesson count and derived duration per course id, from `lessonStatsArgs` rows. */
  private toStats(lessons: LessonStatsRow[]): Map<string, CourseStats> {
    const stats = new Map<string, CourseStats>();
    for (const l of lessons) {
      const s = stats.get(l.module.courseId) ?? { lessonCount: 0, derivedMinutes: 0 };
      s.lessonCount += 1;
      s.derivedMinutes += lessonMinutes(l);
      stats.set(l.module.courseId, s);
    }
    return stats;
  }

  private async toSummary(row: CourseRow, stats: CourseStats | undefined): Promise<CourseSummary> {
    const lessonCount = stats?.lessonCount ?? 0;
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      level: row.level,
      language: row.language,
      category: row.category,
      coverUrl: await this.coverUrl(row.cover),
      ownerUserId: row.ownerUserId,
      owner: { firstName: row.owner.firstName, lastName: row.owner.lastName },
      estimatedMinutes:
        row.estimatedMinutes ?? (lessonCount > 0 ? (stats?.derivedMinutes ?? 0) : null),
      moduleCount: row._count.modules,
      lessonCount,
      enrolledCount: row._count.enrollments,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** A 5-minute inline URL of a READY cover image (never a raw storage URL); else `null`. */
  private async coverUrl(cover: CourseRow['cover']): Promise<string | null> {
    if (!cover || cover.kind !== 'IMAGE' || cover.status !== 'READY' || cover.deletedAt) {
      return null;
    }
    if (!cover.storageKey) return null;
    return this.storage.signGetUrl(cover.storageKey, INLINE_URL_TTL_S, { disposition: 'inline' });
  }

  /**
   * A cover is a READY, undeleted IMAGE of this workspace (another workspace's id is simply not
   * found here); in scope `own` it must also be the caller's upload. Else `422` on `coverMediaId`.
   */
  private async assertCover(tx: TenantTx, ctx: CourseCtx, mediaId: string): Promise<void> {
    const asset = await tx.mediaAsset.findFirst({
      where: {
        id: mediaId,
        kind: 'IMAGE',
        status: 'READY',
        deletedAt: null,
        ...(ctx.scope === 'own' && { ownerUserId: ctx.userId }),
      },
      select: { id: true },
    });
    if (!asset) throw validationFailed('coverMediaId', 'Not a ready image of this workspace');
  }

  /**
   * The interim publication email (spec D14), sent by the worker: one job per published version
   * (`jobId`). A failed enqueue is logged; the publication stands.
   */
  private async enqueuePublished(workspaceId: string, courseId: string, version: number) {
    const data: CoursePublishedNotifyJob = { workspaceId, courseId };
    try {
      await this.queue.add(QUEUES.notifications, COURSE_PUBLISHED_NOTIFY_JOB, data, {
        jobId: coursePublishedNotifyJobId(courseId, version),
      });
    } catch (err) {
      this.logger.error(
        { courseId, err: { type: err instanceof Error ? err.name : typeof err } },
        'course published notifications not enqueued',
      );
    }
  }
}
