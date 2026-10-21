import { z } from 'zod';
import { COURSE_STATUSES, MVP_LESSON_TYPES } from './course-constants';
import { MEDIA_FAILURE_REASONS, MEDIA_KINDS, MEDIA_STATUSES } from './media-constants';
import { RichTextDocSchema } from './rich-text';

/** Module unlock rule (PRD §8.5.2); the P1 types (`AFTER_DATE`, …) are refused. */
export const UnlockRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NONE') }).strict(),
  z.object({ type: z.literal('PREVIOUS_MODULE_COMPLETED') }).strict(),
]);

export type UnlockRule = z.infer<typeof UnlockRuleSchema>;

const Title = z.string().trim().min(1).max(200);
const Description = z.string().trim().max(2000).nullable();
const Minutes = z.number().int().min(0).max(100_000).nullable();

const nonEmpty = (v: object) => Object.keys(v).length > 0;

/** `POST …/courses/{cid}/modules` (appended at the end). */
export const CreateModuleSchema = z
  .object({
    title: Title,
    description: Description.optional(),
    isOptional: z.boolean().optional(),
    unlockRule: UnlockRuleSchema.default({ type: 'NONE' }),
  })
  .strict();

export type CreateModuleInput = z.infer<typeof CreateModuleSchema>;

/** `PATCH …/modules/{mid}` (`If-Match` = course version). */
export const UpdateModuleSchema = z
  .object({
    title: Title.optional(),
    description: Description.optional(),
    isOptional: z.boolean().optional(),
    unlockRule: UnlockRuleSchema.optional(),
  })
  .strict()
  .refine(nonEmpty, { message: 'Nothing to update' });

export type UpdateModuleInput = z.infer<typeof UpdateModuleSchema>;

/**
 * `POST …/courses/{cid}/modules/reorder` and `…/modules/{mid}/lessons/reorder`: the full ordered
 * set of ids (the service checks it is exactly the current set), no duplicates.
 */
export const ReorderSchema = z
  .object({
    ids: z
      .array(z.uuid())
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate ids' }),
  })
  .strict();

export type ReorderInput = z.infer<typeof ReorderSchema>;

const lessonFields = {
  title: Title,
  description: Description.optional(),
  isRequired: z.boolean().optional(),
  estimatedMinutes: Minutes.optional(),
};

/**
 * `POST …/modules/{mid}/lessons` (appended at the end): the content is set by type — VIDEO / PDF
 * a `mediaAssetId` of the workspace (kind checked by the service), TEXT a rich-text `content`.
 * `allowDownload` defaults to the workspace's `default_pdf_download` (service side).
 */
export const CreateLessonSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('VIDEO'), ...lessonFields, mediaAssetId: z.uuid() }).strict(),
  z
    .object({
      type: z.literal('PDF'),
      ...lessonFields,
      mediaAssetId: z.uuid(),
      allowDownload: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal('TEXT'), ...lessonFields, content: RichTextDocSchema }).strict(),
]);

export type CreateLessonInput = z.infer<typeof CreateLessonSchema>;

/**
 * `PATCH …/lessons/{lid}` (`If-Match` = course version): the type is immutable; a field foreign
 * to the lesson's type (`content` on a VIDEO, `allowDownload` on a TEXT, …) is a `422` from the
 * service.
 */
export const UpdateLessonSchema = z
  .object({
    title: Title.optional(),
    description: Description.optional(),
    isRequired: z.boolean().optional(),
    estimatedMinutes: Minutes.optional(),
    mediaAssetId: z.uuid().optional(),
    allowDownload: z.boolean().optional(),
    content: RichTextDocSchema.optional(),
  })
  .strict()
  .refine(nonEmpty, { message: 'Nothing to update' });

export type UpdateLessonInput = z.infer<typeof UpdateLessonSchema>;

/** The media of a VIDEO / PDF lesson as the editor shows it. */
export const LessonMediaSchema = z.object({
  id: z.string(),
  kind: z.enum(MEDIA_KINDS),
  status: z.enum(MEDIA_STATUSES),
  failureReason: z.enum(MEDIA_FAILURE_REASONS).nullable(),
  durationS: z.number().int().nullable(),
  pageCount: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  thumbnailUrl: z.string().nullable(),
});

export type LessonMedia = z.infer<typeof LessonMediaSchema>;

export const LessonSummarySchema = z.object({
  id: z.string(),
  moduleId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  type: z.enum(MVP_LESSON_TYPES),
  position: z.number().int(),
  isRequired: z.boolean(),
  estimatedMinutes: z.number().int().nullable(),
  allowDownload: z.boolean(),
  mediaAssetId: z.string().nullable(),
  media: LessonMediaSchema.nullable(),
  hasContent: z.boolean(),
  version: z.number().int(),
});

export type LessonSummary = z.infer<typeof LessonSummarySchema>;

export const ModuleWithLessonsSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  position: z.number().int(),
  isOptional: z.boolean(),
  unlockRule: UnlockRuleSchema,
  version: z.number().int(),
  lessons: z.array(LessonSummarySchema),
});

export type ModuleWithLessons = z.infer<typeof ModuleWithLessonsSchema>;

/** `GET …/courses/{cid}/structure` (with `ETag: "<course version>"`). */
export const CourseStructureSchema = z.object({
  courseId: z.string(),
  version: z.number().int(),
  status: z.enum(COURSE_STATUSES),
  sequentialLessons: z.boolean(),
  modules: z.array(ModuleWithLessonsSchema),
});

export type CourseStructure = z.infer<typeof CourseStructureSchema>;

/** Teacher-side `GET` of one lesson: `images` maps each inline image's `mediaId` to a 5-min URL. */
export const LessonDetailSchema = LessonSummarySchema.extend({
  content: RichTextDocSchema.nullable(),
  images: z.record(z.string(), z.string()),
});

export type LessonDetail = z.infer<typeof LessonDetailSchema>;
