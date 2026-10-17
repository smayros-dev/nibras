'use client';

import type { LoginResponse } from '@tt/contracts';
import { Alert, Button, Checkbox, Field, Input, useSubmit } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AuthCard } from '../../../../components/auth-card';
import { Link, useRouter } from '../../../../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../lib/api-error';
import { api, asApiResult } from '../../../../lib/api';
import { useErrorFocus } from '../../../../lib/use-error-focus';
import { sanitizeNext } from '../../../../lib/sanitize-next';
import { CHALLENGE_STORAGE_KEY, serializeChallenge } from '../../../../lib/two-factor-challenge';

/** `tt_locale` cookie: the proxy prefers it over `Accept-Language` on the next request. */
function setLocaleCookie(locale: string) {
  document.cookie = `tt_locale=${locale}; path=/; max-age=31536000`;
}

export function LoginForm({ next }: { next: string | null }) {
  const t = useTranslations();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);

  const login = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    let result: { data?: LoginResponse; error?: unknown };
    try {
      result = asApiResult<LoginResponse>(
        await api.POST('/auth/login', { body: { email, password, remember } }),
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
  });

  return (
    <AuthCard
      title={t('auth.login.title')}
      description={t('auth.login.subtitle')}
      footer={
        <p>
          {t('auth.login.noAccount')}{' '}
          <Link href="/register" className="font-semibold text-primary hover:underline">
            {t('auth.login.registerLink')}
          </Link>
        </p>
      }
    >
      {formError ? (
        <Alert ref={alertRef} tabIndex={-1} variant="danger">
          {formError}
        </Alert>
      ) : null}
      <form
        method="post"
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          void login.submit();
        }}
        className="flex flex-col gap-4"
      >
        <Field htmlFor="email" label={t('auth.login.email')} error={fieldErrors.email}>
          <Input
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
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <Checkbox
            label={t('auth.login.remember')}
            checked={remember}
            onCheckedChange={(checked) => setRemember(checked === true)}
          />
          <Link
            href="/forgot-password"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
          >
            {t('auth.login.forgot')}
          </Link>
        </div>
        <Button type="submit" variant="primary" loading={login.busy}>
          {t('auth.login.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
