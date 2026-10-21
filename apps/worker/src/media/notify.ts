import { courseEditorLink, type MediaFailureReason } from '@nibras/contracts';
import type { Job } from 'bullmq';

import { errType, type MediaDeps } from './state';

/**
 * Job progress of the `media.failed` notices: the assets this job moved to `FAILED`, and those
 * whose owner was already emailed. The transition is recorded before the email, so a retry (the
 * asset is no longer in the state that triggered it) still sends the notice, and never twice.
 */
interface NoticeProgress {
  failed: string[];
  notified: string[];
}

function readProgress(progress: unknown): NoticeProgress {
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  if (progress && typeof progress === 'object') {
    const p = progress as Record<string, unknown>;
    return { failed: list(p.failed), notified: list(p.notified) };
  }
  return { failed: [], notified: [] };
}

/**
 * `media.failed` emails to the asset owners (AC-MED-03), resumable through the job progress (the
 * SP1.6 `sentTo` pattern): `record` after each transition to `FAILED`, `flush` at the end of the
 * job. A failed send is retried by BullMQ (`flush` throws once every notice was tried).
 */
export class FailureNotices {
  private readonly state: NoticeProgress;

  constructor(
    private readonly deps: MediaDeps,
    private readonly job: Pick<Job, 'progress' | 'updateProgress' | 'name'>,
  ) {
    this.state = readProgress(job.progress);
  }

  async record(mediaId: string): Promise<void> {
    if (this.state.failed.includes(mediaId)) return;
    this.state.failed.push(mediaId);
    await this.save();
  }

  /** Sends the pending notices; the number sent. Throws when one could not be sent. */
  async flush(): Promise<number> {
    let sent = 0;
    let failed = 0;
    for (const mediaId of this.state.failed) {
      if (this.state.notified.includes(mediaId)) continue;
      try {
        if (await this.send(mediaId)) sent += 1;
      } catch (err) {
        failed += 1;
        this.deps.logger.error({ mediaId, err: errType(err) }, 'media.failed email not sent');
        continue;
      }
      this.state.notified.push(mediaId);
      await this.save();
    }
    if (failed > 0) throw new Error(`media.failed: ${failed} email(s) not sent`);
    return sent;
  }

  /** `false` when there is nothing to tell any more (asset gone, or no longer FAILED). */
  private async send(mediaId: string): Promise<boolean> {
    const { db, email, webOrigin, logger } = this.deps;
    const asset = await db.mediaAsset.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        workspaceId: true,
        status: true,
        failureReason: true,
        originalFilename: true,
        owner: { select: { id: true, email: true, locale: true, firstName: true } },
      },
    });
    if (!asset || asset.status !== 'FAILED' || !asset.failureReason) return false;
    const { owner } = asset;
    const lesson = await db.lesson.findFirst({
      where: {
        workspaceId: asset.workspaceId,
        mediaAssetId: asset.id,
        module: { course: { deletedAt: null } },
      },
      select: { module: { select: { courseId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const origin = webOrigin.replace(/\/+$/, '');
    const link = lesson
      ? courseEditorLink(origin, owner.locale, asset.workspaceId, lesson.module.courseId)
      : `${origin}/${owner.locale}/app/w/${encodeURIComponent(asset.workspaceId)}/courses`;
    await email.send({
      to: owner.email,
      locale: owner.locale,
      templateKey: 'media.failed',
      params: {
        firstName: owner.firstName,
        filename: asset.originalFilename,
        reason: asset.failureReason as MediaFailureReason,
        link,
      },
    });
    logger.info(
      { mediaId, workspace_id: asset.workspaceId, userId: owner.id },
      'media.failed email sent',
    );
    return true;
  }

  /** A failed progress write is logged, never thrown (the transition or email it records happened). */
  private async save(): Promise<void> {
    try {
      await this.job.updateProgress({
        failed: [...this.state.failed],
        notified: [...this.state.notified],
      } satisfies NoticeProgress);
    } catch (err) {
      this.deps.logger.warn(
        { jobName: this.job.name, err: errType(err) },
        'media job progress not saved',
      );
    }
  }
}
