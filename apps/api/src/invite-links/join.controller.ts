import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import type { AcceptResult, JoinPreview } from '@nibras/contracts';
import type { Response } from 'express';
import { setAuthCookies } from '../auth/cookies';
import { OptionalAuth } from '../auth/decorators/optional-auth';
import { RequestContext } from '../common/request-context';
import { AcceptJoinDto, joinInput } from './dto';
import { JoinService } from './join.service';

/** The request's address and user-agent (`RequestIdMiddleware`). */
function requestMeta(): { ip: string; userAgent: string } {
  const store = RequestContext.get();
  return { ip: store?.ip ?? '', userAgent: store?.userAgent ?? '' };
}

/**
 * Public group codes (PRD §8.3.3, D-P18: a code is not bound to an address; design §4.3).
 * Anonymous or signed in (`@OptionalAuth()`). No workspace context: the code resolves its
 * workspace. Codes are case-insensitive; unknown and malformed codes answer `404 NOT_FOUND`;
 * 10 failed lookups per minute and ip → `429`. Codes are group secrets: the request path is masked
 * in the logs.
 */
@Controller('join')
@OptionalAuth()
export class JoinController {
  constructor(private readonly join: JoinService) {}

  /**
   * The join page: workspace, teacher, whether the teacher approves each student, whether the
   * viewer is signed in. `410` `INVITE_LINK_DISABLED` / `INVITE_LINK_EXHAUSTED` /
   * `INVITE_LINK_EXPIRED`.
   */
  @Get(':code')
  preview(@Param('code') code: string): Promise<JoinPreview> {
    return this.join.preview(code, RequestContext.get()?.user, requestMeta().ip);
  }

  /**
   * `201`: `REGISTER` (anonymous, with the email: the account is created **unverified** and must
   * verify its address — auth cookies set) or `JOIN` (signed in). The membership is
   * `PENDING_APPROVAL` when the link requires approval, `PENDING_GUARDIAN_CONSENT` for a minor
   * (his guardian is emailed), else `ACTIVE`. `423 WORKSPACE_SUSPENDED` while the workspace is
   * suspended or being deleted; `409 ALREADY_MEMBER`.
   */
  @Post(':code/accept')
  @HttpCode(HttpStatus.CREATED)
  async accept(
    @Param('code') code: string,
    @Body() body: AcceptJoinDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptResult> {
    const { result, session } = await this.join.accept(
      code,
      joinInput(body),
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
