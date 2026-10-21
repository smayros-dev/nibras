import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  COURSE_PURGE_AFTER_DAYS,
  COURSE_PURGE_JOB,
  DEFAULT_JOB_OPTIONS,
  MEDIA_DELETE_JOB,
  QUEUES,
  mediaDeleteJobId,
  type MediaDeleteJob,
} from '@nibras/contracts';
import { Prisma, type PrismaClient } from '@nibras/db';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';

import { WORKER_LOGGER } from '../logger';
import { ProcessorRegistry, QueueRegistry } from '../queues';
import { writeSystemAudit } from '../system-audit';
import { WORKER_DB } from '../worker-db';

/** Courses read per query by the purge. */
export const PURGE_BATCH_SIZE = 100;

const DAY_MS = 24 * 3600 * 1000;

export interface CoursePurgeResult {
  purged: number;
  mediaQueued: number;
}

/** Media ids of `image` nodes anywhere in a stored rich-text document (validated at write). */
export function imageIdsOf(doc: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(doc)) {
    for (const child of doc) imageIdsOf(child, into);
  } else if (doc && typeof doc === 'object') {
    const node = doc as { type?: unknown; attrs?: { mediaId?: unknown }; content?: unknown };
    if (node.type === 'image' && typeof node.attrs?.mediaId === 'string') {
      into.add(node.attrs.mediaId);
    }
    if (node.content !== undefined) imageIdsOf(node.content, into);
  }
  return into;
}

/**
 * `course.purge_deleted` (spec §3, §11; PRD §8.4.1 « suppression douce 30 jours »), daily at
 * 03:30 UTC (`course-purge-deleted`). Every course soft-deleted more than
 * `COURSE_PURGE_AFTER_DAYS` ago is hard-deleted, one transaction per course under its row lock
 * (modules, lessons, enrollments and progress cascade). The media it referenced — lesson media,
 * inline images of its TEXT lessons, its cover — that nothing else still references (another
 * lesson, an inline image, a course cover, an avatar or a workspace logo of that workspace)
 * become `DELETING` in the same transaction, then one `media.delete` job each (same job id as the
 * API's: idempotent) deletes them at the provider and releases the quota. `UPLOADING` assets are
 * left to the hourly cleanup. One `course.purged` system audit row per course.
 *
 * Idempotent: a purged course is gone; a retry re-enqueues nothing twice (job ids).
 */
@Injectable()
export class CoursePurgeProcessor implements OnModuleInit {
  constructor(
    private readonly registry: ProcessorRegistry,
    private readonly queues: QueueRegistry,
    @Inject(WORKER_DB) private readonly db: PrismaClient,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.registry.registerProcessor(QUEUES.compliance, COURSE_PURGE_JOB, (job) => this.purge(job));
  }

  async purge(job: Pick<Job, 'id'>, now = new Date()): Promise<CoursePurgeResult> {
    const jobId = String(job.id);
    const cutoff = new Date(now.getTime() - COURSE_PURGE_AFTER_DAYS * DAY_MS);
    let purged = 0;
    let mediaQueued = 0;
    let lastId: string | null = null;

    for (;;) {
      const batch: { id: string; workspaceId: string }[] = await this.db.course.findMany({
        where: { deletedAt: { lt: cutoff }, ...(lastId ? { id: { gt: lastId } } : {}) },
        orderBy: { id: 'asc' },
        take: PURGE_BATCH_SIZE,
        select: { id: true, workspaceId: true },
      });
      for (const course of batch) {
        lastId = course.id;
        const outcome = await this.purgeOne(course, cutoff);
        if (!outcome) continue;
        purged += 1;
        for (const mediaId of outcome.mediaIds) {
          await this.enqueueDelete(course.workspaceId, mediaId);
          mediaQueued += 1;
        }
        this.logger.info(
          { workspace_id: course.workspaceId, courseId: course.id, media: outcome.mediaIds },
          'course purged',
        );
        await writeSystemAudit(
          this.db,
          {
            workspaceId: course.workspaceId,
            action: 'course.purged',
            entityType: 'Course',
            entityId: course.id,
            before: { title: outcome.title, deletedAt: outcome.deletedAt },
            after: { mediaDeleted: outcome.mediaIds },
          },
          jobId,
          this.logger,
        );
      }
      if (batch.length < PURGE_BATCH_SIZE) break;
    }

    this.logger.info({ jobId, purged, mediaQueued }, 'course purge done');
    return { purged, mediaQueued };
  }

