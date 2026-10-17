'use client';

import { LOCALES, type MeUser } from '@tt/contracts';
import { Alert, Button, Checkbox, Field, Input, Select, useSubmit } from '@tt/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AuthCard } from '../../../../components/auth-card';
import { NATIVE_NAMES } from '../../../../components/locale-menu';
import { TimezoneSelect } from '../../../../components/timezone-select';
import { Link, useRouter } from '../../../../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../lib/api-error';
import { api, asApiResult } from '../../../../lib/api';
import { useErrorFocus } from '../../../../lib/use-error-focus';
import { useTimezones } from '../../../../lib/timezones';

const MIN_PASSWORD_LENGTH = 12;

/** `tt_locale` cookie: the proxy prefers it over `Accept-Language` on the next request. */
function setLocaleCookie(locale: string) {
  document.cookie = `tt_locale=${locale}; path=/; max-age=31536000`;
}

/** Legal page link inside the terms checkbox label; a new tab keeps the half-filled form. */
function legalLink(href: '/legal/terms' | '/legal/privacy') {
  function LegalLink(chunks: ReactNode) {
    return (
      <Link
        href={href}
        target="_blank"
        rel="noopener"
        className="font-semibold text-primary underline-offset-4 hover:underline"
      >
        {chunks}
      </Link>
    );
  }
  return LegalLink;
}

export default function RegisterPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formLocale, setFormLocale] = useState(locale);
  // Empty on the server and in the first client render (hydration-safe, audit #7); filled with the
  // browser's zone once known, unless the user already picked one.
  const [timezone, setTimezone] = useState('');
  const timezoneTouched = useRef(false);
  const { resolved, ready } = useTimezones();
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);

  useEffect(() => {
    if (ready && !timezoneTouched.current) setTimezone(resolved ?? 'UTC');
  }, [ready, resolved]);

  const register = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFieldErrors({ password: t('errors.PASSWORD_TOO_SHORT') });
      return;
    }
    let result: { data?: { user: MeUser }; error?: unknown };
    try {
      result = asApiResult<{ user: MeUser }>(
        await api.POST('/auth/register', {
          body: {
            kind: 'TEACHER',
            firstName,
            lastName,
            email,
            password,
            locale: formLocale,
            timezone: timezone || 'UTC',
            acceptTerms: true,
            acceptPrivacy: true,
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
    if (!data) {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    setLocaleCookie(data.user.locale);
    router.push('/verify-email');
  });

  return (
    <AuthCard
      title={t('auth.register.title')}
      description={t('auth.register.subtitle')}
      footer={
        <p>
          {t('auth.register.haveAccount')}{' '}
          <Link href="/login" className="font-semibold text-primary hover:underline">
            {t('auth.register.loginLink')}
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
          void register.submit();
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            htmlFor="firstName"
            label={t('auth.register.firstName')}
            error={fieldErrors.firstName}
          >
            <Input
              id="firstName"
              name="firstName"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </Field>
          <Field
            htmlFor="lastName"
            label={t('auth.register.lastName')}
            error={fieldErrors.lastName}
          >
            <Input
              id="lastName"
              name="lastName"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </Field>
        </div>
        <Field htmlFor="email" label={t('auth.register.email')} error={fieldErrors.email}>
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
        <Field
          htmlFor="password"
          label={t('auth.register.password')}
          description={t('auth.register.passwordHint')}
          error={fieldErrors.password}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Field htmlFor="locale" label={t('auth.register.locale')}>
          <Select
            id="locale"
            name="locale"
            value={formLocale}
            onChange={(e) => setFormLocale(e.target.value as typeof formLocale)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l} lang={l}>
                {NATIVE_NAMES[l]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          htmlFor="timezone"
          label={t('auth.register.timezone')}
          description={t('auth.register.timezoneHint')}
          error={fieldErrors.timezone}
        >
          <TimezoneSelect
            id="timezone"
            name="timezone"
            value={timezone}
            onChange={(e) => {
              timezoneTouched.current = true;
              setTimezone(e.target.value);
            }}
          />
        </Field>
        <Checkbox
          label={t.rich('auth.register.acceptTerms', {
            terms: legalLink('/legal/terms'),
            privacy: legalLink('/legal/privacy'),
          })}
          checked={acceptTerms}
          onCheckedChange={(checked) => setAcceptTerms(checked === true)}
          required
        />
        <Button type="submit" variant="primary" loading={register.busy} disabled={!acceptTerms}>
          {t('auth.register.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
