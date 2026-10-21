'use client';

import type { Locale } from '@nibras/contracts/web';
import type { GuardianRegrantResult, GuardianView } from '@nibras/contracts';
import { formatDate } from '@nibras/i18n';
import {
  Alert,
  AlertDialog,
  Badge,
  type BadgeVariant,
  Button,
  Card,
  EmptyState,
  PageHeader,
  useSubmit,
  useToast,
} from '@nibras/ui';
import { CalendarDays } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '../i18n/navigation';
import { api, asApiResult } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';
import {
  GuardianFormError,
  GuardianIdentityFields,
  pageTokenOf,
  useGuardianIdentity,
  useViewerTimezone,
} from './guardian-consent-form';

const STATUS_VARIANTS: Record<GuardianView['link']['status'], BadgeVariant> = {
  PENDING: 'warning',
  ACTIVE: 'success',
  REVOKED: 'danger',
  REFUSED: 'neutral',
};

/**
 * The guardian page of one (student, workspace) (PRD §8.3.5, D-O5; AC-INV-11, AC-SAFE-06): the
 * consent's state, that workspace's sessions of that student (empty until SP5 defines the rows)
 * and the guardian's actions — **Retirer mon consentement** (confirmed: the student loses this
 * workspace only) while `ACTIVE`, **Autoriser à nouveau** (the identity form again) once
 * `REVOKED` / `REFUSED`. A re-grant replaces the page token: the page moves to the new one. The
 * token stays in the props and the API path.
 */
export function GuardianPanel({ token, view }: { token: string; view: GuardianView }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const zone = useViewerTimezone();
  const router = useRouter();
  const { toast } = useToast();
  const identity = useGuardianIdentity();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [regrantOpen, setRegrantOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const student = `${view.student.firstName} ${view.student.lastName}`;
  const teacher = `${view.teacher.firstName} ${view.teacher.lastName}`;
  const { status } = view.link;
  const date = (iso: string) => formatDate(new Date(iso), locale, zone, { dateStyle: 'long' });

  const revoke = useSubmit(async () => {
    setActionError(null);
    let error: unknown;
    try {
      ({ error } = asApiResult<void>(
        await api.POST('/guardian/{token}/revoke', { params: { path: { token } } }),
      ));
    } catch {
      error = null;
    }
    setConfirmRevoke(false);
    if (error !== undefined) {
      setActionError(apiErrorMessage(t, error));
    } else {
      toast({ title: t('guardian.revoked'), variant: 'success' });
    }
    // Success or a stale page (409: already revoked elsewhere): show the current state.
    router.refresh();
  });

  const regrant = useSubmit(async () => {
    identity.reset();
    let result: { data?: GuardianRegrantResult; error?: unknown };
    try {
      result = asApiResult<GuardianRegrantResult>(
        await api.POST('/guardian/{token}/grant', {
          params: { path: { token } },
          body: { ...identity.identity(), acceptNotice: true },
        }),
      );
    } catch {
      identity.setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    const { data, error } = result;
    const next = pageTokenOf(data?.guardianPageUrl);
    if (error || !next) {
      identity.fail(error ?? null);
      return;
    }
    toast({ title: t('guardian.regranted'), variant: 'success' });
    // This token is dead now (410): continue on the new page, in the current locale.
    router.replace(`/guardian/${next}`);
  });

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <PageHeader
        title={t('guardian.pageTitle', { student })}
        description={t('guardian.pageLead', { workspace: view.workspace.name, teacher })}
      />
      {actionError ? <Alert variant="danger">{actionError}</Alert> : null}
      <Card>
        <Card.Header>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Card.Title as="h2">{t('guardian.statusTitle')}</Card.Title>
            <Badge variant={STATUS_VARIANTS[status]}>{t(`guardian.status_${status}`)}</Badge>
          </div>
          <Card.Description>{t('guardian.scopeHint')}</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-1 text-sm text-fg-muted">
          {view.link.grantedAt ? (
            <p>{t('guardian.grantedOn', { date: date(view.link.grantedAt) })}</p>
          ) : null}
          {view.link.revokedAt ? (
            <p>{t('guardian.revokedOn', { date: date(view.link.revokedAt) })}</p>
          ) : null}
        </Card.Content>
        <Card.Footer className="flex flex-wrap items-center gap-3">
          {status === 'ACTIVE' ? (
            <Button variant="danger" onClick={() => setConfirmRevoke(true)}>
              {t('guardian.revoke')}
            </Button>
          ) : null}
          {(status === 'REVOKED' || status === 'REFUSED') && !regrantOpen ? (
            <Button variant="primary" onClick={() => setRegrantOpen(true)}>
              {t('guardian.regrant')}
            </Button>
          ) : null}
        </Card.Footer>
      </Card>

      {regrantOpen && (status === 'REVOKED' || status === 'REFUSED') ? (
        <Card>
          <Card.Header>
            <Card.Title as="h2">{t('guardian.regrant')}</Card.Title>
            <Card.Description>{t('guardian.regrantLead', { student })}</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            <GuardianFormError identity={identity} />
            <form
              method="post"
              noValidate
              ref={identity.formRef}
              onSubmit={(e) => {
                e.preventDefault();
                if (!identity.check()) return;
                void regrant.submit();
              }}
              className="flex flex-col gap-4"
            >
              <GuardianIdentityFields identity={identity} student={student} teacher={teacher} />
              <div className="flex flex-wrap gap-3">
                <Button
                  type="submit"
                  variant="primary"
                  loading={regrant.busy}
                  disabled={!identity.values.acceptNotice}
                >
                  {t('guardian.regrantSubmit')}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setRegrantOpen(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </Card.Content>
        </Card>
      ) : null}

      {/* SP5 renders `view.sessions` here (that workspace's sessions of that student only). */}
      {view.sessions.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarDays />}
            title={t('guardian.noSessions')}
            description={t('guardian.noSessionsHint', { student })}
          />
        </Card>
      ) : null}

      <AlertDialog.Root open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        {confirmRevoke ? (
          <AlertDialog.Content
            title={t('guardian.revokeTitle')}
            description={t('guardian.revokeDescription', { student, teacher })}
          >
            <AlertDialog.Footer>
              <AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
              <AlertDialog.Action
                destructive
                loading={revoke.busy}
                onClick={(event) => {
                  // Stay open while the request runs; close on the outcome.
                  event.preventDefault();
                  void revoke.submit();
                }}
              >
                {t('guardian.revokeConfirm')}
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        ) : null}
      </AlertDialog.Root>
    </div>
  );
}
