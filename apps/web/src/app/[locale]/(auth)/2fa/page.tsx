'use client';

import type { LoginResponse } from '@tt/contracts';
import { Button, Field, TextInput } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from '../../../../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../lib/api-error';
import { api, asApiResult } from '../../../../lib/api';
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
  const [busy, setBusy] = useState(false);
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setFieldErrors({});
    setFormError(null);
    setBusy(true);
    const { data, error } = asApiResult<LoginResponse>(
      useRecovery
        ? await api.POST('/auth/2fa/recovery', {
            body: {
              challengeToken: challenge.challengeToken,
              recoveryCode,
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
    setBusy(false);
    if (error) {
      const body = error as unknown;
      const mapped = issuesToFieldErrors(t, body);
      if (Object.keys(mapped).length > 0) {
        setFieldErrors(mapped);
      } else {
        setFormError(apiErrorMessage(t, body));
      }
      return;
    }
    if (data?.status === 'OK') {
      sessionStorage.removeItem(CHALLENGE_STORAGE_KEY);
      router.push(nextAfterLogin(data.user.twoFactor) ?? sanitizeNext(challenge.next) ?? '/app');
    }
  }

  if (!challenge) {
    return <p className="text-lg">{t('common.loading')}</p>;
  }

  return (
    <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
      <h1 className="mb-4 text-2xl font-bold">{t('auth.twoFactor.title')}</h1>
      {formError ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {formError}
        </p>
      ) : null}
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        {useRecovery ? (
          <Field
            htmlFor="recoveryCode"
            label={t('auth.twoFactor.recoveryCode')}
            error={fieldErrors.recoveryCode}
          >
            <TextInput
              id="recoveryCode"
              name="recoveryCode"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              required
            />
          </Field>
        ) : (
          <Field htmlFor="otpCode" label={t('auth.twoFactor.code')} error={fieldErrors.otpCode}>
            <TextInput
              id="otpCode"
              name="otpCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </Field>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={busy || (useRecovery ? recoveryCode.length === 0 : code.length === 0)}
        >
          {useRecovery ? t('auth.twoFactor.submitRecovery') : t('auth.twoFactor.submit')}
        </Button>
      </form>
      <p className="mt-4 text-sm">
        <button
          type="button"
          className="text-brand-700 hover:underline"
          onClick={() => {
            setUseRecovery((v) => !v);
            setFormError(null);
            setFieldErrors({});
          }}
        >
          {useRecovery ? t('auth.twoFactor.code') : t('auth.twoFactor.useRecovery')}
        </button>
      </p>
    </div>
  );
}

/** A user who just completed the login: where the gates would send them anyway, else `null` (the
 * deep link or `/app` applies). Locale-less path — next-intl's router prefixes the locale. */
function nextAfterLogin(twoFactor: { enabled: boolean; required: boolean }): string | null {
  if (twoFactor.required && !twoFactor.enabled) return '/2fa/setup';
  return null;
}
