import { z } from 'zod';
import {
  COURSE_LEVELS,
  COURSE_STATUSES,
  LESSON_PROGRESS_STATUSES,
  MVP_LESSON_TYPES,
} from './course-constants';
import { LocaleSchema } from './locale';
import { MEDIA_STATUSES } from './media-constants';
import { PlaybackSchema } from './media';
import { RichTextDescriptionSchema, RichTextDocSchema } from './rich-text';
import { UnlockRuleSchema } from './structure';

/** The course card of a student (`GET /me/courses`, every workspace). */
export const MyCourseInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  coverUrl: z.string().nullable(),
  level: z.enum(COURSE_LEVELS).nullable(),
  language: LocaleSchema,
  estimatedMinutes: z.number().int().nullable(),
  status: z.enum(COURSE_STATUSES),
  workspace: z.object({ id: z.string(), name: z.string() }),
  teacher: z.object({ firstName: z.string(), lastName: z.string() }),
});

export const MyCourseSchema = z.object({
  course: MyCourseInfoSchema,
  progressPercent: z.number().int(),
  completedAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
});

export type MyCourse = z.infer<typeof MyCourseSchema>;

export const MyCoursesSchema = z.object({ items: z.array(MyCourseSchema) });

export type MyCourses = z.infer<typeof MyCoursesSchema>;

/** Why a module or lesson is locked (PRD §8.5.2), with what to finish first. */
export const LockSchema = z.discriminatedUnion('reason', [
  z.object({
    reason: z.literal('PREVIOUS_MODULE_INCOMPLETE'),
    previousModule: z.object({ id: z.string(), title: z.string(), percent: z.number().int() }),
  }),
  z.object({
    reason: z.literal('PREVIOUS_LESSON_INCOMPLETE'),
    previousLesson: z.object({ id: z.string(), title: z.string() }),
  }),
]);

export type Lock = z.infer<typeof LockSchema>;

export const MyLessonSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  type: z.enum(MVP_LESSON_TYPES),
  position: z.number().int(),
  isRequired: z.boolean(),
  estimatedMinutes: z.number().int().nullable(),
  allowDownload: z.boolean(),
  media: z
    .object({
      status: z.enum(MEDIA_STATUSES),
      durationS: z.number().int().nullable(),
      pageCount: z.number().int().nullable(),
    })
    .nullable(),
  progress: z.object({
    status: z.enum(LESSON_PROGRESS_STATUSES),
    completedAt: z.string().nullable(),
  }),
  locked: z.boolean(),
  lock: LockSchema.nullable(),
});

export type MyLesson = z.infer<typeof MyLessonSchema>;

export const MyModuleSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  position: z.number().int(),
  isOptional: z.boolean(),
  unlockRule: UnlockRuleSchema,
  percent: z.number().int(),
  locked: z.boolean(),
  lock: LockSchema.nullable(),
  lessons: z.array(MyLessonSchema),
});

export type MyModule = z.infer<typeof MyModuleSchema>;

/** `GET /me/courses/{cid}`: the outline with locks and progress; `next` = where to resume. */
export const MyCourseDetailSchema = z.object({
  course: MyCourseInfoSchema.extend({
    description: RichTextDescriptionSchema.nullable(),
    sequentialLessons: z.boolean(),
  }),
  progressPercent: z.number().int(),
  completedAt: z.string().nullable(),
  modules: z.array(MyModuleSchema),
  next: z.object({ lessonId: z.string() }).nullable(),
});

export type MyCourseDetail = z.infer<typeof MyCourseDetailSchema>;

/** `GET /me/lessons/{lid}`: `images` maps each inline image's `mediaId` to a 5-min URL. */
export const MyLessonDetailSchema = z.object({
  lesson: MyLessonSchema,
  course: z.object({ id: z.string(), title: z.string() }),
  module: z.object({ id: z.string(), title: z.string() }),
  content: RichTextDocSchema.nullable(),
  images: z.record(z.string(), z.string()),
  playback: PlaybackSchema.nullable(),
  previous: z.object({ lessonId: z.string() }).nullable(),
  next: z.object({ lessonId: z.string() }).nullable(),
});

export type MyLessonDetail = z.infer<typeof MyLessonDetailSchema>;

/** `POST /me/lessons/{lid}/opened|complete|uncomplete`. */
export const ProgressActionResultSchema = z.object({
  lesson: z.object({
    id: z.string(),
    status: z.enum(LESSON_PROGRESS_STATUSES),
    completedAt: z.string().nullable(),
  }),
  course: z.object({ progressPercent: z.number().int(), completedAt: z.string().nullable() }),
});

export type ProgressActionResult = z.infer<typeof ProgressActionResultSchema>;
