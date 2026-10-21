import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GuardianModule } from '../guardian/guardian.module';
import { TokenAttemptLimiter } from '../common/token-attempt-limiter';
import { ConsentModule } from '../me/consent.module';
import { MembersModule } from '../members/members.module';
import { ApprovalController } from './approval.controller';
import { ApprovalService } from './approval.service';
import { InviteLinksController } from './invite-links.controller';
import { InviteLinksService } from './invite-links.service';
import { JoinController } from './join.controller';
import { JoinService } from './join.service';

/**
 * Group invite links (PRD §8.3.3; design §4.3): the staff's CRUD, the public join
 * (`/join/{code}`) and the approval queue (`members/{uid}/approve|reject`). Imports `AuthModule`
 * (password policy, sessions, email verification), `MembersModule` (`MembershipService`),
 * `ConsentModule` and `GuardianModule` (`GuardianRequestService`); depends on the global `DbModule`, `RedisModule`, `AuditModule`,
 * `ProvidersModule` and `EventEmitterModule`.
 */
@Module({
  imports: [AuthModule, MembersModule, ConsentModule, GuardianModule],
  controllers: [InviteLinksController, JoinController, ApprovalController],
  providers: [InviteLinksService, JoinService, ApprovalService, TokenAttemptLimiter],
})
export class InviteLinksModule {}
