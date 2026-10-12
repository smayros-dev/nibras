import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Prisma,
  withTenantTx,
  type Membership,
  type MembershipRole,
  type MembershipStatus,
  type TenantTx,
} from '@tt/db';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';

export interface AddMemberInput {
  workspaceId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  /** ADMIN who also teaches. Default `false`. */
  canTeach?: boolean;
  invitedByUserId?: string;
}

function alreadyMember(): ApiError {
  return new ApiError(HttpStatus.CONFLICT, 'ALREADY_MEMBER', 'Already a member of this workspace');
}

/**
 * Adding a member to a workspace (consumed by SP2's invitations and join codes). The OWNER
 * membership is created with the workspace (`WorkspacesService`), never here.
 */
@Injectable()
export class MembershipService {
  constructor(private readonly audit: AuditService) {}

  /**
   * - a live membership (any status but `REMOVED`) → `409 ALREADY_MEMBER`;
   * - a `REMOVED` one is reactivated: same row (PRD §10.4), new role/status/`canTeach`/inviter,
   *   `joinedAt` = now when ACTIVE, `removedAt`/`removalReason` cleared;
   * - otherwise a new row (`joinedAt` = now when ACTIVE);
   * - in a PERSONAL workspace a `STUDENT` also gets the `TeacherStudentAssignment(owner →
   *   student)` (§11.2), unless it already exists (kept from before a removal).
   * Runs in `tx` when given (a `withTenantTx(input.workspaceId, …)` transaction: the tenant
   * extension refuses rows of another workspace), else in its own tenant transaction. Audits
   * `member.added`; with a caller's `tx` the audit row is written before that transaction
   * commits (the audit trail lives on its own connection).
   */
  async addMember(input: AddMemberInput, tx?: TenantTx): Promise<Membership> {
    if (input.role === 'OWNER') {
      throw new Error('addMember cannot create an OWNER membership');
    }
    const { membership, reactivated } = tx
      ? await this.insert(tx, input)
      : await withTenantTx(input.workspaceId, (t) => this.insert(t, input));
    await this.audit.log({
      action: 'member.added',
      entityType: 'Membership',
      entityId: membership.id,
      workspaceId: input.workspaceId,
      after: {
        userId: membership.userId,
        role: membership.role,
        status: membership.status,
        canTeach: membership.canTeach,
        reactivated,
      },
    });
    return membership;
  }

  private async insert(
    tx: TenantTx,
    input: AddMemberInput,
  ): Promise<{ membership: Membership; reactivated: boolean }> {
    const fields = {
      role: input.role,
      status: input.status,
      canTeach: input.canTeach ?? false,
      invitedByUserId: input.invitedByUserId ?? null,
      joinedAt: input.status === 'ACTIVE' ? new Date() : null,
    };
    const existing = await tx.membership.findFirst({
      where: { userId: input.userId },
      select: { id: true, status: true },
    });
    let membership: Membership;
    let reactivated = false;
    if (existing) {
      if (existing.status !== 'REMOVED') throw alreadyMember();
      membership = await tx.membership.update({
        where: { id: existing.id },
        data: { ...fields, removedAt: null, removalReason: null },
      });
      reactivated = true;
    } else {
      try {
        membership = await tx.membership.create({
          data: { workspaceId: input.workspaceId, userId: input.userId, ...fields },
        });
      } catch (err) {
        // (workspace_id, user_id) is the only unique key besides the id: a concurrent add.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw alreadyMember();
        }
        throw err;
      }
    }

    if (input.role === 'STUDENT') {
      const workspace = await tx.workspace.findUniqueOrThrow({
        where: { id: input.workspaceId },
        select: { type: true, ownerUserId: true },
      });
      if (workspace.type === 'PERSONAL') {
        await tx.teacherStudentAssignment.createMany({
          data: [
            {
              workspaceId: input.workspaceId,
              teacherUserId: workspace.ownerUserId,
              studentUserId: input.userId,
              assignedByUserId: input.invitedByUserId ?? workspace.ownerUserId,
            },
          ],
          skipDuplicates: true,
        });
      }
    }
    return { membership, reactivated };
  }
}
