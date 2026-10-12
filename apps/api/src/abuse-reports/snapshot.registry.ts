import { HttpStatus, Injectable } from '@nestjs/common';
import type { AbuseEntityType } from '@tt/contracts';
import { ApiError } from '../common/api-error';

/**
 * Builds the frozen copy of a reported entity (`AbuseReport.contextSnapshot`), or `null` when the
 * entity does not exist (or, with a `workspaceId`, is not part of that workspace).
 */
export type SnapshotProvider = (
  entityId: string,
  workspaceId: string | null,
) => Promise<Record<string, unknown> | null>;

/**
 * One snapshot provider per reportable entity type. SP1 registers `USER`; SP6 registers `SESSION`
 * (session, participants, last 50 room-chat messages, AC-SAFE-02), SP8 `MESSAGE`, SP3 `COURSE`,
 * each from its own module's `onModuleInit`.
 */
@Injectable()
export class SnapshotRegistry {
  private readonly providers = new Map<AbuseEntityType, SnapshotProvider>();

  register(entityType: AbuseEntityType, fn: SnapshotProvider): void {
    if (this.providers.has(entityType)) {
      throw new Error(`Snapshot provider already registered for ${entityType}`);
    }
    this.providers.set(entityType, fn);
  }

  /**
   * The entity's snapshot: no provider for `entityType` → `422 ENTITY_TYPE_UNSUPPORTED`; the
   * provider returns `null` → `404 NOT_FOUND`.
   */
  async snapshot(
    entityType: AbuseEntityType,
    entityId: string,
    workspaceId: string | null,
  ): Promise<Record<string, unknown>> {
    const provider = this.providers.get(entityType);
    if (!provider) throw entityTypeUnsupported(entityType);
    const snapshot = await provider(entityId, workspaceId);
    if (!snapshot) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    return snapshot;
  }
}

export function entityTypeUnsupported(entityType: string): ApiError {
  return new ApiError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'ENTITY_TYPE_UNSUPPORTED',
    `Reports on ${entityType} are not supported here`,
  );
}
