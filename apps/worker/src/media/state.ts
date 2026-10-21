import { MEDIA_LIMITS, type MediaFailureReason, type MediaStatus } from '@nibras/contracts';
import { Prisma, type PrismaClient } from '@nibras/db';
import type {
  EmailProvider,
  StorageProvider,
  VideoAssetInfo,
  VideoProvider,
} from '@nibras/providers';
import type { Logger } from 'pino';

import { writeSystemAudit } from '../system-audit';

/** What the media jobs work with (wired by `MediaProcessor`). */
export interface MediaDeps {
  /** BYPASSRLS client: every query names the workspace explicitly (PRD §13.3). */
  db: PrismaClient;
  storage: StorageProvider;
  /** The configured provider (Cloudflare Stream assets: `getAsset`, `delete`). */
  video: VideoProvider;
  /** The S3 passthrough over `storage` (S3 videos, whatever `VIDEO_PROVIDER` says). */
  s3Video: VideoProvider;
  email: EmailProvider;
  webOrigin: string;
  logger: Logger;
}

/** The identity every transition is guarded by. */
export interface AssetRef {
  id: string;
  workspaceId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** Error type only (never a message: provider errors can carry URLs). */
export const errType = (err: unknown) => ({
  type: err instanceof Error ? err.name : typeof err,
});

/**
 * `→ FAILED reason` when the asset (of that workspace) is still in one of `from` (a concurrent
 * API change — delete, complete — wins: nothing happens). The multipart id is cleared. Writes the
 * `media.failed` system audit row. `true` when this call made the transition.
 */
export async function markFailed(
  deps: MediaDeps,
  asset: AssetRef,
  from: readonly MediaStatus[],
  reason: MediaFailureReason,
  jobId: string,
): Promise<boolean> {
  const { count } = await deps.db.mediaAsset.updateMany({
    where: { id: asset.id, workspaceId: asset.workspaceId, status: { in: [...from] } },
    data: { status: 'FAILED', failureReason: reason, uploadId: null },
  });
  if (count === 0) return false;
  deps.logger.info({ mediaId: asset.id, workspace_id: asset.workspaceId, reason }, 'media.failed');
  await writeSystemAudit(
    deps.db,
    {
      workspaceId: asset.workspaceId,
      action: 'media.failed',
      entityType: 'MediaAsset',
      entityId: asset.id,
      after: { status: 'FAILED', failureReason: reason },
    },
    jobId,
    deps.logger,
  );
  return true;
}

/** Rounded non-negative integer, else `null` (unknown: WebM, Cloudflare `-1`). */
function int(n: number | null | undefined): number | null {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

export interface ReadyInfo {
  durationS?: number | null;
  width?: number | null;
  height?: number | null;
  pageCount?: number | null;
  thumbnailUrl?: string | null;
  /**
   * Bytes held by the provider (Cloudflare READY): becomes `sizeBytes` and `countedBytes`, the
   * workspace usage moving by the difference (spec D17). Omitted for S3 objects: counted at
   * `complete` already.
   */
  countBytes?: bigint;
}

/**
 * `→ READY` (numbers, `readyAt`) when still in one of `from`, in one transaction under the
 * asset's row lock; a video over `MEDIA_LIMITS.VIDEO.maxDurationS` is `FAILED SIZE_MISMATCH`
 * instead (D-P15) and nothing is counted. `null` when a concurrent change won.
 */
export async function applyReady(
  deps: MediaDeps,
  asset: AssetRef & { kind: string },
  from: readonly MediaStatus[],
  info: ReadyInfo,
  jobId: string,
): Promise<'READY' | 'FAILED' | null> {
  const durationS = int(info.durationS);
  if (asset.kind === 'VIDEO' && durationS !== null && durationS > MEDIA_LIMITS.VIDEO.maxDurationS) {
    return (await markFailed(deps, asset, from, 'SIZE_MISMATCH', jobId)) ? 'FAILED' : null;
  }
  const done = await deps.db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: MediaStatus; counted: bigint }[]>(
      Prisma.sql`SELECT status::text AS status, counted_bytes AS counted FROM "media_asset"
        WHERE id = ${asset.id}::uuid AND workspace_id = ${asset.workspaceId}::uuid FOR UPDATE`,
    );
    const row = rows[0];
    if (!row || !from.includes(row.status)) return false;
    const size = info.countBytes;
    await tx.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: 'READY',
        readyAt: new Date(),
        failureReason: null,
        uploadId: null,
        durationS,
        width: int(info.width),
        height: int(info.height),
        ...(info.pageCount !== undefined && { pageCount: int(info.pageCount) }),
        ...(info.thumbnailUrl !== undefined && { thumbnailUrl: info.thumbnailUrl }),
        ...(size !== undefined && { sizeBytes: size, countedBytes: size }),
      },
    });
    if (size !== undefined) {
      const delta = size - BigInt(row.counted);
      if (delta !== 0n) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE "workspace"
            SET storage_used_bytes = GREATEST(storage_used_bytes + ${delta}, 0)
            WHERE id = ${asset.workspaceId}::uuid`,
        );
      }
    }
    return true;
  });
  if (!done) return null;
  deps.logger.info({ mediaId: asset.id, workspace_id: asset.workspaceId }, 'media.ready');
  return 'READY';
}

/** `getAsset` answer → `ReadyInfo` (Cloudflare: the provider's size is what is counted). */
export function readyInfo(info: VideoAssetInfo, fallbackSize?: bigint): ReadyInfo {
  const size =
    info.sizeBytes !== undefined && Number.isSafeInteger(info.sizeBytes) && info.sizeBytes >= 0
      ? BigInt(info.sizeBytes)
      : fallbackSize;
  return {
    durationS: info.durationS,
    width: info.width,
    height: info.height,
    ...(info.thumbnailUrl !== undefined && { thumbnailUrl: info.thumbnailUrl }),
    ...(size !== undefined && { countBytes: size }),
  };
}
