import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type {
  LoginResponse,
  MeUser,
  SessionSummary,
  TwoFactorRecoveryCodes,
  TwoFactorSetupResponse,
} from '@nibras/contracts';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { RequestContext, type AuthUser } from '../common/request-context';
import { ConsentService } from '../me/consent.service';
import { AuthService, type LoginResult } from './auth.service';
import {
  accessTokenOf,
  clearAuthCookies,
  cookieOf,
  REFRESH_COOKIE,
  setAuthCookies,
} from './cookies';
import { AllowUnverified } from './decorators/allow-unverified';
import { CurrentUser, currentUser } from './decorators/current-user';
import { Public, PublicWithChallenge } from './decorators/public';
import {
  LoginDto,
  RegisterTeacherDto,
  TwoFactorDisableDto,
  TwoFactorRecoveryDto,
  TwoFactorVerifyDto,
  VerifyEmailDto,
} from './dto';
import { EmailVerificationService } from './email-verification.service';
import { JwtService } from './jwt.service';
import { toMeUser } from './me-user';
import { RegisterService } from './register.service';
import {
  SessionService,
  sessionRevoked,
  type SessionMeta,
  type SessionTokens,
} from './session.service';
import { TwoFactorService } from './two-factor.service';
import { requiresTwoFactor } from './two-factor.policy';

/** The request's address and user-agent (`RequestIdMiddleware`). */
function requestMeta(): SessionMeta {
  const store = RequestContext.get();
  return { ip: store?.ip ?? '', userAgent: store?.userAgent ?? '' };
}

/** The current session id (`JwtAuthGuard`). */
function currentSessionId(): string | undefined {
  return RequestContext.get()?.session?.id;
}

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');

