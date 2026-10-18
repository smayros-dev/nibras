import { describe, expect, it } from 'vitest';
import {
  AbuseReportSchema,
  AdminAbuseReportSchema,
  AdminAbuseReportsPageSchema,
  CreateAbuseReportSchema,
  UpdateAbuseReportSchema,
  minorSafetyReminderJobId,
} from './abuse';

const valid = {
  category: 'HARASSMENT',
  description: 'Comportement inapproprié pendant la session.',
  entityType: 'USER',
  entityId: '0192f0f0-0000-7000-8000-000000000000',
};

describe('abuse contracts', () => {
  it('description is trimmed and 10–4000 characters long', () => {
    expect(
      CreateAbuseReportSchema.parse({ ...valid, description: '  0123456789  ' }).description,
    ).toBe('0123456789');
    expect(CreateAbuseReportSchema.safeParse({ ...valid, description: ' court ' }).success).toBe(
      false,
    );
    expect(
      CreateAbuseReportSchema.safeParse({ ...valid, description: 'x'.repeat(4001) }).success,
    ).toBe(false);
  });

  it('rejects unknown keys, a non-uuid entity id and more than 10 attachments', () => {
    expect(CreateAbuseReportSchema.safeParse({ ...valid, workspaceId: null }).success).toBe(false);
    expect(CreateAbuseReportSchema.safeParse({ ...valid, entityId: 'nope' }).success).toBe(false);
    expect(
      CreateAbuseReportSchema.safeParse({ ...valid, attachments: Array(11).fill(valid.entityId) })
        .success,
    ).toBe(false);
  });

  it('an update needs at least one field; null clears resolution and assignee', () => {
    expect(UpdateAbuseReportSchema.safeParse({}).success).toBe(false);
    expect(UpdateAbuseReportSchema.parse({ resolution: null, assignedToUserId: null })).toEqual({
      resolution: null,
      assignedToUserId: null,
    });
  });

  it('organisation handlers never get the reporter; the admin schema requires it (owner Q1)', () => {
    const validOrgReport = {
      id: 'r1',
      workspaceId: 'w1',
      category: 'HARASSMENT',
      description: 'Comportement inapproprié pendant la session.',
      status: 'OPEN',
      entityType: 'USER',
      entityId: valid.entityId,
      contextSnapshot: {},
      attachments: [],
      assignedToUserId: null,
      resolution: null,
      resolvedAt: null,
      createdAt: '2026-10-18T00:00:00.000Z',
      updatedAt: '2026-10-18T00:00:00.000Z',
    };
    const reporter = { userId: 'u1', firstName: 'Amal', lastName: 'Ben Ali' };
    expect(Object.keys(AbuseReportSchema.shape)).not.toContain('reporter');
    expect(Object.keys(AdminAbuseReportSchema.shape)).toContain('reporter');
    expect(AbuseReportSchema.safeParse(validOrgReport).success).toBe(true);
    expect(AdminAbuseReportSchema.safeParse({ ...validOrgReport }).success).toBe(false); // reporter missing
    expect(AdminAbuseReportSchema.safeParse({ ...validOrgReport, reporter }).success).toBe(true);
    // zod strips unknown keys: an org-shaped parse of an admin row drops the reporter.
    expect(AbuseReportSchema.parse({ ...validOrgReport, reporter })).not.toHaveProperty('reporter');
    expect(
      AdminAbuseReportsPageSchema.safeParse({
        items: [{ ...validOrgReport, reporter }],
        nextCursor: null,
      }).success,
    ).toBe(true);
  });

  it('one reminder job id per report', () => {
    expect(minorSafetyReminderJobId('r1')).toBe('abuse:r1:minor-safety-reminder');
  });
});
