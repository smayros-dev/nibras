import { z } from 'zod';
import {
  COURSE_STATUSES,
  ENROLL_BATCH_MAX,
  ENROLLMENT_SOURCES,
  ENROLLMENT_STATUSES,
} from './course-constants';

export const ENROLLMENTS_PAGE_MAX = 100;
export const ENROLLMENTS_PAGE_DEFAULT = 50;

/**
 * `POST …/courses/{cid}/enrollments` (`enrollment.manage`): STUDENT memberships of the workspace;
 * a REVOKED enrollment turns ACTIVE again (progress kept), an ACTIVE one is unchanged.
 */
export const EnrollStudentsSchema = z
  .object({
    studentUserIds: z
      .array(z.uuid())
      .min(1)
      .max(ENROLL_BATCH_MAX)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate ids' }),
  })
  .strict();

export type EnrollStudentsInput = z.infer<typeof EnrollStudentsSchema>;

export const EnrollResultSchema = z.object({
  items: z.array(
    z.object({ studentUserId: z.string(), status: z.literal('ACTIVE'), created: z.boolean() }),
  ),
});

export type EnrollResult = z.infer<typeof EnrollResultSchema>;

/** `DELETE …/courses/{cid}/enrollments/{uid}` (optional body). */
export const RevokeEnrollmentSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();

export type RevokeEnrollmentInput = z.infer<typeof RevokeEnrollmentSchema>;

/** One enrolled student (`GET …/enrollments`, `GET …/progress`). */
export const EnrollmentSummarySchema = z.object({
  studentUserId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  status: z.enum(ENROLLMENT_STATUSES),
  source: z.enum(ENROLLMENT_SOURCES),
  activatedAt: z.string(),
  revokedAt: z.string().nullable(),
  progressPercent: z.number().int(),
  completedAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
});

export type EnrollmentSummary = z.infer<typeof EnrollmentSummarySchema>;

export const EnrollmentsQuerySchema = z.object({
  status: z.enum(ENROLLMENT_STATUSES).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(ENROLLMENTS_PAGE_MAX).default(ENROLLMENTS_PAGE_DEFAULT),
});

export type EnrollmentsQuery = z.infer<typeof EnrollmentsQuerySchema>;

export const EnrollmentsPageSchema = z.object({
  items: z.array(EnrollmentSummarySchema),
  nextCursor: z.string().nullable(),
});

export type EnrollmentsPage = z.infer<typeof EnrollmentsPageSchema>;

/** A course of a student, as SP2's student list and profile show it (`courses`). */
export const StudentCourseSchema = z.object({
  courseId: z.string(),
  title: z.string(),
  status: z.enum(COURSE_STATUSES),
  enrollmentStatus: z.enum(ENROLLMENT_STATUSES),
  progressPercent: z.number().int(),
  completedAt: z.string().nullable(),
});

export type StudentCourse = z.infer<typeof StudentCourseSchema>;
