import { MEMBERSHIP_STATUSES } from '@nibras/contracts/web';
import { messages } from '@nibras/i18n';
import { describe, expect, it } from 'vitest';
import { membershipStatusBadge } from './membership-status';

describe('membershipStatusBadge', () => {
  it('maps every status to a variant and an existing label in the three catalogues', () => {
    expect(membershipStatusBadge('ACTIVE').variant).toBe('success');
    expect(membershipStatusBadge('PENDING_APPROVAL').variant).toBe('warning');
    expect(membershipStatusBadge('PENDING_GUARDIAN_CONSENT').variant).toBe('warning');
    expect(membershipStatusBadge('SUSPENDED_NO_CONSENT').variant).toBe('danger');
    expect(membershipStatusBadge('SUSPENDED_CONSENT_REVOKED').variant).toBe('danger');
    expect(membershipStatusBadge('REMOVED').variant).toBe('neutral');
    for (const status of MEMBERSHIP_STATUSES) {
      const key = membershipStatusBadge(status).labelKey.split('.')[1]!;
      for (const locale of ['fr', 'ar', 'en'] as const) {
        expect((messages[locale].members as Record<string, string>)[key]).toBeTruthy();
      }
    }
  });
});
