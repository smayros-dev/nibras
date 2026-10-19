import { Module } from '@nestjs/common';
import { InvitationMailerService } from './invitation-mailer.service';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

/**
 * Email invitations (PRD §8.3.1, §8.2.2; design §4.1). Exports `InvitationMailerService` (the
 * public acceptance of T5 sends `invitation.accepted` through it). Depends on the global
 * `DbModule`, `AuditModule` and `ProvidersModule`.
 */
@Module({
  controllers: [InvitationsController],
  providers: [InvitationsService, InvitationMailerService],
  exports: [InvitationsService, InvitationMailerService],
})
export class InvitationsModule {}
