import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  INLINE_URL_TTL_S,
  RichTextDescriptionSchema,
  RichTextDocSchema,
  collectImageIds,
  type RichTextDoc,
} from '@nibras/contracts';
import type { TenantTx } from '@nibras/db';
import type { StorageProvider } from '@nibras/providers';
import { ApiError } from '../common/api-error';
import { mediaScopeFilter, type CourseCtx } from '../courses/course-access';
import { STORAGE_PROVIDER } from '../media/tokens';
import { validationFailed } from '../workspaces/workspaces.service';

/** A whitelisted document and the `mediaId`s of its images (document order, deduplicated). */
export interface ValidatedRichText {
  doc: RichTextDoc;
  imageIds: string[];
}

type MediaReader = Pick<TenantTx, 'mediaAsset'>;

/**
 * Rich text on the server (spec §5, PRD §14.7): the zod whitelist of `@nibras/contracts`
 * (`RichTextDocSchema` for TEXT lessons, `RichTextDescriptionSchema` — no `image` — for course
 * descriptions), the workspace check of inline images and their 5-minute inline URLs. The DTOs
 * already parse the same schemas; `validate` is the service-side gate every write goes through,
 * whatever the caller (an issue → `422 VALIDATION_FAILED` at `[path, …issuePath]`).
 */
@Injectable()
export class RichTextService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  validate(doc: unknown, opts: { allowImages: boolean; path?: string }): ValidatedRichText {
    const path = opts.path ?? 'content';
    const schema = opts.allowImages ? RichTextDocSchema : RichTextDescriptionSchema;
    const parsed = schema.safeParse(doc);
    if (!parsed.success) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'Validation failed',
        {
          issues: parsed.error.issues.map((i) => ({
            path: [path, ...i.path.map((p) => (typeof p === 'symbol' ? String(p) : p))],
            message: i.message,
          })),
        },
      );
    }
    return { doc: parsed.data, imageIds: opts.allowImages ? collectImageIds(parsed.data) : [] };
  }

  /**
   * Every inline image must be a READY, undeleted IMAGE of the transaction's workspace (another
   * workspace's id is simply not found) that the caller may use (`mediaScopeFilter`; `keep` = the
   * ids the row already references). Else `422` at `path`, naming no id.
   */
  async assertImages(
    tx: MediaReader,
    ctx: CourseCtx,
    ids: readonly string[],
    keep: readonly string[] = [],
    path = 'content',
  ): Promise<void> {
    if (ids.length === 0) return;
    const found = await tx.mediaAsset.count({
      where: {
        AND: [
          { id: { in: [...ids] }, kind: 'IMAGE', status: 'READY', deletedAt: null },
          mediaScopeFilter(ctx, keep),
        ],
      },
    });
    if (found !== ids.length) {
      throw validationFailed(path, 'Every image must be a ready image of this workspace');
    }
  }

  /** `mediaId → 5-minute inline URL` for the READY images among `ids` (others are left out). */
  async signImages(tx: MediaReader, ids: readonly string[]): Promise<Record<string, string>> {
    if (ids.length === 0) return {};
    const rows = await tx.mediaAsset.findMany({
      where: { id: { in: [...ids] }, kind: 'IMAGE', status: 'READY', deletedAt: null },
      select: { id: true, storageKey: true },
    });
    const urls: Record<string, string> = {};
    for (const row of rows) {
      if (!row.storageKey) continue;
      urls[row.id] = await this.storage.signGetUrl(row.storageKey, INLINE_URL_TTL_S, {
        disposition: 'inline',
      });
    }
    return urls;
  }
}
