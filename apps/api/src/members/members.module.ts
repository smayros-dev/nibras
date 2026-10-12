import { Module } from '@nestjs/common';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { MembershipService } from './membership.service';
import { MEMBER_REMOVAL_BLOCKERS, type MemberRemovalBlocker } from './removal-blockers';

/**
 * Members and teacher ↔ student assignments (PRD §8.2, §11.2). Exports `MembershipService`
 * (SP2 invitations add members through it). `MEMBER_REMOVAL_BLOCKERS` is empty in SP1; SP5
 * replaces this provider with a factory injecting its future-sessions blocker. Depends on the
 * global `DbModule`, `AuditModule` and `EventEmitterModule`.
 */
@Module({
  controllers: [MembersController, AssignmentsController],
  providers: [
    MembersService,
    MembershipService,
    AssignmentsService,
    { provide: MEMBER_REMOVAL_BLOCKERS, useValue: [] satisfies MemberRemovalBlocker[] },
  ],
  exports: [MembershipService],
})
export class MembersModule {}
