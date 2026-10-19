import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './error-codes';
import {
  AcceptInvitationSchema,
  CreateInvitationSchema,
  InvitationsQuerySchema,
} from './invitations';
import { AcceptJoinSchema, UpdateInviteLinkSchema } from './invite-links';

const REGISTER = {
  mode: 'REGISTER',
  firstName: 'Ahmed',
  lastName: 'Ben Ali',
  password: 'correct-horse-battery',
  locale: 'fr',
  timezone: 'Africa/Tunis',
  acceptTerms: true,
  acceptPrivacy: true,
};

const SP2_ERROR_CODES = [
  'INVITATION_PENDING',
  'INVITATION_EXPIRED',
  'INVITATION_REVOKED',
  'INVITATION_ALREADY_ACCEPTED',
  'INVITATION_EMAIL_MISMATCH',
  'INVITATION_ROLE_NOT_ALLOWED',
  'BIRTH_DATE_REQUIRED',
  'GUARDIAN_EMAIL_REQUIRED',
  'GUARDIAN_EMAIL_INVALID',
  'GUARDIAN_CONSENT_REQUIRED',
  'CONSENT_LINK_EXPIRED',
  'CONSENT_ALREADY_DECIDED',
  'GUARDIAN_LINK_INACTIVE',
  'INVITE_LINK_EXHAUSTED',
  'INVITE_LINK_EXPIRED',
  'INVITE_LINK_DISABLED',
  'MEMBERSHIP_NOT_PENDING',
  'IMPORT_TOO_LARGE',
  'IMPORT_NO_VALID_ROWS',
  'IMPORT_IN_PROGRESS',
];

it('ERROR_CODES ends with the 20 SP2 codes, in order, without duplicates', () => {
  expect(ERROR_CODES.slice(-SP2_ERROR_CODES.length)).toEqual(SP2_ERROR_CODES);
  expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
});

describe('invitation schemas', () => {
  it('CreateInvitationSchema lower-cases the email and applies the defaults', () => {
    const parsed = CreateInvitationSchema.parse({ email: '  Ahmed@Example.COM ' });
    expect(parsed).toEqual({ email: 'ahmed@example.com', role: 'STUDENT', courseIds: [] });
  });

  it('CreateInvitationSchema refuses guardianEmail === email and an unknown key', () => {
    const same = CreateInvitationSchema.safeParse({
      email: 'kid@example.com',
      guardianEmail: 'KID@example.com',
    });
    expect(same.success).toBe(false);
    expect(same.error?.issues[0]?.path).toEqual(['guardianEmail']);
    expect(CreateInvitationSchema.safeParse({ email: 'a@b.tn', admin: true }).success).toBe(false);
    expect(CreateInvitationSchema.safeParse({ email: 'a@b.tn', role: 'OWNER' }).success).toBe(
      false,
    );
  });

  it('AcceptInvitationSchema: REGISTER requires acceptTerms true; JOIN refuses a password', () => {
    expect(AcceptInvitationSchema.safeParse(REGISTER).success).toBe(true);
    expect(AcceptInvitationSchema.safeParse({ ...REGISTER, acceptTerms: false }).success).toBe(
      false,
    );
    expect(AcceptInvitationSchema.safeParse({ mode: 'JOIN' }).success).toBe(true);
    expect(
      AcceptInvitationSchema.safeParse({ mode: 'JOIN', password: 'x'.repeat(12) }).success,
    ).toBe(false);
    // An invitation is bound to its address: REGISTER carries no email.
    expect(AcceptInvitationSchema.safeParse({ ...REGISTER, email: 'a@b.tn' }).success).toBe(false);
  });

  it('AcceptJoinSchema REGISTER additionally requires the email', () => {
    expect(AcceptJoinSchema.safeParse(REGISTER).success).toBe(false);
    const parsed = AcceptJoinSchema.parse({ ...REGISTER, email: ' A@B.tn ' });
    expect(parsed.mode === 'REGISTER' && parsed.email).toBe('a@b.tn');
    expect(
      AcceptJoinSchema.safeParse({ ...REGISTER, email: 'a@b.tn', role: 'ADMIN' }).success,
    ).toBe(false);
  });

  it('InvitationsQuerySchema coerces the limit; UpdateInviteLinkSchema needs one key', () => {
    expect(InvitationsQuerySchema.parse({ limit: '20' }).limit).toBe(20);
    expect(InvitationsQuerySchema.parse({}).limit).toBe(50);
    expect(UpdateInviteLinkSchema.safeParse({}).success).toBe(false);
    expect(UpdateInviteLinkSchema.safeParse({ status: 'DISABLED' }).success).toBe(true);
    expect(UpdateInviteLinkSchema.safeParse({ status: 'EXHAUSTED' }).success).toBe(false);
  });
});
