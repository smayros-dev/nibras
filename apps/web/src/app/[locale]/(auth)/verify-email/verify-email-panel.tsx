'use client';

import { Button } from '@tt/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '../../../../lib/api-error';
import { api } from '../../../../lib/api';

type Phase = 'verifying' | 'done' | 'invalid' | 'pending';

/** Token from the emailed link: verify on mount; without one, offer a resend (session required). */
export function VerifyEmailPanel({ token }: { token: string | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const [phase, setPhase] = useState<Phase>(token ? 'verifying' : 'pending');
  const [error, setError] = useState<string | null>(null);
  const [resendDone, setResendDone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    void (async () => {
      const { error: verifyError } = await api.POST('/auth/verify-email', { body: { token } });
      if (verifyError) {
        setError(apiErrorMessage(t, verifyError as unknown));
        setPhase('invalid');
      } else {
        setPhase('done');
      }
    })();
  }, [token, t]);

  async function resend() {
    const { error: resendError } = await api.POST('/auth/resend-verification');
    if (resendError) setError(apiErrorMessage(t, resendError as unknown));
    else setResendDone(true);
  }

  if (phase === 'verifying') {
    return <p className="text-lg">{t('common.loading')}</p>;
  }

  if (phase === 'done') {
    return (
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
        <h1 className="mb-4 text-2xl font-bold">{t('auth.verify.done')}</h1>
        <a
          href={`/${locale}/app`}
          className="inline-flex items-center justify-center rounded-md bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-700"
        >
          {t('auth.verify.continue')}
        </a>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
      <h1 className="mb-4 text-2xl font-bold">{t('auth.verify.pending')}</h1>
      <p className="mb-4 text-sm">{t('auth.verify.pendingBody')}</p>
      {error ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {resendDone ? (
        <p className="mb-3 text-sm text-success" role="status">
          {t('auth.verify.resendDone')}
        </p>
      ) : null}
      <Button variant="secondary" onClick={() => void resend()}>
        {t('auth.verify.resend')}
      </Button>
    </div>
  );
}
