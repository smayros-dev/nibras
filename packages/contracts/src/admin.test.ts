import { describe, expect, it } from 'vitest';
import {
  AdminWorkspacesQuerySchema,
  MAX_STORAGE_QUOTA_BYTES,
  SuspensionSchema,
  UpdateWorkspaceQuotaSchema,
} from './admin';

describe('admin console inputs', () => {
  it('workspaces query: filters optional, limit coerced 1–100 default 50, q trimmed', () => {
    expect(AdminWorkspacesQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(
      AdminWorkspacesQuerySchema.parse({
        type: 'PERSONAL',
        status: 'SUSPENDED',
        q: ' ecole ',
        limit: '10',
      }),
    ).toEqual({ type: 'PERSONAL', status: 'SUSPENDED', q: 'ecole', limit: 10 });
    expect(AdminWorkspacesQuerySchema.safeParse({ type: 'X' }).success).toBe(false);
    expect(AdminWorkspacesQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(AdminWorkspacesQuerySchema.safeParse({ cursor: 'nope' }).success).toBe(false);
  });

  it('suspension: a trimmed non-empty reason, nothing else', () => {
    expect(SuspensionSchema.parse({ reason: ' Signalement confirmé ' })).toEqual({
      reason: 'Signalement confirmé',
    });
    expect(SuspensionSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(SuspensionSchema.safeParse({}).success).toBe(false);
    expect(SuspensionSchema.safeParse({ reason: 'x', extra: 1 }).success).toBe(false);
  });

  it('quota: integer or decimal string, 0..10 TiB', () => {
    expect(MAX_STORAGE_QUOTA_BYTES).toBe(10 * 1024 ** 4);
    expect(UpdateWorkspaceQuotaSchema.parse({ storageQuotaBytes: 1024 })).toEqual({
      storageQuotaBytes: 1024,
    });
    expect(UpdateWorkspaceQuotaSchema.parse({ storageQuotaBytes: '10995116277760' })).toEqual({
      storageQuotaBytes: '10995116277760',
    });
    for (const bad of [
      -1,
      1.5,
      '10995116277761',
      '99999999999999999999999',
      '1e9',
      '-1',
      '',
      10995116277761,
    ]) {
      expect(
        UpdateWorkspaceQuotaSchema.safeParse({ storageQuotaBytes: bad }).success,
        `${bad}`,
      ).toBe(false);
    }
  });
});
