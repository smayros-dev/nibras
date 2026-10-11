import { LoginSchema, RegisterTeacherSchema, VerifyEmailSchema } from '@tt/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from './crypto/password-policy';
import { normalisePassword } from './crypto/password';

/**
 * Request password: capped here (UTF-16 length and NFKC code points, which can expand), so an
 * oversized password is a 422 `VALIDATION_FAILED` and never reaches argon2 or the policy. No
 * minimum: `PasswordPolicy` reports a short password as `PASSWORD_TOO_SHORT`.
 */
export const PasswordInputSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH)
  .refine(
    (p) => [...normalisePassword(p)].length <= PASSWORD_MAX_LENGTH,
    `Password longer than ${PASSWORD_MAX_LENGTH} characters`,
  );

export class RegisterTeacherDto extends createZodDto(
  RegisterTeacherSchema.extend({ password: PasswordInputSchema }),
) {}

export class VerifyEmailDto extends createZodDto(VerifyEmailSchema) {}

/** Same cap as registration (bounds the argon2 work), plus "not empty". */
export class LoginDto extends createZodDto(
  LoginSchema.extend({
    password: PasswordInputSchema.refine((p) => p.length > 0, 'Password required'),
  }),
) {}
