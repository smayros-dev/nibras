import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import type { AcceptResult, InvitationPreview } from '@nibras/contracts';
import type { Response } from 'express';
import { setAuthCookies } from '../auth/cookies';
import { OptionalAuth } from '../auth/decorators/optional-auth';
import { RequestContext } from '../common/request-context';
import { AcceptService } from './accept.service';
import { AcceptInvitationDto, acceptInput } from './dto';

/** The request's address and user-agent (`RequestIdMiddleware`). */
function requestMeta(): { ip: string; userAgent: string } {
  const store = RequestContext.get();
  return { ip: store?.ip ?? '', userAgent: store?.userAgent ?? '' };
}

/**
 * Public invitation links (PRD §8.1.1 « J'ai une invitation », D-P18; design §4.2). Anonymous or
 * signed in (`@OptionalAuth()`: no email-verified / consents / 2FA-setup gate; a suspended account
 * is still refused). No workspace context: the token resolves its workspace. Unknown, malformed
 * and replaced tokens all answer `410 TOKEN_INVALID`; 10 failed lookups per minute and ip → `429`.
 * The token never appears in a response, an audit row or a log line (the request path is masked).
 */
@Controller('invitations')
@OptionalAuth()
export class PublicInvitationsController {
  constructor(private readonly accept: AcceptService) {}

  /**
   * The invitation page: workspace, inviter, role, masked address, whether an account exists,
   * how the signed-in user relates to the address (`ANONYMOUS` / `MATCH` / `MISMATCH`), and
   * whether a birth date must be asked. `410` `TOKEN_INVALID` / `INVITATION_EXPIRED` /
   * `INVITATION_REVOKED` / `INVITATION_ALREADY_ACCEPTED`.
   */
  @Get(':token')
  preview(@Param('token') token: string): Promise<InvitationPreview> {
    return this.accept.preview(token, RequestContext.get()?.user, requestMeta().ip);
  }

  /**
   * `201`: `REGISTER` (anonymous, no account for the address: the account is created verified and
   * signed in — auth cookies set) or `JOIN` (signed in as the invited address). Signed in as
   * another address → `403 INVITATION_EMAIL_MISMATCH` (`details.emailMasked`). A minor's
   * membership is `PENDING_GUARDIAN_CONSENT` and his guardian is emailed the consent request.
   */
  @Post(':token/accept')
  @HttpCode(HttpStatus.CREATED)
  async acceptInvitation(
    @Param('token') token: string,
    @Body() body: AcceptInvitationDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptResult> {
    const { result, session } = await this.accept.accept(
      token,
      acceptInput(body),
      RequestContext.get()?.user,
      requestMeta(),
    );
    if (session) {
      setAuthCookies(res, {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        remember: session.session.remember,
        expiresAt: session.session.expiresAt,
      });
    }
    return result;
  }
}
