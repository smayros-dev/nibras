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
import type { LoginResponse, MeUser, SessionSummary } from '@tt/contracts';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { RequestContext, type AuthUser } from '../common/request-context';
import { AuthService } from './auth.service';
import {
  accessTokenOf,
  clearAuthCookies,
  cookieOf,
  REFRESH_COOKIE,
  setAuthCookies,
} from './cookies';
import { AllowUnverified } from './decorators/allow-unverified';
import { CurrentUser } from './decorators/current-user';
import { Public } from './decorators/public';
import { LoginDto, RegisterTeacherDto, VerifyEmailDto } from './dto';
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
  ) {}

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
    setCookies(res, result.tokens);
    return {
      status: 'OK',
      user: toMeUser(result.user, { twoFactorRequired: false, pendingConsents: [] }),
    };
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
