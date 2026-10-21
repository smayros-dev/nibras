'use client';

import { isMinor, LOCALES, type Locale } from '@nibras/contracts/web';
import type { AcceptResult } from '@nibras/contracts';
import { Alert, Checkbox, Field, Input, Select } from '@nibras/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from '../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../lib/api-error';
import { useErrorFocus } from '../lib/use-error-focus';
import { useTimezones } from '../lib/timezones';
import { NATIVE_NAMES } from './locale-menu';
import { TimezoneSelect } from './timezone-select';

/**
 * Shared state and fields of the public acceptance forms (invitation page, join page): the
 * register fields as on `/register`, the student's birth date and the guardian email a minor
 * needs (D-P3), the legal checkbox, and the mapping of the acceptance errors onto fields.
 */

const MIN_PASSWORD_LENGTH = 12;
const BIRTH_DATE_MIN = '1900-01-01';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `nibras_locale` cookie: the proxy prefers it over `Accept-Language` on the next request. */
export function setLocaleCookie(locale: string) {
  document.cookie = `nibras_locale=${locale}; path=/; max-age=31536000`;
}

/** Errors the API reports by code that belong to one field of these forms. */
const FIELD_CODES: Record<string, string> = {
  BIRTH_DATE_REQUIRED: 'birthDate',
  GUARDIAN_EMAIL_REQUIRED: 'guardianEmail',
  GUARDIAN_EMAIL_INVALID: 'guardianEmail',
  PASSWORD_TOO_SHORT: 'password',
  PASSWORD_TOO_COMMON: 'password',
  PASSWORD_COMPROMISED: 'password',
};

export interface AcceptFormOptions {
  /** The birth date field is shown up front (a student with no known birth date). */
  askBirthDate: boolean;
  /** The inviter already gave a guardian email: never ask for one unless the API says so. */
  guardianPrefilled?: boolean;
  /** The join form's `REGISTER` carries the address (`EMAIL_TAKEN` → the email field). */
  withEmail?: boolean;
}

export function useAcceptForm({
  askBirthDate,
  guardianPrefilled = false,
  withEmail = false,
}: AcceptFormOptions) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formLocale, setFormLocale] = useState<Locale>(locale);
  // Empty on the server and in the first client render (hydration-safe), then the browser's zone.
  const [timezone, setTimezone] = useState('');
  const timezoneTouched = useRef(false);
  const { resolved, ready } = useTimezones();
  const [birthDate, setBirthDate] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  // Fields the API asked for after a submit (a birth date or guardian it could not infer).
  const [forceBirthDate, setForceBirthDate] = useState(false);
  const [forceGuardian, setForceGuardian] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);

  useEffect(() => {
    if (ready && !timezoneTouched.current) setTimezone(resolved ?? 'UTC');
  }, [ready, resolved]);

  const showBirthDate = askBirthDate || forceBirthDate;
  const minor = ISO_DATE.test(birthDate) && isMinor(birthDate);
  const showGuardian = forceGuardian || (!guardianPrefilled && showBirthDate && minor);

  /** The student fields of a `REGISTER` or `JOIN` body (only the ones shown and filled). */
  function studentBody(): { birthDate?: string; guardianEmail?: string } {
    return {
      ...(showBirthDate && birthDate ? { birthDate } : {}),
      ...(showGuardian && guardianEmail.trim() ? { guardianEmail: guardianEmail.trim() } : {}),
    };
  }

  /** The `REGISTER` body without an address (the invitation supplies it; the join form adds it). */
  function registerBody() {
    return {
      mode: 'REGISTER' as const,
      firstName,
      lastName,
      password,
      locale: formLocale,
      timezone: timezone || 'UTC',
      ...studentBody(),
      acceptTerms: true as const,
      acceptPrivacy: true as const,
    };
  }

  function reset() {
    setFieldErrors({});
    setFormError(null);
  }

  /** Client-side check before a `REGISTER`; `false` when a field error was set. */
  function checkRegister(): boolean {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFieldErrors({ password: t('errors.PASSWORD_TOO_SHORT') });
      return false;
    }
    return true;
  }

  /** Maps a failed acceptance onto the fields (revealing the student ones the API asked for). */
  function fail(error: unknown) {
    const mapped = issuesToFieldErrors(t, error);
    if (Object.keys(mapped).length > 0) {
      if (mapped.birthDate) setForceBirthDate(true);
      if (mapped.guardianEmail) setForceGuardian(true);
      setFieldErrors(mapped);
      return;
    }
    const code = (error as { code?: unknown } | null)?.code;
    const field =
      typeof code === 'string'
        ? (FIELD_CODES[code] ?? (withEmail && code === 'EMAIL_TAKEN' ? 'email' : undefined))
        : undefined;
    if (field && typeof code === 'string') {
      if (field === 'birthDate') setForceBirthDate(true);
      if (field === 'guardianEmail') setForceGuardian(true);
      setFieldErrors({ [field]: apiErrorMessage(t, error) });
      return;
    }
    setFormError(apiErrorMessage(t, error));
  }

  return {
    values: {
      firstName,
      lastName,
      email,
      password,
      formLocale,
      timezone,
      birthDate,
      guardianEmail,
      acceptTerms,
    },
    set: {
      firstName: setFirstName,
      lastName: setLastName,
      email: setEmail,
      password: setPassword,
      formLocale: setFormLocale,
      timezone: (value: string) => {
        timezoneTouched.current = true;
        setTimezone(value);
      },
      birthDate: setBirthDate,
      guardianEmail: setGuardianEmail,
      acceptTerms: setAcceptTerms,
    },
    showBirthDate,
    showGuardian,
    fieldErrors,
    formError,
    setFormError,
    formRef,
    alertRef,
    studentBody,
    registerBody,
    reset,
    checkRegister,
    fail,
  };
}

