import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { EnrollmentSource } from '@nibras/contracts';
import { tenantDb } from '@nibras/db';
import { PinoLogger } from 'nestjs-pino';
import {
  INVITATION_ACCEPTED,
  INVITE_LINK_JOINED,
  MEMBERSHIP_DEACTIVATED,
  type InvitationAcceptedEvent,
  type InviteLinkJoinedEvent,
  type MembershipDeactivatedEvent,
} from '../members/events';
import { EnrollmentsService } from './enrollments.service';

const errType = (err: unknown) => ({ type: err instanceof Error ? err.name : typeof err });

/** Revocation reason of the enrollments of a membership rejected in the approval queue. */
export const MEMBERSHIP_REJECTED_REASON = 'MEMBERSHIP_REJECTED';

/**
 * SP2 → SP3 hooks (spec §4.5): an accepted email invitation and a join through a group invite
 * link turn their `courseIds` into enrollments (`source` INVITATION / INVITE_LINK, assigned by the
 * inviter / the link's creator, scope `all`, audited as `SYSTEM`). Ids that no longer name a live
 * DRAFT or PUBLISHED course of the workspace are skipped and logged (ids only). A minor waiting
 * for consent, or a student waiting for approval, is pre-assigned: the `/me` routes give access
 * only once the membership is ACTIVE, and the notification job skips inactive members. A
 * rejection in the approval queue revokes what the link assigned. Every failure is logged, never
 * thrown: the request that emitted the event has already answered.
 */
@Injectable()
export class EnrollmentHooksListener {
  constructor(
    private readonly enrollments: EnrollmentsService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(EnrollmentHooksListener.name);
  }

  @OnEvent(INVITATION_ACCEPTED, { async: true })
  async onInvitationAccepted(event: InvitationAcceptedEvent): Promise<void> {
    try {
      if (event.role !== 'STUDENT') return;
      const invitation = await tenantDb(event.workspaceId).invitation.findFirst({
        where: { id: event.invitationId },
        select: { courseIds: true, invitedByUserId: true },
      });
      if (!invitation) return;
      await this.enrollAll(
        event.workspaceId,
        event.userId,
        invitation.courseIds,
        invitation.invitedByUserId,
        'INVITATION',
      );
    } catch (err) {
      this.logger.error(
        { workspace_id: event.workspaceId, invitationId: event.invitationId, err: errType(err) },
        'invitation enrollment hook failed',
      );
    }
  }

  @OnEvent(INVITE_LINK_JOINED, { async: true })
  async onInviteLinkJoined(event: InviteLinkJoinedEvent): Promise<void> {
    try {
      const link = await tenantDb(event.workspaceId).inviteLink.findFirst({
        where: { id: event.inviteLinkId },
        select: { courseIds: true, createdByUserId: true },
      });
      if (!link) return;
      await this.enrollAll(
        event.workspaceId,
        event.userId,
        link.courseIds,
        link.createdByUserId,
        'INVITE_LINK',
      );
    } catch (err) {
      this.logger.error(
        { workspace_id: event.workspaceId, inviteLinkId: event.inviteLinkId, err: errType(err) },
        'invite link enrollment hook failed',
      );
    }
  }

  /** A STUDENT rejected in the approval queue loses the courses his code pre-assigned. */
  @OnEvent(MEMBERSHIP_DEACTIVATED, { async: true })
  async onMembershipDeactivated(event: MembershipDeactivatedEvent): Promise<void> {
    if (event.status !== 'REJECTED') return;
    try {
      await this.enrollments.revokeAllOf(
        event.workspaceId,
        event.userId,
        MEMBERSHIP_REJECTED_REASON,
      );
    } catch (err) {
      this.logger.error(
        { workspace_id: event.workspaceId, userId: event.userId, err: errType(err) },
        'rejection enrollment hook failed',
      );
    }
  }

  /** One enrollment per live course of `courseIds`, each in its own transaction. */
  private async enrollAll(
    workspaceId: string,
    studentUserId: string,
    courseIds: readonly string[],
    assignedByUserId: string,
    source: Exclude<EnrollmentSource, 'MANUAL'>,
  ): Promise<void> {
    const wanted = [...new Set(courseIds)];
    if (wanted.length === 0) return;
    const live = new Set(
      (
        await tenantDb(workspaceId).course.findMany({
          where: { id: { in: wanted }, deletedAt: null, status: { in: ['DRAFT', 'PUBLISHED'] } },
          select: { id: true },
        })
      ).map((c) => c.id),
    );
    const skipped = wanted.filter((id) => !live.has(id));
    if (skipped.length > 0) {
      this.logger.warn(
        { workspace_id: workspaceId, source, courseIds: skipped },
        'enrollment hook skipped course ids',
      );
    }
    const ctx = { workspaceId, userId: assignedByUserId, scope: 'all' as const };
    for (const courseId of wanted.filter((id) => live.has(id))) {
      try {
        await this.enrollments.enroll(ctx, courseId, [studentUserId], { source, system: true });
      } catch (err) {
        this.logger.error(
          { workspace_id: workspaceId, courseId, source, err: errType(err) },
          'enrollment hook could not enroll',
        );
      }
    }
  }
}
