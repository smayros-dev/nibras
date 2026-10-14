'use client';

import { LOCALES, type MeUser } from '@tt/contracts';
import { Button, Field, Select, TextInput } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '../../../../../../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../../../lib/api-error';
import { api, asApiResult } from '../../../../../../lib/api';

/** PRD §8.1.1 regions first, then whatever the runtime can resolve. */
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

/**
 * Profile editing (name, interface language, time zone, birth date). Saving a new language sets
 * the `tt_locale` cookie (so later requests keep it) and re-navigates to the same page under the
 * new locale through next-intl's locale-aware router.
 */
export function ProfileForm({ user }: { user: MeUser }) {
  const t = useTranslations();
  const router = useRouter();
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [locale, setLocale] = useState(user.locale);
  const [timezone, setTimezone] = useState(user.timezone);
  const [birthDate, setBirthDate] = useState(user.birthDate ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);
    setSaved(false);
    setBusy(true);
    const { error } = asApiResult<MeUser>(
      await api.PATCH('/me', {
        body: {
          firstName,
          lastName,
          locale,
          timezone,
          ...(birthDate ? { birthDate } : {}),
        },
      }),
    );
    setBusy(false);
    if (error) {
      const mapped = issuesToFieldErrors(error as unknown);
      if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
      else setFormError(apiErrorMessage(t, error as unknown));
      return;
    }
    if (locale !== user.locale) {
      document.cookie = `tt_locale=${locale}; path=/; max-age=31536000`;
      router.push('/app/settings/profile', { locale });
      return;
    }
    setSaved(true);
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex w-full max-w-md flex-col gap-4">
      <h2 className="text-xl font-bold">{t('settings.profile.title')}</h2>
      {formError ? (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-success">
          {t('settings.profile.saved')}
        </p>
      ) : null}
      <Field htmlFor="firstName" label={t('settings.profile.firstName')} error={fieldErrors.firstName}>
        <TextInput
          id="firstName"
          name="firstName"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
        />
      </Field>
      <Field htmlFor="lastName" label={t('settings.profile.lastName')} error={fieldErrors.lastName}>
        <TextInput
          id="lastName"
          name="lastName"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          required
        />
      </Field>
      <Field htmlFor="locale" label={t('settings.profile.language')}>
        <Select
          id="locale"
          name="locale"
          value={locale}
          onChange={(e) => setLocale(e.target.value as typeof locale)}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {l === 'fr' ? 'Français' : l === 'ar' ? 'العربية' : 'English'}
            </option>
          ))}
        </Select>
      </Field>
      <Field htmlFor="timezone" label={t('settings.profile.timezone')} error={fieldErrors.timezone}>
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
      <Field htmlFor="birthDate" label={t('settings.profile.birthDate')} error={fieldErrors.birthDate}>
        <TextInput
          id="birthDate"
          name="birthDate"
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" disabled={busy}>
        {t('settings.profile.save')}
      </Button>
    </form>
  );
}
