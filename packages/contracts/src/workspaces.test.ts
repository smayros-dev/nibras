import { describe, expect, it } from 'vitest';
import {
  defaultWorkspaceSettings,
  WorkspaceSettingsPatchSchema,
  WorkspaceSettingsSchema,
} from './workspace-settings';
import {
  AuditLogQuerySchema,
  CreateOrganizationSchema,
  TransferOwnershipSchema,
  UpdateWorkspaceSchema,
} from './workspaces';

describe('workspace settings', () => {
  it('defaults satisfy the schema', () => {
    expect(WorkspaceSettingsSchema.parse(defaultWorkspaceSettings('UTC'))).toEqual(
      defaultWorkspaceSettings('UTC'),
    );
  });

  it('refuses partial_ratio ≥ present_ratio on partial_ratio', () => {
    const r = WorkspaceSettingsSchema.safeParse({
      ...defaultWorkspaceSettings('UTC'),
      partial_ratio: 0.75,
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path)).toEqual([['partial_ratio']]);
  });

  it('patch: any subset of keys, never v or unknown keys', () => {
    expect(WorkspaceSettingsPatchSchema.parse({})).toEqual({});
    expect(WorkspaceSettingsPatchSchema.parse({ default_timezone: 'europe/paris' })).toEqual({
      default_timezone: 'Europe/Paris',
    });
    expect(WorkspaceSettingsPatchSchema.safeParse({ v: 1 }).success).toBe(false);
    expect(WorkspaceSettingsPatchSchema.safeParse({ colour: 'red' }).success).toBe(false);
    expect(WorkspaceSettingsPatchSchema.safeParse({ empty_room_grace_min: 0 }).success).toBe(false);
  });
});

describe('workspace inputs', () => {
  it('organisation: trims the name, upper-cases the country, canonicalises the time zone', () => {
    expect(
      CreateOrganizationSchema.parse({ name: ' Nour ', country: 'ma', timezone: 'africa/tunis' }),
    ).toEqual({ name: 'Nour', country: 'MA', timezone: 'Africa/Tunis' });
    expect(CreateOrganizationSchema.safeParse({ name: 'Nour' }).success).toBe(false);
    expect(
      CreateOrganizationSchema.safeParse({ name: 'N', timezone: 'UTC', country: 'MAR' }).success,
    ).toBe(false);
  });

  it('update: country may be cleared; unknown keys refused', () => {
    expect(UpdateWorkspaceSchema.parse({ country: null })).toEqual({ country: null });
    expect(UpdateWorkspaceSchema.safeParse({ slug: 'x' }).success).toBe(false);
  });

  it('transfer: toUserId is a uuid', () => {
    expect(TransferOwnershipSchema.safeParse({ toUserId: 'x' }).success).toBe(false);
  });

  it('audit-log query: limit coerced, 1–100, default 50; unknown params dropped', () => {
    expect(AuditLogQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(AuditLogQuerySchema.parse({ limit: '100', workspaceId: 'other' })).toEqual({
      limit: 100,
    });
    expect(AuditLogQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(AuditLogQuerySchema.safeParse({ from: '2026-10-01' }).success).toBe(false);
  });
});
