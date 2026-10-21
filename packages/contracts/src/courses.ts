import { z } from 'zod';
import { COURSE_LEVELS, COURSE_STATUSES, PUBLISH_BLOCKERS } from './course-constants';
import { LocaleSchema } from './locale';
import { RichTextDescriptionSchema } from './rich-text';

export const COURSES_PAGE_MAX = 100;
export const COURSES_PAGE_DEFAULT = 50;

const courseFields = {
  title: z.string().trim().min(1).max(200),
  description: RichTextDescriptionSchema.optional(),
  category: z.string().trim().max(60).optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  language: LocaleSchema,
  /** Override of the derived duration; `null` = derived from the lessons. */
  estimatedMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  sequentialLessons: z.boolean().optional(),
  /** A READY `IMAGE` asset of the workspace (checked by the service); `null` clears it. */
  coverMediaId: z.uuid().nullable().optional(),
};

/**
 * `POST /workspaces/{wid}/courses` (`course.create`): a `DRAFT` owned by the caller;
 * `sequentialLessons` defaults to the workspace's `default_sequential_lessons` (service side).
 */
export const CreateCourseSchema = z
  .object({ ...courseFields, language: LocaleSchema.default('fr') })
  .strict();

export type CreateCourseInput = z.infer<typeof CreateCourseSchema>;

/** `PATCH …/courses/{cid}` (`If-Match` required): any field of the create body, at least one. */
export const UpdateCourseSchema = z
  .object({
    ...courseFields,
    title: courseFields.title.optional(),
    /** `null` clears the level (« Non précisé »). */
    level: z.enum(COURSE_LEVELS).nullable().optional(),
    language: LocaleSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export type UpdateCourseInput = z.infer<typeof UpdateCourseSchema>;

/** `GET /workspaces/{wid}/courses` (`course.manage`; own scope → the caller's courses). */
export const CoursesQuerySchema = z.object({
  status: z.enum(COURSE_STATUSES).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(COURSES_PAGE_MAX).default(COURSES_PAGE_DEFAULT),
});

export type CoursesQuery = z.infer<typeof CoursesQuerySchema>;

/** One course of the teacher's list. Dates are ISO strings. */
export const CourseSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(COURSE_STATUSES),
  level: z.enum(COURSE_LEVELS).nullable(),
  language: LocaleSchema,
  category: z.string().nullable(),
  /** 5-minute signed URL of the cover image. */
  coverUrl: z.string().nullable(),
  ownerUserId: z.string(),
  owner: z.object({ firstName: z.string(), lastName: z.string() }),
  /** The override when set, else the sum of the lessons' durations. */
  estimatedMinutes: z.number().int().nullable(),
  moduleCount: z.number().int(),
  lessonCount: z.number().int(),
  enrolledCount: z.number().int(),
  publishedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CourseSummary = z.infer<typeof CourseSummarySchema>;

/** `nextCursor` is `null` on the last page. */
export const CoursesPageSchema = z.object({
  items: z.array(CourseSummarySchema),
  nextCursor: z.string().nullable(),
});

export type CoursesPage = z.infer<typeof CoursesPageSchema>;

/** `GET …/courses/{cid}` (with `ETag: "<version>"`). */
export const CourseDetailSchema = CourseSummarySchema.extend({
  description: RichTextDescriptionSchema.nullable(),
  /** The stored override (`null` = derived), as the settings form edits it. */
  estimatedMinutesOverride: z.number().int().nullable(),
  coverMediaId: z.string().nullable(),
  sequentialLessons: z.boolean(),
  isCertifying: z.boolean(),
  deletedAt: z.null(),
  canPublish: z.boolean(),
  publishBlockers: z.array(z.enum(PUBLISH_BLOCKERS)),
});

export type CourseDetail = z.infer<typeof CourseDetailSchema>;

/** `POST …/courses/{cid}/reassign` (`course.reassign`, organisations only). */
export const ReassignCourseSchema = z.object({ ownerUserId: z.uuid() }).strict();

export type ReassignCourseInput = z.infer<typeof ReassignCourseSchema>;

/** `publish` / `unpublish` / `archive` / `restore` answer the updated course. */
export const PublishResultSchema = CourseDetailSchema;

export type PublishResult = CourseDetail;
