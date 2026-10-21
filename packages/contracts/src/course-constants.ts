// Zod-free (exported by `@nibras/contracts/web` for browser bundles); the schemas are in
// courses.ts, structure.ts, enrollments.ts and learn.ts.
import type { Locale } from './locale-codes';

/** PRD §11.1 `CourseStatus` (`DELETED` is `Course.deletedAt`, never a stored status). */
export const COURSE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

/** PRD §11.1 `CourseLevel`. */
export const COURSE_LEVELS = [
  'PRIMAIRE',
  'COLLEGE',
  'LYCEE',
  'SUPERIEUR',
  'ADULTE',
  'AUTRE',
] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

/** PRD §11.1 `LessonType` (all seven; the database enum). */
export const LESSON_TYPES = [
  'VIDEO',
  'PDF',
  'TEXT',
  'LINK',
  'EMBED',
  'QUIZ',
  'ASSIGNMENT',
] as const;
export type LessonType = (typeof LESSON_TYPES)[number];

/** The lesson types SP3 creates; the others are P1 (refused by the input schemas). */
export const MVP_LESSON_TYPES = ['VIDEO', 'PDF', 'TEXT'] as const satisfies readonly LessonType[];
export type MvpLessonType = (typeof MVP_LESSON_TYPES)[number];

/** PRD §11.1 `UnlockRuleType` / §8.5.2 module unlock rules (all of them; P1 ones are refused by `UnlockRuleSchema`). */
export const UNLOCK_RULE_TYPES = [
  'NONE',
  'PREVIOUS_MODULE_COMPLETED',
  'AFTER_DATE',
  'DAYS_AFTER_ENROLLMENT',
  'MANUAL',
] as const;
export type UnlockRuleType = (typeof UNLOCK_RULE_TYPES)[number];

/** The unlock rules SP3 accepts. */
export const MVP_UNLOCK_RULES = [
  'NONE',
  'PREVIOUS_MODULE_COMPLETED',
] as const satisfies readonly UnlockRuleType[];
export type MvpUnlockRule = (typeof MVP_UNLOCK_RULES)[number];

/** `Enrollment.status`. */
export const ENROLLMENT_STATUSES = ['ACTIVE', 'REVOKED'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/** `Enrollment.source`. */
export const ENROLLMENT_SOURCES = ['MANUAL', 'INVITATION', 'INVITE_LINK'] as const;
export type EnrollmentSource = (typeof ENROLLMENT_SOURCES)[number];

/** `LessonProgress.status`. */
export const LESSON_PROGRESS_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] as const;
export type LessonProgressStatus = (typeof LESSON_PROGRESS_STATUSES)[number];

/** Why `POST …/publish` refuses (`422 COURSE_NOT_PUBLISHABLE`, `details.missing`). */
export const PUBLISH_BLOCKERS = ['NO_MODULE', 'NO_READY_LESSON'] as const;
export type PublishBlocker = (typeof PUBLISH_BLOCKERS)[number];

/** Why a student's module or lesson is locked (PRD §8.5.2). */
export const LOCK_REASONS = ['PREVIOUS_MODULE_INCOMPLETE', 'PREVIOUS_LESSON_INCOMPLETE'] as const;
export type LockReason = (typeof LOCK_REASONS)[number];

/** Students per `POST …/enrollments` call. */
export const ENROLL_BATCH_MAX = 200;
/** A soft-deleted course is purged after 30 days (PRD §8.4.1). */
export const COURSE_PURGE_AFTER_DAYS = 30;
/** Editor polling interval of the media statuses (spec D12, until the realtime gateway). */
export const MEDIA_STATUS_POLL_MS = 5000;
/** The watermark moves every 30 s (D-O8) … */
export const WATERMARK_MOVE_MS = 30_000;
/** … between six positions. */
export const WATERMARK_POSITIONS = 6;

/**
 * Course progress (D-P8): `floor(100 × completed / total)` over the required lessons of the
 * non-optional modules, `0` when there are none, clamped to 0–100.
 */
export function courseProgressPercent(completedRequired: number, totalRequired: number): number {
  if (!(totalRequired > 0)) return 0;
  const percent = Math.floor((100 * completedRequired) / totalRequired);
  return Math.min(100, Math.max(0, percent));
}

const IF_MATCH = /^(?:W\/)?(?:"([1-9][0-9]{0,8})"|([1-9][0-9]{0,8}))$/;

/**
 * The course version an `If-Match` header names (D-P14): `"7"`, `7` or weak `W/"7"` → `7`.
 * Anything else (missing, `*`, a list, not a positive integer) → `null` (`428 VERSION_REQUIRED`).
 */
export function parseIfMatch(header: string | undefined): number | null {
  if (header === undefined) return null;
  const m = IF_MATCH.exec(header.trim());
  if (!m) return null;
  return Number(m[1] ?? m[2]);
}

/** The `ETag` of a course version: `"7"`. */
export function etagOf(version: number): string {
  return `"${version}"`;
}

const base = (origin: string, locale: Locale): string =>
  `${origin.replace(/\/+$/, '')}/${locale}/app`;

/** Teacher course editor: `{origin}/{locale}/app/w/{wid}/courses/{cid}`. */
export const courseEditorLink = (
  origin: string,
  locale: Locale,
  wid: string,
  cid: string,
): string =>
  `${base(origin, locale)}/w/${encodeURIComponent(wid)}/courses/${encodeURIComponent(cid)}`;

/** Student course outline: `{origin}/{locale}/app/courses/{cid}` (course emails, T9). */
export const studentCourseLink = (origin: string, locale: Locale, cid: string): string =>
  `${base(origin, locale)}/courses/${encodeURIComponent(cid)}`;

/** Student lesson page: `{origin}/{locale}/app/courses/{cid}/lessons/{lid}`. */
export const lessonLink = (origin: string, locale: Locale, cid: string, lid: string): string =>
  `${base(origin, locale)}/courses/${encodeURIComponent(cid)}/lessons/${encodeURIComponent(lid)}`;

/** Student « Mes cours »: `{origin}/{locale}/app/courses`. */
export const myCoursesLink = (origin: string, locale: Locale): string =>
  `${base(origin, locale)}/courses`;
