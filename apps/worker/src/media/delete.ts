import type { MediaDeleteJob } from '@nibras/contracts';
import { Prisma } from '@nibras/db';
import type { Job } from 'bullmq';

import { isUuid, type MediaDeps } from './state';

export interface DeleteResult {
  deleted: boolean;
}

/**
 * `media.delete { mediaId, workspaceId }` (spec §4.3, §11, D16), enqueued by the API's `DELETE`
 * (and the course purge). The asset of that workspace must be `DELETING` (else no-op). The bytes
 * go first — pending multipart aborted, S3 object deleted, provider video deleted (missing
 * objects / Cloudflare 404 succeed) — then, in one transaction under the row lock, the workspace
 * usage drops by `countedBytes` and the row is deleted. A provider or storage error throws
 * (BullMQ retries) and the row stays `DELETING`, visible to the teacher.
 */
export async function deleteMedia(
  deps: MediaDeps,
  job: Job<MediaDeleteJob>,
): Promise<DeleteResult> {
  const { mediaId, workspaceId } = job.data ?? {};
  if (!isUuid(mediaId) || !isUuid(workspaceId)) return { deleted: false };
  const { db, storage, video, logger } = deps;
  const asset = await db.mediaAsset.findFirst({ where: { id: mediaId, workspaceId } });
  if (asset?.status !== 'DELETING') return { deleted: false };

  if (asset.storageKey) {
    if (asset.uploadId) {
      await storage.abortMultipart(asset.storageKey, asset.uploadId).catch((err: unknown) => {
        if (!(err instanceof Error && err.name === 'NoSuchUpload')) throw err;
      });
    }
    await storage.delete(asset.storageKey);
  }
  if (asset.providerAssetId) {
    if (asset.provider !== video.name) {
      throw new Error(
        `media.delete: asset hosted by ${asset.provider}, the worker is configured for ${video.name}`,
      );
    }
    await video.delete({ providerAssetId: asset.providerAssetId });
  }

  const deleted = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ counted: bigint }[]>(
      Prisma.sql`SELECT counted_bytes AS counted FROM "media_asset"
        WHERE id = ${asset.id}::uuid AND workspace_id = ${workspaceId}::uuid
          AND status = 'DELETING' FOR UPDATE`,
    );
    const row = rows[0];
    if (!row) return false;
    const counted = BigInt(row.counted);
    if (counted > 0n) {
      await tx.$executeRaw(
        Prisma.sql`UPDATE "workspace"
          SET storage_used_bytes = GREATEST(storage_used_bytes - ${counted}, 0)
          WHERE id = ${workspaceId}::uuid`,
      );
    }
    await tx.mediaAsset.delete({ where: { id: asset.id } });
    return true;
  });
  if (deleted) logger.info({ mediaId: asset.id, workspace_id: workspaceId }, 'media.deleted');
  return { deleted };
}
