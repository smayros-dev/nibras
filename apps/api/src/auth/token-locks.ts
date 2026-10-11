import type { Prisma } from '@tt/db';

/**
 * Row-locks, in `id` order, the account tokens that password reset/change and email change
 * touch: the user's unused `PASSWORD_RESET` tokens and every `EMAIL_CHANGE_*` token. Every path
 * that writes several of them (reset issue and claim, password change, email-change request and
 * confirmation) takes this lock first, in one global order, so no two of them can deadlock. The
 * claim in `PasswordResetService.reset` uses the same predicate inside its single statement.
 */
export async function lockAccountTokens(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  userId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM verification_token
    WHERE user_id = ${userId}::uuid
      AND ((purpose = 'PASSWORD_RESET' AND used_at IS NULL)
        OR purpose IN ('EMAIL_CHANGE_OLD', 'EMAIL_CHANGE_NEW'))
    ORDER BY id
    FOR UPDATE`;
}
