'use client';

import type { LoginResponse } from '@tt/contracts';
import { Button, Checkbox, Field, TextInput } from '@tt/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '../../../../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../lib/api-error';
import { api, asApiResult } from '../../../../lib/api';
import { sanitizeNext } from '../../../../lib/sanitize-next';
import { CHALLENGE_STORAGE_KEY, serializeChallenge } from '../../../../lib/two-factor-challenge';

/** `tt_locale` cookie: the proxy prefers it over `Accept-Language` on the next request. */
function setLocaleCookie(locale: string) {
  document.cookie = `tt_locale=${locale}; path=/; max-age=31536000`;
}

export function LoginForm({ next }: { next: string | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);
    setBusy(true);
    const { data, error } = asApiResult<LoginResponse>(
      await api.POST('/auth/login', {
        body: { email, password, remember },
      }),
    );
    setBusy(false);
    if (error) {
      const body = error as unknown;
      const mapped = issuesToFieldErrors(body);
      if (Object.keys(mapped).length > 0) {
        setFieldErrors(mapped);
      } else {
        setFormError(apiErrorMessage(t, body));
      }
      return;
    }
    if (data?.status === 'TWO_FACTOR_REQUIRED') {
      sessionStorage.setItem(
        CHALLENGE_STORAGE_KEY,
        serializeChallenge({ challengeToken: data.challengeToken, remember, next }),
      );
      router.push('/2fa');
      return;
    }
    if (data?.status === 'OK') {
      setLocaleCookie(data.user.locale);
      router.push(sanitizeNext(next) ?? '/app');
    }
  }

  return (
    <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
      <h1 className="mb-4 text-2xl font-bold">{t('auth.login.title')}</h1>
      {formError ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {formError}
        </p>
      ) : null}
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Field htmlFor="email" label={t('auth.login.email')} error={fieldErrors.email}>
          <TextInput
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field htmlFor="password" label={t('auth.login.password')} error={fieldErrors.password}>
          <TextInput
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Checkbox
          label={t('auth.login.remember')}
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        <Button type="submit" variant="primary" disabled={busy}>
          {t('auth.login.submit')}
        </Button>
      </form>
      <p className="mt-4 text-sm">
        <a href={`/${locale}/forgot-password`} className="text-brand-700 hover:underline">
          {t('auth.login.forgot')}
        </a>
      </p>
      <p className="mt-2 text-sm">
        {t('auth.login.noAccount')}{' '}
        <a href={`/${locale}/register`} className="text-brand-700 hover:underline">
          {t('auth.login.registerLink')}
        </a>
      </p>
    </div>
  );
}
