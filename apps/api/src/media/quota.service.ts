import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type TenantTx } from '@nibras/db';
import { ApiError } from '../common/api-error';

/** The workspace's storage figures, read under its row lock. */
export interface StorageUsage {
  quotaBytes: bigint;
  usedBytes: bigint;
  reservedBytes: bigint;
}

/**
 * Storage quota (PRD D-P15, spec D17): `Workspace.storageUsedBytes` holds the bytes actually
 * counted (`MediaAsset.countedBytes`, at `complete` for S3 objects, at READY for Cloudflare
 * videos); the declared sizes of `UPLOADING` assets are reserved on top. Every check and every
 * change runs under `SELECT … FOR UPDATE` on the workspace row inside the caller's tenant
 * transaction, so parallel uploads cannot overshoot (Review Focus 2).
 */
@Injectable()
export class QuotaService {
  /**
   * Locks the workspace row and reads quota, usage and the reservations of its live `UPLOADING`
   * assets (`excludeMediaId`: the asset being completed, whose reservation becomes usage).
   */
  async usage(tx: TenantTx, wid: string, excludeMediaId?: string): Promise<StorageUsage> {
    const rows = await tx.$queryRaw<{ quota: bigint; used: bigint }[]>(
      Prisma.sql`SELECT storage_quota_bytes AS quota, storage_used_bytes AS used
        FROM "workspace" WHERE id = ${wid}::uuid FOR UPDATE`,
    );
    const row = rows[0];
    if (!row) throw new Error(`workspace ${wid} not found`);
    const reserved = await tx.mediaAsset.aggregate({
      where: {
        status: 'UPLOADING',
        deletedAt: null,
        ...(excludeMediaId !== undefined && { id: { not: excludeMediaId } }),
      },
      _sum: { sizeBytes: true },
    });
    return {
      quotaBytes: BigInt(row.quota),
      usedBytes: BigInt(row.used),
      reservedBytes: reserved._sum.sizeBytes ?? 0n,
    };
  }

  /**
   * `used + reserved + bytes ≤ quota`, else `402 QUOTA_EXCEEDED { usedBytes, reservedBytes,
   * quotaBytes, requestedBytes }` (decimal strings). Locks the workspace row until `tx` ends.
   */
  async assertRoom(
    tx: TenantTx,
    wid: string,
    bytes: bigint,
    excludeMediaId?: string,
  ): Promise<void> {
    const usage = await this.usage(tx, wid, excludeMediaId);
    if (!fits(usage, bytes)) throw quotaExceeded(usage, bytes);
  }

  /** `storageUsedBytes += bytes` and `countedBytes = bytes` on the asset (row already locked). */
  async commit(tx: TenantTx, wid: string, mediaId: string, bytes: bigint): Promise<void> {
    await tx.$executeRaw(
      Prisma.sql`UPDATE "workspace" SET storage_used_bytes = storage_used_bytes + ${bytes}
        WHERE id = ${wid}::uuid`,
    );
    await tx.mediaAsset.update({ where: { id: mediaId }, data: { countedBytes: bytes } });
  }

  /** `storageUsedBytes -= countedBytes` and `countedBytes = 0` (no-op when nothing was counted). */
  async release(tx: TenantTx, wid: string, mediaId: string): Promise<void> {
    const asset = await tx.mediaAsset.findUniqueOrThrow({
      where: { id: mediaId },
      select: { countedBytes: true },
    });
    if (asset.countedBytes === 0n) return;
    await tx.$executeRaw(
      Prisma.sql`UPDATE "workspace"
        SET storage_used_bytes = GREATEST(storage_used_bytes - ${asset.countedBytes}, 0)
        WHERE id = ${wid}::uuid`,
    );
    await tx.mediaAsset.update({ where: { id: mediaId }, data: { countedBytes: 0n } });
  }
}

export function fits(usage: StorageUsage, bytes: bigint): boolean {
  return usage.usedBytes + usage.reservedBytes + bytes <= usage.quotaBytes;
}

export function quotaExceeded(usage: StorageUsage, bytes: bigint): ApiError {
  return new ApiError(HttpStatus.PAYMENT_REQUIRED, 'QUOTA_EXCEEDED', 'Storage quota exceeded', {
    usedBytes: usage.usedBytes.toString(),
    reservedBytes: usage.reservedBytes.toString(),
    quotaBytes: usage.quotaBytes.toString(),
    requestedBytes: bytes.toString(),
  });
}
