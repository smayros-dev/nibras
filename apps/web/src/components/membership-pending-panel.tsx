'use client';

import type { GuardianInfo, MyWorkspace } from '@nibras/contracts';
import { Button, Card, useSubmit, useToast } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '../i18n/navigation';
import { api, asApiResult } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

/** Statuses that wait on (or were stopped by) the guardian: the student may resend the request. */
const CONSENT_STATUSES: readonly MyWorkspace['status'][] = [
  'PENDING_GUARDIAN_CONSENT',
  'SUSPENDED_NO_CONSENT',
  'SUSPENDED_CONSENT_REVOKED',
];

/**
 * What a student whose membership is not active sees inside the workspace (PRD §8.3.5, D-O5;
 * design §8): waiting for the guardian's consent (masked address), the guardian did not answer or
 * refused, the guardian withdrew the consent — each with **Renvoyer l'email** (10-minute cooldown:
 * a `429` disables the button with the minutes left from `details.retryAfterS`) — or waiting for
 * the teacher's approval (no action). The resend is under `/me` (the workspace guard refuses an
 * inactive member).
 */
export function MembershipPendingPanel({ membership }: { membership: MyWorkspace }) {
  const t = useTranslations();
  const { toast } = useToast();
  const [guardian, setGuardian] = useState<GuardianInfo | null>(membership.guardian ?? null);
  const [cooldownMin, setCooldownMin] = useState<number | null>(null);
  const { status } = membership;
  const wid = membership.workspace.id;

  useEffect(() => {
    if (cooldownMin === null) return;
    const timer = setTimeout(() => setCooldownMin(null), cooldownMin * 60_000);
    return () => clearTimeout(timer);
  }, [cooldownMin]);

  const resend = useSubmit(async () => {
    let result: { data?: GuardianInfo; error?: unknown };
    try {
      result = asApiResult<GuardianInfo>(
        await api.POST('/me/workspaces/{wid}/guardian/resend-consent', {
          params: { path: { wid } },
        }),
      );
    } catch {
      toast({ title: t('errors.INTERNAL_ERROR'), variant: 'danger' });
      return;
    }
    const { data, error } = result;
    if (error || !data) {
      const body = error as { code?: string; details?: { retryAfterS?: unknown } } | undefined;
      const retryAfterS = body?.details?.retryAfterS;
      if (body?.code === 'RATE_LIMITED' && typeof retryAfterS === 'number') {
        setCooldownMin(Math.max(1, Math.ceil(retryAfterS / 60)));
        return;
      }
      toast({ title: apiErrorMessage(t, error ?? null), variant: 'danger' });
      return;
    }
    setGuardian(data);
    toast({ title: t('pending.resent'), variant: 'success' });
  });

  let title: string;
  let hint: string;
  if (status === 'PENDING_GUARDIAN_CONSENT') {
    title = t('pending.guardianWaiting', { email: guardian?.emailMasked ?? '' });
    hint = t('pending.guardianWaitingHint');
  } else if (status === 'SUSPENDED_NO_CONSENT') {
    title = guardian?.status === 'REFUSED' ? t('pending.refused') : t('pending.noAnswer');
    hint = t('pending.suspendedHint');
  } else if (status === 'SUSPENDED_CONSENT_REVOKED') {
    title = t('pending.revoked');
    hint = t('pending.suspendedHint');
  } else {
    title = t('pending.approval');
    hint = t('pending.approvalHint');
  }
  const canResend = CONSENT_STATUSES.includes(status) && guardian !== null;

  return (
    <Card>
      <Card.Header>
        <Card.Title>{title}</Card.Title>
        <Card.Description>{hint}</Card.Description>
      </Card.Header>
      <Card.Footer className="flex flex-wrap items-center gap-3">
        {canResend ? (
          <Button
            variant="primary"
            loading={resend.busy}
            disabled={cooldownMin !== null}
            aria-describedby={cooldownMin !== null ? 'resend-cooldown' : undefined}
            onClick={() => void resend.submit()}
          >
            {t('pending.resend')}
          </Button>
        ) : null}
        <Button variant="secondary" asChild>
          <Link href="/app">{t('pending.dashboard')}</Link>
        </Button>
        <p id="resend-cooldown" role="status" className="text-sm text-fg-muted">
          {cooldownMin !== null ? t('pending.retryIn', { min: cooldownMin }) : null}
        </p>
      </Card.Footer>
    </Card>
  );
}
