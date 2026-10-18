'use client';

import { Alert, Button, useSubmit, useToast } from '@nibras/ui';
import { MailCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { AuthCard, AuthLoading } from '../../../../components/auth-card';
import { Link } from '../../../../i18n/navigation';
import { apiErrorMessage } from '../../../../lib/api-error';
import { api } from '../../../../lib/api';

type Phase = 'verifying' | 'done' | 'invalid' | 'pending';

/** Token from the emailed link: verify on mount; without one, offer a resend (session required). */
export function VerifyEmailPanel({ token }: { token: string | null }) {
  const t = useTranslations();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>(token ? 'verifying' : 'pending');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const { error: verifyError } = await api.POST('/auth/verify-email', { body: { token } });
        if (verifyError) {
          setError(apiErrorMessage(t, verifyError));
          setPhase('invalid');
        } else {
          setPhase('done');
        }
      } catch {
        setError(t('errors.INTERNAL_ERROR'));
        setPhase('invalid');
      }
    })();
  }, [token, t]);

  const resend = useSubmit(async () => {
    setError(null);
    try {
      const { error: resendError } = await api.POST('/auth/resend-verification');
      if (resendError) {
        setError(apiErrorMessage(t, resendError));
        return;
      }
    } catch {
      setError(t('errors.INTERNAL_ERROR'));
      return;
    }
    toast({ title: t('auth.verify.resendDone'), variant: 'success' });
  });

  if (phase === 'verifying') {
    return <AuthLoading title={t('auth.verify.pending')} label={t('common.loading')} />;
  }

  if (phase === 'done') {
    return (
      <AuthCard title={t('auth.verify.done')}>
        <Button asChild variant="primary">
          <Link href="/app">{t('auth.verify.continue')}</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('auth.verify.pending')} description={t('auth.verify.pendingBody')}>
      <span
        aria-hidden="true"
        className="inline-flex size-12 items-center justify-center self-center rounded-full bg-primary-subtle text-primary"
      >
        <MailCheck className="size-6" />
      </span>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <Button variant="secondary" loading={resend.busy} onClick={() => void resend.submit()}>
        {t('auth.verify.resend')}
      </Button>
    </AuthCard>
  );
}
