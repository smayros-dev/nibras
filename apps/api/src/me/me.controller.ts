import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import type {
  ConsentRecord,
  MeUser,
  MyWorkspace,
  TeacherVerification,
  WorkspaceDetail,
} from '@tt/contracts';
import { AllowUnverified } from '../auth/decorators/allow-unverified';
import { CurrentUser } from '../auth/decorators/current-user';
import { ChangePasswordDto, EmailChangeRequestDto } from '../auth/dto';
import { EmailChangeService } from '../auth/email-change.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { RequestContext, type AuthUser } from '../common/request-context';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { ConsentService, consentMeta } from './consent.service';
import {
  ConsentTypeParamDto,
  GrantConsentDto,
  PhoneOtpRequestDto,
  PhoneOtpVerifyDto,
  UpdateMeDto,
} from './dto';
import { MeService } from './me.service';
import { PhoneService } from './phone.service';
import { VerificationService } from './verification.service';

/**
 * The signed-in user's own aggregates (`/me`, PRD §15.13): profile, consents, workspaces, the
 * signed-in halves of password change and email change (Task 9), phone verification and the
 * teacher verification status (Task 12).
 */
@Controller('me')
export class MeController {
  constructor(
    private readonly profile: MeService,
    private readonly consents: ConsentService,
    private readonly passwords: PasswordResetService,
    private readonly emailChange: EmailChangeService,
    private readonly phone: PhoneService,
    private readonly verification: VerificationService,
    private readonly workspaceService: WorkspacesService,
  ) {}

  /**
   * The profile, reachable before email verification, pending consents or a mandatory 2FA setup
   * (`pendingConsents` and `twoFactor` tell the client which gate to show).
   */
  @AllowUnverified()
  @Get()
  me(@CurrentUser() user: AuthUser): Promise<MeUser> {
    return this.profile.me(user.id);
  }

  /** Name, locale, time zone, birth date; invalid values → `422 VALIDATION_FAILED`. */
  @Patch()
  @HttpCode(HttpStatus.OK)
  update(@CurrentUser() user: AuthUser, @Body() body: UpdateMeDto): Promise<MeUser> {
    return this.profile.update(user.id, body);
  }

  /** Memberships across workspaces (REMOVED / REJECTED excluded), by workspace name. */
  @Get('workspaces')
  workspaces(@CurrentUser() user: AuthUser): Promise<MyWorkspace[]> {
    return this.profile.workspaces(user.id);
  }

  /**
   * `201`: the caller's PERSONAL workspace (`Espace de {prénom}`, 20 GiB), for a teacher who
   * joined by invitation (D-O7, AC-WS-08). Already owns one → `409 PERSONAL_WORKSPACE_EXISTS`;
   * an organisation where the caller is an ACTIVE TEACHER/ADMIN forbids personal workspaces →
   * `403 PERSONAL_WORKSPACE_FORBIDDEN` with `details: { organizationId, organizationName }`.
   */
  @Post('personal-workspace')
  @HttpCode(HttpStatus.CREATED)
  createPersonalWorkspace(@CurrentUser() user: AuthUser): Promise<WorkspaceDetail> {
    return this.workspaceService.createPersonalForInvitedTeacher(user);
  }

  /** Granted account-level consents, newest first. */
  @Get('consents')
  listConsents(@CurrentUser() user: AuthUser): Promise<ConsentRecord[]> {
    return this.consents.list(user.id);
  }

  /**
   * `201`: accepts the current version of a consent (idempotent). Exempt from the account gates:
   * it is how a user blocked by `403 CONSENT_REQUIRED` gets through. Another version →
   * `422 CONSENT_VERSION_MISMATCH` (`details.expected`).
   */
  @AllowUnverified()
  @Post('consents/:type')
  @HttpCode(HttpStatus.CREATED)
  async grantConsent(
    @CurrentUser() user: AuthUser,
    @Param() params: ConsentTypeParamDto,
    @Body() body: GrantConsentDto,
  ): Promise<void> {
    await this.consents.grant(user, params.type, body.version, consentMeta());
  }

  /** `204`; only MARKETING may be withdrawn (`422 CONSENT_NOT_REVOCABLE` otherwise). */
  @Post('consents/:type/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeConsent(
    @CurrentUser() user: AuthUser,
    @Param() params: ConsentTypeParamDto,
  ): Promise<void> {
    await this.consents.revoke(user, params.type);
  }

  /**
   * Wrong current password → `401 INVALID_CREDENTIALS`, too many → `429 RATE_LIMITED`
   * (`details.retryAfterS`, `Retry-After`); every OTHER session is revoked.
   */
  @Patch('password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    await this.passwords.change(
      user,
      RequestContext.get()?.session?.id,
      body.currentPassword,
      body.newPassword,
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
  ): Promise<Record<string, never>> {
    await this.emailChange.request(user, body);
    return {};
  }

  /**
   * `202 {}`: a 6-digit code goes by SMS to `phoneE164` (E.164, valid for its country, else
   * `422 VALIDATION_FAILED`), replacing any pending one; outside production it is also emailed.
   * One request per minute per user (`429 RATE_LIMITED`, `Retry-After`).
   */
  @Post('phone/request-otp')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPhoneOtp(
    @CurrentUser() user: AuthUser,
    @Body() body: PhoneOtpRequestDto,
  ): Promise<Record<string, never>> {
    await this.phone.request(user, body.phoneE164);
    return {};
  }

  /**
   * `200 MeUser` with the verified `phoneE164`/`phoneVerifiedAt`. Wrong code →
   * `422 OTP_INVALID`; no pending code, expired, or past 5 attempts → `410 OTP_EXPIRED`.
   */
  @Post('phone/verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyPhoneOtp(
    @CurrentUser() user: AuthUser,
    @Body() body: PhoneOtpVerifyDto,
  ): Promise<MeUser> {
    await this.phone.verify(user, body.otpCode);
    return this.profile.me(user.id);
  }

  /**
   * Teacher verification status (D-O6): which of EMAIL, PHONE, CODE_OF_CONDUCT are still
   * `missing` (the same list `403 TEACHER_NOT_VERIFIED` carries). Reachable before email
   * verification and pending consents, so the verification page can show every step.
   */
  @AllowUnverified()
  @Get('verification')
  verificationStatus(@CurrentUser() user: AuthUser): Promise<TeacherVerification> {
    return this.verification.status(user);
  }
}
