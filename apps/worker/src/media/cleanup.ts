import { PROCESSING_TIMEOUT_MS, UPLOAD_ABANDON_AFTER_MS } from '@nibras/contracts';
import type { MediaAsset } from '@nibras/db';
import type { Job } from 'bullmq';

import { FailureNotices } from './notify';
import { applyReady, errType, markFailed, readyInfo, type MediaDeps } from './state';

export interface CleanupResult {
  abandoned: number;
  timedOut: number;
  /** Provider-hosted assets whose `getAsset` answer was applied instead (R11). */
  reconciled: number;
}

const BATCH = 100;

/** A tus upload hosted by the provider (Cloudflare Stream), not an S3 object. */
const isHosted = (a: MediaAsset) => !!a.providerAssetId && !a.storageKey;

/**
 * `media.cleanup_abandoned`, hourly (spec §4.3, §11, AC-MED-03). Over every workspace (explicit
 * ids, batches by id):
 *
 * - `UPLOADING` created more than 24 h ago → `FAILED ABANDONED` first (status-guarded: an API
 *   `complete` that claimed it meanwhile wins), then the multipart upload aborted and any object
 *   deleted, or the provider upload deleted (best effort, logged). A hosted upload the provider
 *   reports `READY` (a lost webhook) is reconciled instead.
 * - `PROCESSING` for more than 6 h → for a hosted video, `getAsset` first and its answer applied
 *   (R11: READY with the bytes counted, or FAILED PROVIDER_ERROR); otherwise, or still
 *   processing, `FAILED TIMEOUT`. Every TIMEOUT / provider failure emails the owner.
 *
 * A provider error while asking `getAsset` skips the asset until the next run. Each transition to
 * FAILED writes a `media.failed` system audit row.
 */
export async function cleanupMedia(deps: MediaDeps, job: Job): Promise<CleanupResult> {
  const now = Date.now();
  const jobId = String(job.id);
  const notices = new FailureNotices(deps, job);
  const result: CleanupResult = { abandoned: 0, timedOut: 0, reconciled: 0 };

  for await (const asset of batches(deps, {
    status: 'UPLOADING',
    createdAt: { lt: new Date(now - UPLOAD_ABANDON_AFTER_MS) },
  })) {
    if (isHosted(asset) && (await reconcileReady(deps, asset, jobId, notices))) {
      result.reconciled += 1;
      continue;
    }
    if (!(await markFailed(deps, asset, ['UPLOADING'], 'ABANDONED', jobId))) continue;
    result.abandoned += 1;
    await discardUpload(deps, asset);
  }

  for await (const asset of batches(deps, {
    status: 'PROCESSING',
    processingStartedAt: { lt: new Date(now - PROCESSING_TIMEOUT_MS) },
  })) {
    if (isHosted(asset)) {
      const info = await askProvider(deps, asset);
      if (info === undefined) continue; // provider unreachable: next hour.
      if (info?.status === 'READY') {
        const outcome = await applyReady(
          deps,
          asset,
          ['PROCESSING'],
          readyInfo(info, asset.sizeBytes),
          jobId,
        );
        if (outcome === 'FAILED') await notices.record(asset.id);
        if (outcome) result.reconciled += 1;
        continue;
      }
      if (info?.status === 'FAILED') {
        if (await markFailed(deps, asset, ['PROCESSING'], 'PROVIDER_ERROR', jobId)) {
          await notices.record(asset.id);
          result.reconciled += 1;
        }
        continue;
      }
    }
    if (await markFailed(deps, asset, ['PROCESSING'], 'TIMEOUT', jobId)) {
      await notices.record(asset.id);
      result.timedOut += 1;
    }
  }

  await notices.flush();
  deps.logger.info({ ...result }, 'media.cleanup done');
  return result;
}

/** Assets matching `where` across workspaces, by id, `BATCH` at a time. */
async function* batches(
  deps: MediaDeps,
  where: {
    status: 'UPLOADING' | 'PROCESSING';
    createdAt?: { lt: Date };
    processingStartedAt?: { lt: Date };
  },
): AsyncGenerator<MediaAsset> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await deps.db.mediaAsset.findMany({
      where: { ...where, ...(cursor !== undefined && { id: { gt: cursor } }) },
      orderBy: { id: 'asc' },
      take: BATCH,
    });
    for (const row of rows) yield row;
    if (rows.length < BATCH) return;
    cursor = rows[rows.length - 1]!.id;
  }
}

/**
 * The provider's view of a hosted asset; `null` when the configured provider is not the asset's
 * (nothing to ask), `undefined` when the call failed (logged).
 */
async function askProvider(deps: MediaDeps, asset: MediaAsset) {
  if (asset.provider !== deps.video.name || !asset.providerAssetId) return null;
  try {
    return await deps.video.getAsset({ providerAssetId: asset.providerAssetId });
  } catch (err) {
    deps.logger.warn(
      { mediaId: asset.id, workspace_id: asset.workspaceId, err: errType(err) },
      'media.cleanup getAsset failed',
    );
    return undefined;
  }
}

/** An abandoned hosted upload the provider finished anyway (lost webhook): applied as READY. */
async function reconcileReady(
  deps: MediaDeps,
  asset: MediaAsset,
  jobId: string,
  notices: FailureNotices,
): Promise<boolean> {
  const info = await askProvider(deps, asset);
  if (info?.status !== 'READY') return false;
  const outcome = await applyReady(
    deps,
    asset,
    ['UPLOADING'],
    readyInfo(info, asset.sizeBytes),
    jobId,
  );
  if (outcome === 'FAILED') await notices.record(asset.id);
  return outcome !== null;
}

/** Best effort: the asset is FAILED either way; a leftover expires at the store / provider. */
async function discardUpload(deps: MediaDeps, asset: MediaAsset): Promise<void> {
  try {
    if (asset.storageKey) {
      if (asset.uploadId) {
        await deps.storage
          .abortMultipart(asset.storageKey, asset.uploadId)
          .catch((err: unknown) => {
            if (!(err instanceof Error && err.name === 'NoSuchUpload')) throw err;
          });
      }
      // A multipart upload completed at the store but never claimed by the API.
      await deps.storage.delete(asset.storageKey);
    } else if (asset.providerAssetId && asset.provider === deps.video.name) {
      await deps.video.delete({ providerAssetId: asset.providerAssetId });
    }
  } catch (err) {
    deps.logger.warn(
      { mediaId: asset.id, workspace_id: asset.workspaceId, err: errType(err) },
      'media.cleanup discard failed',
    );
  }
}
