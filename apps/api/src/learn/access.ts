import { HttpStatus } from '@nestjs/common';
import {
  crossTenantDb,
  db,
  tenantDb,
  type Course,
  type Enrollment,
  type LessonProgress,
  type TenantTx,
  type Workspace,
} from '@nibras/db';
import { ApiError } from '../common/api-error';
import { inactiveMembershipError } from '../tenancy/workspace-context.guard';
import type { LockInput } from './lock.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Course statuses open to enrolled students (PRD §8.5.1). */
const OPEN_STATUSES = new Set<Course['status']>(['PUBLISHED', 'ARCHIVED']);

export interface CourseAccess {
  wid: string;
  workspace: Pick<Workspace, 'id' | 'name' | 'status'>;
  course: Course;
  enrollment: Enrollment;
}

export interface LessonAccess extends CourseAccess {
  lessonId: string;
}

export function learnNotFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}

/**
 * Whether `userId` may read `courseId` as a student (spec §4.6, PRD §8.5.1), in this order:
 * 1. his enrollment, through `crossTenantDb()` on the user-scoped `studentUserId` (D7): none →
 *    `404` (a course he is not enrolled in does not exist for him, whatever the workspace);
 *    REVOKED → `403 ENROLLMENT_REVOKED`;
 * 2. under `tenantDb(enrollment.workspaceId)`: his membership — missing / REMOVED / REJECTED →
 *    `404`, a minor waiting on the consent → `403 GUARDIAN_CONSENT_REQUIRED`, any other
 *    non-ACTIVE status → `403 MEMBERSHIP_INACTIVE` (SP2's mapping);
 * 3. the course: deleted or not PUBLISHED / ARCHIVED → `403 COURSE_NOT_AVAILABLE` (AC-CRS-02).
 */
export async function resolveCourseAccess(userId: string, courseId: string): Promise<CourseAccess> {
  if (!UUID.test(courseId)) throw learnNotFound();
  const enrollment = await crossTenantDb().enrollment.findFirst({
    where: { studentUserId: userId, courseId },
  });
  if (!enrollment) throw learnNotFound();
  if (enrollment.status === 'REVOKED') {
    throw new ApiError(
      HttpStatus.FORBIDDEN,
      'ENROLLMENT_REVOKED',
      'Your enrollment in this course was revoked',
    );
  }
  const wid = enrollment.workspaceId;
  const scoped = tenantDb(wid);
  const membership = await scoped.membership.findFirst({
    where: { userId },
    select: { status: true },
  });
  if (!membership || membership.status === 'REMOVED' || membership.status === 'REJECTED') {
    throw learnNotFound();
  }
  const inactive = inactiveMembershipError(membership.status);
  if (inactive) throw inactive;

  const course = await scoped.course.findFirst({ where: { id: courseId } });
  if (!course || course.deletedAt !== null || !OPEN_STATUSES.has(course.status)) {
    throw new ApiError(
      HttpStatus.FORBIDDEN,
      'COURSE_NOT_AVAILABLE',
      'This course is not available',
      course && course.deletedAt === null ? { status: course.status } : undefined,
    );
  }
  const workspace = await db.workspace.findUnique({
    where: { id: wid },
    select: { id: true, name: true, status: true },
  });
  if (!workspace) throw learnNotFound();
  return { wid, workspace, course, enrollment };
}

/**
 * {@link resolveCourseAccess} for the course of `lessonId`, in two steps because a lesson's
 * course is reached through a tenant relation (forbidden in `crossTenantDb()`): the lesson by
 * `id` (its `moduleId`, `workspaceId`), then the module under `tenantDb(workspaceId)`. An unknown
 * lesson → `404`, like a lesson of a course he is not enrolled in.
 */
export async function resolveLessonAccess(userId: string, lessonId: string): Promise<LessonAccess> {
  if (!UUID.test(lessonId)) throw learnNotFound();
  const lesson = await crossTenantDb().lesson.findUnique({
    where: { id: lessonId },
    select: { moduleId: true, workspaceId: true },
  });
  if (!lesson) throw learnNotFound();
  const module = await tenantDb(lesson.workspaceId).module.findFirst({
    where: { id: lesson.moduleId },
    select: { courseId: true },
  });
  if (!module) throw learnNotFound();
  return { ...(await resolveCourseAccess(userId, module.courseId)), lessonId };
}

/** The asset columns the student routes need (playback, outline). */
const outlineMediaSelect = {
  id: true,
  kind: true,
  provider: true,
  status: true,
  storageKey: true,
  providerAssetId: true,
  mimeType: true,
  originalFilename: true,
  durationS: true,
  pageCount: true,
} as const;

type OutlineReader = Pick<TenantTx, 'module' | 'lessonProgress'>;

async function queryOutline(client: OutlineReader, courseId: string, userId: string) {
  // Sequential: `client` may be an interactive transaction (one connection).
  const modules = await client.module.findMany({
    where: { courseId },
    orderBy: { position: 'asc' },
    include: {
      lessons: {
        orderBy: { position: 'asc' },
        include: { mediaAsset: { select: outlineMediaSelect } },
      },
    },
  });
  const progress = await client.lessonProgress.findMany({
    where: { studentUserId: userId, lesson: { module: { courseId } } },
  });
  return { modules, progress };
}

export type Outline = Awaited<ReturnType<typeof queryOutline>> & {
  /** `lessonId → progress row`. */
  progressByLesson: Map<string, LessonProgress>;
  /** The lock evaluator's input, in position order. */
  lockInput: LockInput;
};

export type OutlineModule = Outline['modules'][number];
export type OutlineLesson = OutlineModule['lessons'][number];

/**
 * The course's modules and lessons (position order, with their media) and the student's progress
 * rows, plus the {@link LockInput} built from them. `client` is `tenantDb(wid)` or a tenant
 * transaction of the course's workspace.
 */
export async function loadOutline(
  client: OutlineReader,
  course: Pick<Course, 'id' | 'sequentialLessons'>,
  userId: string,
): Promise<Outline> {
  const { modules, progress } = await queryOutline(client, course.id, userId);
  const progressByLesson = new Map(progress.map((p) => [p.lessonId, p]));
  const lockInput: LockInput = {
    sequentialLessons: course.sequentialLessons,
    modules: modules.map((m) => ({
      id: m.id,
      title: m.title,
      isOptional: m.isOptional,
      unlockRule: unlockRuleOf(m.unlockRule),
      lessons: m.lessons.map((l) => ({
        id: l.id,
        title: l.title,
        isRequired: l.isRequired,
        status: progressByLesson.get(l.id)?.status ?? 'NOT_STARTED',
      })),
    })),
  };
  return { modules, progress, progressByLesson, lockInput };
}

/** `{ type: 'NONE' }` for anything that is not a known rule object (never gates). */
export function unlockRuleOf(raw: unknown): { type: 'NONE' | 'PREVIOUS_MODULE_COMPLETED' } {
  const type = (raw as { type?: unknown } | null)?.type;
  return { type: type === 'PREVIOUS_MODULE_COMPLETED' ? type : 'NONE' };
}