function setCookies(res: Response, tokens: SessionTokens): void {
  setAuthCookies(res, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    remember: tokens.session.remember,
    expiresAt: tokens.session.expiresAt,
  });
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly registration: RegisterService,
    private readonly verification: EmailVerificationService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly twoFactor: TwoFactorService,
    private readonly consents: ConsentService,
  ) {}

  /**
   * Sets the cookies of a completed sign-in and answers `{ status: 'OK', user }` (with the
   * consents still to accept, so the client shows the consent gate right away).
   */
  private async signedIn(
    res: Response,
    result: Extract<LoginResult, { status: 'OK' }>,
  ): Promise<LoginResponse> {
    setCookies(res, result.tokens);
    const [twoFactorRequired, pendingConsents] = await Promise.all([
      requiresTwoFactor(result.user),
      this.consents.pending(result.user.id),
    ]);
    return { status: 'OK', user: toMeUser(result.user, { twoFactorRequired, pendingConsents }) };
  }

  /** `201 { user }` and the auth cookies of a fresh (not remembered) session. */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() body: RegisterTeacherDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: MeUser }> {
    const meta = requestMeta();
    const { user } = await this.registration.registerTeacher(body, meta);
    setCookies(res, await this.sessions.createSession(user, { ...meta, remember: false }));
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

  /** `200 { status: 'OK', user }` + cookies; see `AuthService.login` for the failures. */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.auth.login(body, requestMeta());
    if (result.status === 'TWO_FACTOR_REQUIRED') return result;
    return this.signedIn(res, result);
  }

  /** Starts a TOTP enrolment: `200 { secret, otpauthUrl }` (2FA stays off until verified). */
  @AllowUnverified()
  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  setupTwoFactor(@CurrentUser() user: AuthUser): Promise<TwoFactorSetupResponse> {
    return this.twoFactor.beginSetup(user);
  }

  /**
   * With a `challengeToken` (public): completes a `TWO_FACTOR_REQUIRED` login,
   * `200 { status: 'OK', user }` + cookies. Without (signed in): confirms the pending enrolment,
   * `200 { recoveryCodes }`. Wrong code → `401 TWO_FACTOR_INVALID`; bad, expired or used
   * challenge → `401 TOKEN_INVALID`.
   */
  @AllowUnverified()
  @PublicWithChallenge()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  async verifyTwoFactor(
    @Body() body: TwoFactorVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse | TwoFactorRecoveryCodes> {
    if (body.challengeToken === undefined) {
      return this.twoFactor.confirmSetup(currentUser(), body.otpCode);
    }
    const result = await this.twoFactor.verifyLogin(body.challengeToken, body.otpCode, {
      ...requestMeta(),
      remember: body.remember,
    });
    return this.signedIn(res, result);
  }

  /** Completes a `TWO_FACTOR_REQUIRED` login with a recovery code (consumed). */
  @Public()
  @Post('2fa/recovery')
  @HttpCode(HttpStatus.OK)
  async recoverTwoFactor(
    @Body() body: TwoFactorRecoveryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.twoFactor.verifyRecovery(body.challengeToken, body.recoveryCode, {
      ...requestMeta(),
      remember: body.remember,
    });
    return this.signedIn(res, result);
  }

  /** `204`; `403 TWO_FACTOR_MANDATORY` for a role that requires 2FA. */
  @AllowUnverified()
  @Post('2fa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disableTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body() body: TwoFactorDisableDto,
  ): Promise<void> {
    await this.twoFactor.disable(user, body.otpCode);
  }

  /**
   * Rotates the `tt_refresh` cookie: `200 { ok }` with new cookies. Every 401 clears the cookies:
   * missing, malformed or unknown token (`UNAUTHENTICATED`), dead session (`SESSION_REVOKED`),
   * reuse of a spent token (all of the user's sessions revoked, `SESSION_REVOKED`).
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const token = cookieOf(req, REFRESH_COOKIE);
    if (!token) {
      clearAuthCookies(res);
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Authentication required');
    }
    let result: SessionTokens | 'REUSE';
    try {
      result = await this.sessions.rotate(token, requestMeta());
    } catch (err) {
      if (err instanceof ApiError && err.getStatus() === 401) clearAuthCookies(res);
      throw err;
    }
    if (result === 'REUSE') {
      clearAuthCookies(res);
      throw sessionRevoked();
    }
    setCookies(res, result);
    return { ok: true };
  }

  /**
   * Public, so it works with an expired access token or for a suspended account: revokes the
   * session of a valid access token if any, else the session whose CURRENT refresh token is in
   * `tt_refresh` (the cookie path covers this route). Always clears both cookies and answers
   * `204`, even when nothing matched.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const sessionId = await this.logoutTarget(req);
    if (sessionId) await this.sessions.revoke(sessionId);
    clearAuthCookies(res);
  }

  /** The caller's active sessions ("Appareils connectés"). */
  @Get('sessions')
  sessionsList(@CurrentUser() user: AuthUser): Promise<SessionSummary[]> {
    return this.sessions.listActive(user.id, currentSessionId());
  }

  /** "Déconnecter partout": every session of the caller, the current one included. */
  @Delete('sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeAll(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const count = await this.sessions.revokeAll(user.id);
    await this.audit.log({
      action: 'auth.sessions_revoked',
      entityType: 'User',
      entityId: user.id,
      after: { scope: 'all', count },
    });
    clearAuthCookies(res);
  }

  /** One of the caller's sessions; another user's (or an unknown id) is `404`. */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOne(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe({ exceptionFactory: notFound })) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (!(await this.sessions.isOwnedBy(id, user.id))) throw notFound();
    // Already revoked: nothing happened, nothing to audit (still 204, idempotent).
    if (await this.sessions.revoke(id)) {
      await this.audit.log({
        action: 'auth.sessions_revoked',
        entityType: 'User',
        entityId: user.id,
        after: { scope: 'one', sessionId: id },
      });
    }
    if (id === currentSessionId()) clearAuthCookies(res);
  }

  /** The session a logout targets: from a valid access token, else from the refresh cookie. */
  private async logoutTarget(req: Request): Promise<string | null> {
    const access = accessTokenOf(req);
    if (access) {
      try {
        const { sub, sid } = await this.jwt.verify(access, 'access');
        if (await this.sessions.isOwnedBy(sid, sub)) return sid;
      } catch {
        // Expired or invalid: fall back to the refresh cookie.
      }
    }
    const refresh = cookieOf(req, REFRESH_COOKIE);
    return refresh ? ((await this.sessions.sessionOfRefreshToken(refresh))?.id ?? null) : null;
  }
}
