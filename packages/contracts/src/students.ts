import { z } from 'zod';
import { GuardianInfoSchema } from './guardian';
import { GUARDIAN_LINK_STATUSES, GUARDIAN_RELATIONSHIPS } from './invite-constants';
import { InviteEmailSchema, PersonNameSchema } from './invitations';
import { LocaleSchema } from './locale';
import { MEMBERSHIP_STATUSES } from './member-statuses';

export const STUDENTS_PAGE_MAX = 100;
export const STUDENTS_PAGE_DEFAULT = 50;

/**
 * `GET /workspaces/{wid}/students` query (`student.read`): without `status`, every status but
 * `REMOVED` / `REJECTED`; `q` as on members; `cursor` = the previous page's opaque `nextCursor`.
 */
export const StudentsQuerySchema = z.object({
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(STUDENTS_PAGE_MAX).default(STUDENTS_PAGE_DEFAULT),
});

export type StudentsQuery = z.infer<typeof StudentsQuerySchema>;

/**
 * One student of the workspace. `email` and `guardian.email` only with scope `all` (or, for the
 * guardian email, students the caller invited). The `null` / `[]` members are filled by later
 * sub-projects (courses, progress, attendance).
 */
export const StudentSummarySchema = z.object({
  userId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().optional(),
  status: z.enum(MEMBERSHIP_STATUSES),
  joinedAt: z.string().nullable(),
  invitedByUserId: z.string().nullable(),
  isMinor: z.boolean(),
  guardian: GuardianInfoSchema.extend({ email: z.string().optional() }).nullable(),
  progressPercent: z.number().nullable(),
  attendanceRate: z.number().nullable(),
  lastActivityAt: z.string().nullable(),
  courses: z.array(z.unknown()),
});

export type StudentSummary = z.infer<typeof StudentSummarySchema>;

/** `nextCursor` is `null` on the last page. */
export const StudentsPageSchema = z.object({
  items: z.array(StudentSummarySchema),
  nextCursor: z.string().nullable(),
});

export type StudentsPage = z.infer<typeof StudentsPageSchema>;

/**
 * `GET /workspaces/{wid}/students/{uid}/profile` (`student.read`): the skeleton the later
 * sub-projects extend (`courses`, `progress`, `sessions`, `attendance`, `reports`, `activity`).
 */
export const StudentProfileSchema = z.object({
  user: z.object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().optional(),
    locale: LocaleSchema,
    timezone: z.string(),
    isMinor: z.boolean(),
  }),
  membership: z.object({
    status: z.enum(MEMBERSHIP_STATUSES),
    joinedAt: z.string().nullable(),
    invitedBy: PersonNameSchema.nullable(),
    removedAt: z.string().nullable(),
  }),
  guardian: z
    .object({
      email: z.string().optional(),
      emailMasked: z.string(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      relationship: z.enum(GUARDIAN_RELATIONSHIPS).nullable(),
      status: z.enum(GUARDIAN_LINK_STATUSES),
      grantedAt: z.string().nullable(),
      consentExpiresAt: z.string().nullable(),
      revokedAt: z.string().nullable(),
    })
    .nullable(),
  assignedTeachers: z.array(PersonNameSchema.extend({ userId: z.string() })),
  courses: z.array(z.unknown()),
  progress: z.null(),
  sessions: z.array(z.unknown()),
  attendance: z.null(),
  reports: z.array(z.unknown()),
  activity: z.array(z.unknown()),
});

export type StudentProfile = z.infer<typeof StudentProfileSchema>;

/** `PATCH /workspaces/{wid}/students/{uid}` (`student.update`): a minor's guardian email only. */
export const UpdateStudentSchema = z
  .object({ guardianEmail: InviteEmailSchema.optional() })
  .strict();

export type UpdateStudentInput = z.infer<typeof UpdateStudentSchema>;
