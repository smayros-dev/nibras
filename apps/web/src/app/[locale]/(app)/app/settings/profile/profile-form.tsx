'use client';

import { LOCALES } from '@tt/contracts/web';
import type { MeUser } from '@tt/contracts';
import { Alert, Button, Card, Field, Input, Select, useSubmit, useToast } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { TimezoneSelect } from '../../../../../../components/timezone-select';
import { useRouter } from '../../../../../../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../../../lib/api-error';
import { api, asApiResult } from '../../../../../../lib/api';

const LANGUAGE_NAMES: Record<(typeof LOCALES)[number], string> = {
  fr: 'Français',
  ar: 'العربية',
  en: 'English',
};

/**
 * Profile editing (name, interface language, time zone, birth date). Saving a new language sets
 * the `tt_locale` cookie (so later requests keep it) and re-navigates to the same page under the
 * new locale through next-intl's locale-aware router; any other save toasts.
 */
export function ProfileForm({ user }: { user: MeUser }) {
  const t = useTranslations();
  const router = useRouter();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [locale, setLocale] = useState(user.locale);
  const [timezone, setTimezone] = useState(user.timezone);
  const [birthDate, setBirthDate] = useState(user.birthDate ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const save = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    try {
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
      if (error) {
        const mapped = issuesToFieldErrors(t, error);
        if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
        else setFormError(apiErrorMessage(t, error));
        return;
      }
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    if (locale !== user.locale) {
      document.cookie = `tt_locale=${locale}; path=/; max-age=31536000`;
      router.push('/app/settings/profile', { locale });
      return;
    }
    toast({ title: t('settings.profile.saved'), variant: 'success' });
    router.refresh();
  });

  return (
    <Card className="max-w-xl">
      <Card.Header>
        <Card.Title>{t('settings.profile.title')}</Card.Title>
      </Card.Header>
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          void save.submit();
        }}
        className="flex flex-col gap-4"
      >
        {formError ? <Alert variant="danger">{formError}</Alert> : null}
        <Field
          htmlFor="firstName"
          label={t('settings.profile.firstName')}
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
          label={t('settings.profile.lastName')}
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
        <Field htmlFor="locale" label={t('settings.profile.language')} error={fieldErrors.locale}>
          <Select
            id="locale"
            name="locale"
            value={locale}
            onChange={(e) => setLocale(e.target.value as typeof locale)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l} lang={l}>
                {LANGUAGE_NAMES[l]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          htmlFor="timezone"
          label={t('settings.profile.timezone')}
          error={fieldErrors.timezone}
        >
          <TimezoneSelect
            id="timezone"
            name="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          />
        </Field>
        <Field
          htmlFor="birthDate"
          label={t('settings.profile.birthDate')}
          error={fieldErrors.birthDate}
        >
          <Input
            id="birthDate"
            name="birthDate"
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />
        </Field>
        <Card.Footer>
          <Button type="submit" variant="primary" loading={save.busy}>
            {t('settings.profile.save')}
          </Button>
        </Card.Footer>
      </form>
    </Card>
  );
}
