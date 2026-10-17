'use client';

import { LOCALES, type MeUser } from '@tt/contracts';
import { Button, Checkbox, Field, Select, TextInput } from '@tt/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '../../../../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../lib/api-error';
import { api, asApiResult } from '../../../../lib/api';

const MIN_PASSWORD_LENGTH = 12;

/** PRD §8.1.1 regions first, then whatever the runtime can resolve; the resolved zone is added if missing. */
const TIME_ZONES = [
  'Africa/Tunis',
  'Africa/Algiers',
  'Africa/Cairo',
  'Africa/Casablanca',
  'Europe/Paris',
  'UTC',
];

function timezoneOptions(): string[] {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const all = [...TIME_ZONES, ...supported];
  if (resolved && !all.includes(resolved)) all.unshift(resolved);
  return Array.from(new Set(all));
}

/** `tt_locale` cookie: the proxy prefers it over `Accept-Language` on the next request. */
function setLocaleCookie(locale: string) {
  document.cookie = `tt_locale=${locale}; path=/; max-age=31536000`;
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
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFieldErrors({ password: t('errors.PASSWORD_TOO_SHORT') });
      return;
    }
    setBusy(true);
    const { data, error } = asApiResult<{ user: MeUser }>(
      await api.POST('/auth/register', {
        body: {
          kind: 'TEACHER',
          firstName,
          lastName,
          email,
          password,
          locale: formLocale,
          timezone,
          acceptTerms: true,
          acceptPrivacy: true,
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
    if (!data) {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    setLocaleCookie(data.user.locale);
    router.push('/verify-email');
  }

  return (
    <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
      <h1 className="mb-4 text-2xl font-bold">{t('auth.register.title')}</h1>
      {formError ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {formError}
        </p>
      ) : null}
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Field
          htmlFor="firstName"
          label={t('auth.register.firstName')}
          error={fieldErrors.firstName}
        >
          <TextInput
            id="firstName"
            name="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </Field>
        <Field htmlFor="lastName" label={t('auth.register.lastName')} error={fieldErrors.lastName}>
          <TextInput
            id="lastName"
            name="lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </Field>
        <Field htmlFor="email" label={t('auth.register.email')} error={fieldErrors.email}>
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
        <Field htmlFor="password" label={t('auth.register.password')} error={fieldErrors.password}>
          <TextInput
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
              <option key={l} value={l}>
                {l === 'fr' ? 'Français' : l === 'ar' ? 'العربية' : 'English'}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="timezone" label={t('auth.register.timezone')} error={fieldErrors.timezone}>
          <Select
            id="timezone"
            name="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {timezoneOptions().map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox
          label={t('auth.register.acceptTerms')}
          checked={acceptTerms}
          onChange={(e) => setAcceptTerms(e.target.checked)}
          required
        />
        <Button type="submit" variant="primary" disabled={busy || !acceptTerms}>
          {t('auth.register.submit')}
        </Button>
      </form>
      <p className="mt-4 text-sm">
        {t('auth.register.haveAccount')}{' '}
        <a href={`/${locale}/login`} className="text-brand-700 hover:underline">
          {t('auth.register.loginLink')}
        </a>
      </p>
    </div>
  );
}
