import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type {
  GuardianConsentPreview,
  GuardianDecisionResult,
  GuardianRegrantResult,
  GuardianView,
} from '@nibras/contracts';
import { Public } from '../auth/decorators/public';
import { GuardianDecisionDto, GuardianRegrantDto } from './dto';
import { GuardianService, guardianRequestMeta } from './guardian.service';

/**
 * Public guardian routes (PRD §8.3.5, D-O5; design §4.4, D6). The guardian has no account
 * (`@Public()`): the token in the path is the only credential. No workspace context: the token
 * resolves its (student, workspace) link and nothing else. Unknown, malformed and replaced
 * tokens all answer `410 TOKEN_INVALID`; 10 failed lookups per minute and ip → `429`. Tokens
 * never appear in an audit row or a log line (the request path is masked).
 */
@Controller()
@Public()
export class GuardianController {
  constructor(private readonly guardian: GuardianService) {}

  /**
   * The consent page: student, workspace, teacher, expiry, consent version, link to the minors
   * notice. `410` `TOKEN_INVALID` / `CONSENT_LINK_EXPIRED` / `CONSENT_ALREADY_DECIDED`.
   */
  @Get('guardian-consent/:token')
  preview(@Param('token') token: string): Promise<GuardianConsentPreview> {
    return this.guardian.previewConsent(token, guardianRequestMeta().ip);
  }

  /**
   * `GRANT` (the minors notice accepted) activates the student's membership in this workspace and
   * returns the guardian page url (also emailed); `REFUSE` suspends it. Single use: the consent
   * link answers `410 TOKEN_INVALID` afterwards. A grant into a suspended workspace → `423`.
   */
  @Post('guardian-consent/:token')
  @HttpCode(HttpStatus.OK)
  decide(
    @Param('token') token: string,
    @Body() body: GuardianDecisionDto,
  ): Promise<GuardianDecisionResult> {
    return this.guardian.decide(token, body, guardianRequestMeta());
  }

  /** The guardian page of one (student, workspace): link state and (SP5) that workspace's sessions. */
  @Get('guardian/:token')
  view(@Param('token') token: string): Promise<GuardianView> {
    return this.guardian.view(token, guardianRequestMeta().ip);
  }

  /**
   * `204`: the consent of this workspace is revoked and the student's membership there suspended
   * (`SUSPENDED_CONSENT_REVOKED`); his other workspaces are untouched, nothing is deleted. Not
   * `ACTIVE` → `409 GUARDIAN_LINK_INACTIVE`.
   */
  @Post('guardian/:token/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Param('token') token: string): Promise<void> {
    await this.guardian.revoke(token, guardianRequestMeta());
  }

  /**
   * Re-grant after a revocation or a refusal: a new consent, the membership `ACTIVE` again, and a
   * **new** guardian page url (this one stops working). Otherwise `409 GUARDIAN_LINK_INACTIVE`.
   */
  @Post('guardian/:token/grant')
  @HttpCode(HttpStatus.OK)
  regrant(
    @Param('token') token: string,
    @Body() body: GuardianRegrantDto,
  ): Promise<GuardianRegrantResult> {
    return this.guardian.regrant(token, body, guardianRequestMeta());
  }
}
