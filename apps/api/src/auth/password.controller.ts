import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { EmailChangeConfirmResponse } from '@nibras/contracts';
import { Public } from './decorators/public';
import { EmailChangeConfirmDto, ForgotPasswordDto, ResetPasswordDto } from './dto';
import { EmailChangeService } from './email-change.service';
import { PasswordResetService } from './password-reset.service';

/**
 * The public halves of password reset and email change (the links open without a session). The
 * signed-in halves (`PATCH /me/password`, `POST /me/email-change`) live on `MeController`.
 */
@Controller('auth')
export class PasswordController {
  constructor(
    private readonly passwords: PasswordResetService,
    private readonly emailChange: EmailChangeService,
  ) {}

  /** Always `202 {}`: whether the account exists is never revealed (AC-AUTH-06). */
  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgot(@Body() body: ForgotPasswordDto): Promise<Record<string, never>> {
    await this.passwords.forgot(body.email);
    return {};
  }

  /** Used, expired or unknown link → `410 TOKEN_INVALID`; all sessions are revoked on success. */
  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  async reset(@Body() body: ResetPasswordDto): Promise<{ ok: true }> {
    await this.passwords.reset(body.token, body.newPassword);
    return { ok: true };
  }

  /** `{ pending: 'OLD' | 'NEW' }` until both links are confirmed, then `{ pending: null }`. */
  @Public()
  @Post('email-change/confirm')
  @HttpCode(HttpStatus.OK)
  confirmEmailChange(@Body() body: EmailChangeConfirmDto): Promise<EmailChangeConfirmResponse> {
    return this.emailChange.confirm(body.token);
  }
}
