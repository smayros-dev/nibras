import { describe, expect, it } from 'vitest';
import {
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

  it('one reminder job id per report', () => {
    expect(minorSafetyReminderJobId('r1')).toBe('abuse:r1:minor-safety-reminder');
  });
});
