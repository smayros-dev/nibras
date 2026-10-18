import type { AbuseReportStatus } from '@nibras/contracts';
import type { BadgeVariant } from '@nibras/ui';

/** Badge colour of an abuse report's status (queue and detail). */
export function abuseStatusBadge(status: AbuseReportStatus): BadgeVariant {
  if (status === 'OPEN') return 'warning';
  if (status === 'IN_REVIEW') return 'info';
  if (status === 'RESOLVED') return 'success';
  return 'neutral';
}
