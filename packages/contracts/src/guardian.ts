import { z } from 'zod';
import { GUARDIAN_LINK_STATUSES, GUARDIAN_RELATIONSHIPS } from './invite-constants';
import { PersonNameSchema, WorkspaceRefSchema } from './invitations';

/** Version of the parental consent text a `GUARDIAN_PARENTAL` `Consent` row records. */
export const GUARDIAN_CONSENT_VERSION = 'guardian-2026-10';

const NameSchema = z.string().trim().min(1).max(80);

const GuardianIdentityShape = {
  guardianFirstName: NameSchema,
  guardianLastName: NameSchema,
  relationship: z.enum(GUARDIAN_RELATIONSHIPS),
  acceptNotice: z.boolean().optional(),
};

const NOTICE_REQUIRED = {
  message: 'The minors notice must be accepted to grant consent',
  path: ['acceptNotice'],
};

/**
 * Public `POST /guardian-consent/{token}`: grant or refuse. A grant requires the minors notice
 * (`acceptNotice: true`); a refusal does not.
 */
export const GuardianDecisionSchema = z
  .object({ decision: z.enum(['GRANT', 'REFUSE']), ...GuardianIdentityShape })
  .strict()
  .refine((v) => v.decision === 'REFUSE' || v.acceptNotice === true, NOTICE_REQUIRED);

export type GuardianDecisionInput = z.infer<typeof GuardianDecisionSchema>;

/** Public `POST /guardian/{token}/grant`: a re-grant after a revocation (notice required). */
export const GuardianRegrantSchema = z
  .object(GuardianIdentityShape)
  .strict()
  .refine((v) => v.acceptNotice === true, NOTICE_REQUIRED);

export type GuardianRegrantInput = z.infer<typeof GuardianRegrantSchema>;

/**
 * Public `POST /guardian-consent/{token}` answer: a grant carries the long-lived guardian page
 * (`/{locale}/guardian/{token}`: sessions, revoke), also emailed to the guardian; a refusal none.
 */
export const GuardianDecisionResultSchema = z.object({
  decision: z.enum(['GRANT', 'REFUSE']),
  guardianPageUrl: z.string().optional(),
});

export type GuardianDecisionResult = z.infer<typeof GuardianDecisionResultSchema>;

/** Public `POST /guardian/{token}/grant` answer: the new guardian page (the previous one is dead). */
export const GuardianRegrantResultSchema = z.object({ guardianPageUrl: z.string() });

export type GuardianRegrantResult = z.infer<typeof GuardianRegrantResultSchema>;

/** Public `GET /guardian-consent/{token}`: a pending request (a decided one is `409`). */
export const GuardianConsentPreviewSchema = z.object({
  student: PersonNameSchema,
  workspace: z.object({ name: z.string(), type: z.enum(['PERSONAL', 'ORGANIZATION']) }),
  teacher: PersonNameSchema,
  expiresAt: z.string(),
  version: z.string(),
  noticeUrl: z.string(),
  state: z.enum(['PENDING']),
});

export type GuardianConsentPreview = z.infer<typeof GuardianConsentPreviewSchema>;

/** Public `GET /guardian/{token}`: one (student, workspace) link, never another workspace. */
export const GuardianViewSchema = z.object({
  student: PersonNameSchema,
  workspace: WorkspaceRefSchema,
  teacher: PersonNameSchema,
  link: z.object({
    status: z.enum(GUARDIAN_LINK_STATUSES),
    grantedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    relationship: z.enum(GUARDIAN_RELATIONSHIPS).nullable(),
  }),
  /** SP5 replaces this with its session summaries. */
  sessions: z.array(z.unknown()),
});

export type GuardianView = z.infer<typeof GuardianViewSchema>;

/** The guardian of a student membership, as the student (`/me/workspaces`) or a teacher sees it. */
export const GuardianInfoSchema = z.object({
  emailMasked: z.string(),
  status: z.enum(GUARDIAN_LINK_STATUSES),
  consentExpiresAt: z.string().nullable(),
});

export type GuardianInfo = z.infer<typeof GuardianInfoSchema>;
