import { MEDIA_LIMITS, type MediaFailureReason, type MediaProcessJob } from '@nibras/contracts';
import type { MediaAsset } from '@nibras/db';
import type { Job } from 'bullmq';

import { probeImage } from './image';
import { FailureNotices } from './notify';
import { probePdf } from './pdf';
import { applyReady, errType, isUuid, markFailed, type MediaDeps, type ReadyInfo } from './state';

export interface ProcessResult {
  status: 'READY' | 'FAILED' | 'SKIPPED';
  reason?: MediaFailureReason;
}

type Probe = { ok: true; info: ReadyInfo } | { ok: false; reason: MediaFailureReason } | null;

/**
 * `media.process { mediaId, workspaceId }` (spec §4.3, §11), enqueued by the API's `complete`
 * for S3 objects. The asset of that workspace must be `PROCESSING` (else no-op: READY, FAILED,
 * DELETING or gone). By kind: PDF → page count (`pdf-lib`; encrypted → `FAILED ENCRYPTED`),
 * IMAGE → width/height (`image-size`), VIDEO (S3) → duration and size from the MP4 probe (over
 * 4 h → `FAILED SIZE_MISMATCH`), FILE → READY as is. The object is read whole only after a `HEAD`
 * confirmed it is within the kind's limit (bounded memory). The transition is guarded by the
 * status, so a concurrent delete wins. A failure emails the owner (`media.failed`, resumable).
 * Storage errors throw (BullMQ retries; the asset stays `PROCESSING` until the 6 h timeout).
 */
export async function processMedia(
  deps: MediaDeps,
  job: Job<MediaProcessJob>,
): Promise<ProcessResult> {
  const { mediaId, workspaceId } = job.data ?? {};
  const notices = new FailureNotices(deps, job);
  let result: ProcessResult = { status: 'SKIPPED' };
  if (isUuid(mediaId) && isUuid(workspaceId)) {
    const asset = await deps.db.mediaAsset.findFirst({ where: { id: mediaId, workspaceId } });
    if (asset?.status === 'PROCESSING') {
      const probe = await probeAsset(deps, asset);
      const jobId = String(job.id);
      if (probe?.ok) {
        const outcome = await applyReady(deps, asset, ['PROCESSING'], probe.info, jobId);
        if (outcome === 'FAILED') {
          await notices.record(asset.id);
          result = { status: 'FAILED', reason: 'SIZE_MISMATCH' };
        } else if (outcome === 'READY') result = { status: 'READY' };
      } else if (probe) {
        if (await markFailed(deps, asset, ['PROCESSING'], probe.reason, jobId)) {
          await notices.record(asset.id);
          result = { status: 'FAILED', reason: probe.reason };
        }
      }
    }
  }
  await notices.flush();
  return result;
}

/** Reads and probes the stored object; `null` = nothing to decide yet. */
async function probeAsset(deps: MediaDeps, asset: MediaAsset): Promise<Probe> {
  switch (asset.kind) {
    case 'PDF': {
      const bytes = await readWhole(deps, asset, MEDIA_LIMITS.PDF.maxBytes);
      if (!bytes.ok) return bytes;
      const pdf = await probePdf(bytes.bytes);
      return pdf.ok ? { ok: true, info: { pageCount: pdf.pageCount } } : pdf;
    }
    case 'IMAGE': {
      const bytes = await readWhole(deps, asset, MEDIA_LIMITS.IMAGE.maxBytes);
      if (!bytes.ok) return bytes;
      const image = probeImage(bytes.bytes);
      return image.ok ? { ok: true, info: { width: image.width, height: image.height } } : image;
    }
    case 'VIDEO': {
      if (!asset.storageKey) return null; // a provider-hosted video: its webhook decides.
      const info = await deps.s3Video.getAsset({ storageKey: asset.storageKey });
      if (info.status === 'FAILED') {
        return { ok: false, reason: info.failureReason ?? 'PROVIDER_ERROR' };
      }
      if (info.status !== 'READY') return null;
      // The bytes were counted at `complete`: only the numbers are stored.
      return {
        ok: true,
        info: { durationS: info.durationS, width: info.width, height: info.height },
      };
    }
    case 'FILE':
      return { ok: true, info: {} };
    default:
      deps.logger.warn({ mediaId: asset.id, kind: asset.kind }, 'media.process unsupported kind');
      return null;
  }
}

/**
 * The whole object, once a `HEAD` showed it exists and fits `maxBytes` (the API checked the size
 * at `complete`; this guards the worker's memory against anything else).
 */
async function readWhole(
  deps: MediaDeps,
  asset: MediaAsset,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: MediaFailureReason }> {
  if (!asset.storageKey) return { ok: false, reason: 'PROVIDER_ERROR' };
  const head = await deps.storage.head(asset.storageKey);
  if (!head) {
    deps.logger.warn(
      { mediaId: asset.id, workspace_id: asset.workspaceId },
      'media.object_missing',
    );
    return { ok: false, reason: 'PROVIDER_ERROR' };
  }
  if (head.sizeBytes > maxBytes) return { ok: false, reason: 'SIZE_MISMATCH' };
  if (head.sizeBytes === 0) return { ok: false, reason: 'INVALID_SIGNATURE' };
  try {
    return {
      ok: true,
      bytes: await deps.storage.getRange(asset.storageKey, 0, head.sizeBytes - 1),
    };
  } catch (err) {
    deps.logger.warn({ mediaId: asset.id, err: errType(err) }, 'media.object_read_failed');
    throw err;
  }
}
