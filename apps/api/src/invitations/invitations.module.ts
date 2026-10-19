import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TokenAttemptLimiter } from '../common/token-attempt-limiter';
import { GuardianRequestService } from '../guardian/guardian-request.service';
import { ConsentModule } from '../me/consent.module';
import { MembersModule } from '../members/members.module';
import { AcceptService } from './accept.service';
import { InvitationMailerService } from './invitation-mailer.service';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { PublicInvitationsController } from './public-invitations.controller';

/**
 * Email invitations (PRD §8.3.1, §8.2.2; design §4.1, §4.2): the workspace staff's CRUD and the
 * public acceptance (`/invitations/{token}`). Exports `InvitationsService`,
 * `InvitationMailerService` and `GuardianRequestService` (the shared "start a consent cycle"
 * primitive, provided here until the guardian module of T7 takes it over). Imports `AuthModule`
 * (password policy, sessions), `MembersModule` (`MembershipService`) and `ConsentModule`; depends
 * on the global `DbModule`, `RedisModule`, `AuditModule`, `ProvidersModule` and
 * `EventEmitterModule`.
 */
@Module({
  imports: [AuthModule, MembersModule, ConsentModule],
  controllers: [InvitationsController, PublicInvitationsController],
  providers: [
    InvitationsService,
    InvitationMailerService,
    AcceptService,
    GuardianRequestService,
    TokenAttemptLimiter,
  ],
  exports: [InvitationsService, InvitationMailerService, GuardianRequestService],
})
export class InvitationsModule {}
