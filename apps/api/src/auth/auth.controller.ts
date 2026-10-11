import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { MeUser } from '@tt/contracts';
import { RequestContext, type AuthUser } from '../common/request-context';
import { AllowUnverified } from './decorators/allow-unverified';
import { CurrentUser } from './decorators/current-user';
import { Public } from './decorators/public';
import { RegisterTeacherDto, VerifyEmailDto } from './dto';
import { EmailVerificationService } from './email-verification.service';
import { toMeUser } from './me-user';
import { RegisterService } from './register.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly registration: RegisterService,
    private readonly verification: EmailVerificationService,
  ) {}

  /**
   * `201 { user }`. The auth cookies are set once Task 7's `SessionService` exists; until then the
   * client logs in after registering.
   */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() body: RegisterTeacherDto): Promise<{ user: MeUser }> {
    const store = RequestContext.get();
    const { user } = await this.registration.registerTeacher(body, {
      ip: store?.ip ?? '',
      userAgent: store?.userAgent ?? '',
    });
    // Just registered: TERMS + PRIVACY granted at their current versions, no 2FA-requiring role.
    return { user: toMeUser(user, { twoFactorRequired: false, pendingConsents: [] }) };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() body: VerifyEmailDto): Promise<{ ok: true }> {
    await this.verification.verify(body.token);
    return { ok: true };
  }

  @AllowUnverified()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(@CurrentUser() user: AuthUser): Promise<{ ok: true }> {
    await this.verification.resend(user);
    return { ok: true };
  }
}
