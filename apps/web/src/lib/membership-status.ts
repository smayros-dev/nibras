import type { MembershipStatus } from '@nibras/contracts';
import type { BadgeVariant } from '@nibras/ui';

/**
 * The badge of a membership status (members table, dashboard workspace rows, the waiting panel's
 * header): `ACTIVE` success, the `PENDING_*` ones warning, the `SUSPENDED_*` ones danger, the
 * others neutral. The label is `members.status_<status>`.
 */
export function membershipStatusBadge(status: MembershipStatus): {
  variant: BadgeVariant;
  labelKey: `members.status_${MembershipStatus}`;
} {
  let variant: BadgeVariant = 'neutral';
  if (status === 'ACTIVE') variant = 'success';
  else if (status.startsWith('PENDING')) variant = 'warning';
  else if (status.startsWith('SUSPENDED')) variant = 'danger';
  return { variant, labelKey: `members.status_${status}` };
}