export type AcceptForm = ReturnType<typeof useAcceptForm>;

/** The form-level error, focused after a failed submit (`useErrorFocus`). */
export function FormError({ form }: { form: AcceptForm }) {
  return form.formError ? (
    <Alert ref={form.alertRef} tabIndex={-1} variant="danger">
      {form.formError}
    </Alert>
  ) : null;
}

/** Prénom, nom, (email), mot de passe, langue, fuseau — the `/register` fields. */
export function RegisterFields({
  form,
  withEmail = false,
}: {
  form: AcceptForm;
  withEmail?: boolean;
}) {
  const t = useTranslations();
  const { values, set, fieldErrors } = form;
  return (
    <>
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
            value={values.firstName}
            onChange={(e) => set.firstName(e.target.value)}
            required
          />
        </Field>
        <Field htmlFor="lastName" label={t('auth.register.lastName')} error={fieldErrors.lastName}>
          <Input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            value={values.lastName}
            onChange={(e) => set.lastName(e.target.value)}
            required
          />
        </Field>
      </div>
      {withEmail ? (
        <Field htmlFor="email" label={t('auth.register.email')} error={fieldErrors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={(e) => set.email(e.target.value)}
            required
          />
        </Field>
      ) : null}
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
          value={values.password}
          onChange={(e) => set.password(e.target.value)}
          required
        />
      </Field>
      <Field htmlFor="locale" label={t('auth.register.locale')} error={fieldErrors.locale}>
        <Select
          id="locale"
          name="locale"
          value={values.formLocale}
          onChange={(e) => set.formLocale(e.target.value as Locale)}
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
          value={values.timezone}
          onChange={(e) => set.timezone(e.target.value)}
        />
      </Field>
    </>
  );
}

/** Date de naissance (students) and, for a minor, the guardian's email (PRD §8.3.5). */
export function StudentFields({ form }: { form: AcceptForm }) {
  const t = useTranslations();
  const { values, set, fieldErrors, showBirthDate, showGuardian } = form;
  // UTC calendar date, as the API's `BirthDateSchema` checks it.
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      {showBirthDate ? (
        <Field htmlFor="birthDate" label={t('invite.birthDate')} error={fieldErrors.birthDate}>
          <Input
            id="birthDate"
            name="birthDate"
            type="date"
            autoComplete="bday"
            min={BIRTH_DATE_MIN}
            max={today}
            value={values.birthDate}
            onChange={(e) => set.birthDate(e.target.value)}
            required
          />
        </Field>
      ) : null}
      {showGuardian ? (
        <Field
          htmlFor="guardianEmail"
          label={t('invite.guardianEmail')}
          description={t('invite.guardianHint')}
          error={fieldErrors.guardianEmail}
        >
          <Input
            id="guardianEmail"
            name="guardianEmail"
            type="email"
            autoComplete="off"
            value={values.guardianEmail}
            onChange={(e) => set.guardianEmail(e.target.value)}
            required
          />
        </Field>
      ) : null}
    </>
  );
}

/** Terms + privacy link inside the checkbox label; a new tab keeps the half-filled form. */
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

/** « J'accepte les conditions d'utilisation et la politique de confidentialité ». */
export function LegalCheckbox({ form }: { form: AcceptForm }) {
  const t = useTranslations();
  return (
    <Checkbox
      label={t.rich('auth.register.acceptTerms', {
        terms: legalLink('/legal/terms'),
        privacy: legalLink('/legal/privacy'),
      })}
      checked={form.values.acceptTerms}
      onCheckedChange={(checked) => form.set.acceptTerms(checked === true)}
      required
    />
  );
}

/** Where a successful acceptance lands: staff → verification, a waiting minor → the workspace (its waiting panel), else the dashboard. */
export function acceptDestination(result: AcceptResult): string {
  if (result.role !== 'STUDENT') return '/app/settings/verification';
  if (result.membershipStatus === 'PENDING_GUARDIAN_CONSENT') {
    return `/app/w/${result.workspace.id}`;
  }
  return '/app';
}
