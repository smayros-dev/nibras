import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { MeUser } from '@tt/contracts';
import type { GuardedClient } from '@tt/db';
import type { Response } from 'express';
import { RequestContext, type AuthUser } from '../common/request-context';
import { DB } from '../db/db.module';
import { AllowUnverified } from './decorators/allow-unverified';
import { CurrentUser } from './decorators/current-user';
import { ChangePasswordDto, EmailChangeRequestDto } from './dto';
import { EmailChangeService } from './email-change.service';
import { toMeUser } from './me-user';
import { PasswordResetService } from './password-reset.service';
import { withRetryAfter } from './rate-window';

/**
 * Placeholder `GET /me` (Task 7): `{ user }`, reachable before email verification. Task 11
 * replaces it with the `me` module (profile, consents, computed `twoFactor.required` and
 * `pendingConsents`) and moves the password and email-change routes (Task 9) there.
 */
@Controller('me')
export class MeController {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'user'>,
    private readonly passwords: PasswordResetService,
    private readonly emailChange: EmailChangeService,
  ) {}

  @AllowUnverified()
  @Get()
  async me(@CurrentUser() current: AuthUser): Promise<{ user: MeUser }> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: current.id } });
    return { user: toMeUser(user, { twoFactorRequired: false, pendingConsents: [] }) };
  }

  /**
   * Wrong current password → `401 INVALID_CREDENTIALS`, too many → `429 RATE_LIMITED` with
   * `Retry-After`; every OTHER session is revoked.
   */
  @Patch('password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await withRetryAfter(res, () =>
      this.passwords.change(
        user,
        RequestContext.get()?.session?.id,
        body.currentPassword,
        body.newPassword,
      ),
    );
    return { ok: true };
  }

  /**
   * `202 {}`: a confirmation link goes to the current and to the new address. Rate limits →
   * `429 RATE_LIMITED` with `Retry-After`.
   */
  @Post('email-change')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestEmailChange(
    @CurrentUser() user: AuthUser,
    @Body() body: EmailChangeRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, never>> {
    await withRetryAfter(res, () => this.emailChange.request(user, body));
    return {};
  }
}