  /** `null` when the course is no longer purgeable (restored? never: already purged by a retry). */
  private purgeOne(
    course: { id: string; workspaceId: string },
    cutoff: Date,
  ): Promise<{ title: string; deletedAt: Date; mediaIds: string[] } | null> {
    const wid = course.workspaceId;
    return this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM "course" WHERE id = ${course.id}::uuid
          AND workspace_id = ${wid}::uuid AND deleted_at < ${cutoff} FOR UPDATE`,
      );
      if (locked.length === 0) return null;
      const row = await tx.course.findUniqueOrThrow({
        where: { id: course.id },
        select: { title: true, deletedAt: true, coverMediaId: true },
      });
      const lessons = await tx.lesson.findMany({
        where: { workspaceId: wid, module: { courseId: course.id } },
        select: { mediaAssetId: true, content: true },
      });
      const candidates = new Set<string>();
      if (row.coverMediaId) candidates.add(row.coverMediaId);
      for (const l of lessons) {
        if (l.mediaAssetId) candidates.add(l.mediaAssetId);
        imageIdsOf(l.content, candidates);
      }

      await tx.course.delete({ where: { id: course.id } });

      const mediaIds: string[] = [];
      for (const mediaId of candidates) {
        if (!(await this.unreferenced(tx, wid, mediaId))) continue;
        const { count } = await tx.mediaAsset.updateMany({
          where: {
            id: mediaId,
            workspaceId: wid,
            status: { in: ['READY', 'FAILED', 'PROCESSING'] },
          },
          data: { status: 'DELETING', deletedAt: new Date() },
        });
        const already =
          count === 0 &&
          (await tx.mediaAsset.count({
            where: { id: mediaId, workspaceId: wid, status: 'DELETING' },
          })) === 1;
        if (count === 1 || already) mediaIds.push(mediaId);
      }
      return { title: row.title, deletedAt: row.deletedAt!, mediaIds };
    });
  }

  /** No remaining lesson, inline image, course cover, avatar or workspace logo uses the asset. */
  private async unreferenced(
    tx: Prisma.TransactionClient,
    wid: string,
    mediaId: string,
  ): Promise<boolean> {
    const [lessons, covers, avatars, logos, inline] = await Promise.all([
      tx.lesson.count({ where: { workspaceId: wid, mediaAssetId: mediaId } }),
      tx.course.count({ where: { workspaceId: wid, coverMediaId: mediaId } }),
      tx.user.count({ where: { avatarMediaId: mediaId } }),
      tx.workspace.count({ where: { logoMediaId: mediaId } }),
      tx.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(*) AS n FROM "lesson" WHERE workspace_id = ${wid}::uuid
          AND content IS NOT NULL AND strpos(content::text, ${mediaId}) > 0`,
      ),
    ]);
    return lessons + covers + avatars + logos === 0 && BigInt(inline[0]?.n ?? 0) === 0n;
  }

  private async enqueueDelete(workspaceId: string, mediaId: string): Promise<void> {
    const queue = this.queues.queues.get(QUEUES.media);
    if (!queue) throw new Error(`unknown queue ${QUEUES.media}`);
    const data: MediaDeleteJob = { mediaId, workspaceId };
    await queue.add(MEDIA_DELETE_JOB, data, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: mediaDeleteJobId(mediaId),
    });
  }
}
