import { describe, expect, it } from 'vitest';
import { workspaceAccessOnError } from './workspace-access';

describe('workspaceAccessOnError', () => {
  it('lets a pending app consent fall through to the ConsentGate of the /app layout', () => {
    expect(workspaceAccessOnError('CONSENT_REQUIRED')).toBe('consent-gate');
  });

  it.each(['GUARDIAN_CONSENT_REQUIRED', 'MEMBERSHIP_INACTIVE'])(
    '%s shows the waiting panel',
    (code) => {
      expect(workspaceAccessOnError(code)).toBe('inactive');
    },
  );

  it.each([undefined, 'NOT_FOUND', 'FORBIDDEN', 'INTERNAL_ERROR'])('%s stays a 404', (code) => {
    expect(workspaceAccessOnError(code)).toBe('not-found');
  });
});
