import type { TeacherVerificationStep } from '@nibras/contracts';

/** `409` codes about the invited address: shown on the email field. */
export const EMAIL_CONFLICTS: readonly string[] = ['ALREADY_MEMBER', 'INVITATION_PENDING'];

/** The labels of the verification steps (`403 TEACHER_NOT_VERIFIED` `details.missing`). */
export const VERIFICATION_STEP_LABELS: Record<TeacherVerificationStep, string> = {
  EMAIL: 'settings.verification.email',
  PHONE: 'settings.verification.phone',
  CODE_OF_CONDUCT: 'settings.verification.coc',
};

/**
 * The missing verification steps of a `403 TEACHER_NOT_VERIFIED` body (D-O6: inviting needs a
 * verified teacher), unknown steps dropped; `null` for any other error.
 */
export function missingVerificationSteps(error: unknown): TeacherVerificationStep[] | null {
  const body = error as { code?: string; details?: { missing?: unknown } } | null | undefined;
  if (body?.code !== 'TEACHER_NOT_VERIFIED') return null;
  return Array.isArray(body.details?.missing)
    ? (body.details.missing as TeacherVerificationStep[]).filter(
        (step) => step in VERIFICATION_STEP_LABELS,
      )
    : [];
}
