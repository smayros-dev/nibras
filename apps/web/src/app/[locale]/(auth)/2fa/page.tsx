'use client';

import type { LoginResponse } from '@tt/contracts';
import { Alert, Button, Field, Input, useSubmit } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { AuthCard, AuthLoading } from '../../../../components/auth-card';
import { useRouter } from '../../../../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../lib/api-error';
import { api, asApiResult } from '../../../../lib/api';
import { useErrorFocus } from '../../../../lib/use-error-focus';
import { sanitizeNext } from '../../../../lib/sanitize-next';
import {
  CHALLENGE_STORAGE_KEY,
  parseChallenge,
  type TwoFactorChallenge,
} from '../../../../lib/two-factor-challenge';

/** Login challenge stored by the login form; without one there is nothing to verify. */
function readChallenge(): TwoFactorChallenge | null {
  return parseChallenge(sessionStorage.getItem(CHALLENGE_STORAGE_KEY));
}

export default function TwoFactorPage() {
  const t = useTranslations();
  const router = useRouter();

  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);
  const bounced = useRef(false);

  useEffect(() => {
    const stored = readChallenge();
    if (!stored && !bounced.current) {
      bounced.current = true;
      router.replace('/login');
      return;
    }
    setChallenge(stored);
  }, [router]);

  const verify = useSubmit(async () => {
    if (!challenge) return;
    setFieldErrors({});
    setFormError(null);
    let result: { data?: LoginResponse; error?: unknown };
    try {
      result = asApiResult<LoginResponse>(
        useRecovery
          ? await api.POST('/auth/2fa/recovery', {
              body: {
                challengeToken: challenge.challengeToken,
                recoveryCode: recoveryCode.trim(),
                remember: challenge.remember,
              },
            })
          : await api.POST('/auth/2fa/verify', {
              body: {
                challengeToken: challenge.challengeToken,
                otpCode: code,
                remember: challenge.remember,
              },
            }),
      );
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    const { data, error } = result;
    if (error) {
      const mapped = issuesToFieldErrors(t, error);
      if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
      else setFormError(apiErrorMessage(t, error));
      return;
    }
    if (data?.status === 'OK') {
      sessionStorage.removeItem(CHALLENGE_STORAGE_KEY);
      router.push(nextAfterLogin(data.user.twoFactor) ?? sanitizeNext(challenge.next) ?? '/app');
    }
  });

  if (!challenge) {
    return <AuthLoading title={t('auth.twoFactor.title')} label={t('common.loading')} />;
  }

  return (
    <AuthCard
      title={t('auth.twoFactor.title')}
      description={
        useRecovery ? t('auth.twoFactor.recoverySubtitle') : t('auth.twoFactor.subtitle')
      }
      footer={
        <Button
          variant="link"
          className="self-start"
          onClick={() => {
            setUseRecovery((v) => !v);
            setFormError(null);
            setFieldErrors({});
          }}
        >
          {useRecovery ? t('auth.twoFactor.code') : t('auth.twoFactor.useRecovery')}
        </Button>
      }
    >
      {formError ? (
        <Alert ref={alertRef} tabIndex={-1} variant="danger">
          {formError}
        </Alert>
      ) : null}
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          void verify.submit();
        }}
        className="flex flex-col gap-4"
      >
        {useRecovery ? (
          <Field
            htmlFor="recoveryCode"
            label={t('auth.twoFactor.recoveryCode')}
            error={fieldErrors.recoveryCode}
          >
            <Input
              id="recoveryCode"
              name="recoveryCode"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              dir="ltr"
              className="font-mono"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              required
            />
          </Field>
        ) : (
          <Field htmlFor="otpCode" label={t('auth.twoFactor.code')} error={fieldErrors.otpCode}>
            <Input
              id="otpCode"
              name="otpCode"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              dir="ltr"
              className="font-mono tracking-[0.3em]"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </Field>
        )}
        <Button
          type="submit"
          variant="primary"
          loading={verify.busy}
          disabled={useRecovery ? recoveryCode.trim().length === 0 : code.length === 0}
        >
          {useRecovery ? t('auth.twoFactor.submitRecovery') : t('auth.twoFactor.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}

/** A user who just completed the login: where the gates would send them anyway, else `null` (the
 * deep link or `/app` applies). Locale-less path — next-intl's router prefixes the locale. */
function nextAfterLogin(twoFactor: { enabled: boolean; required: boolean }): string | null {
  if (twoFactor.required && !twoFactor.enabled) return '/2fa/setup';
  return null;
}
