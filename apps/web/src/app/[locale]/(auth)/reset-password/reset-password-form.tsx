'use client';

import { Button, Field, TextInput } from '@tt/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../lib/api-error';
import { api } from '../../../../lib/api';

const MIN_PASSWORD_LENGTH = 12;

/** Expiry of the emailed link (or a bad body): "Lien expiré" + a way to request a fresh one. */
function isTokenInvalid(body: unknown): boolean {
  return (body as { code?: string } | null)?.code === 'TOKEN_INVALID';
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const [newPassword, setNewPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setFieldErrors({ newPassword: t('errors.PASSWORD_TOO_SHORT') });
      return;
    }
    setBusy(true);
    const { error } = await api.POST('/auth/password/reset', {
      body: { token: token ?? '', newPassword },
    });
    setBusy(false);
    if (error) {
      const body = error as unknown;
      if (isTokenInvalid(body)) {
        setTokenInvalid(true);
        return;
      }
      const mapped = issuesToFieldErrors(t, body);
      if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
      else setFormError(apiErrorMessage(t, body));
      return;
    }
    setDone(true);
  }

  if (!token || tokenInvalid) {
    return (
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
        <h1 className="mb-4 text-2xl font-bold">{t('auth.reset.tokenInvalid')}</h1>
        <a href={`/${locale}/forgot-password`} className="text-brand-700 hover:underline">
          {t('auth.reset.requestNew')}
        </a>
      </div>
    );
  }

  if (done) {
    return (
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
        <p role="status" className="text-lg">
          {t('auth.reset.success')}
        </p>
        <a href={`/${locale}/login`} className="mt-4 inline-block text-brand-700 hover:underline">
          {t('auth.login.title')}
        </a>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
      <h1 className="mb-4 text-2xl font-bold">{t('auth.reset.title')}</h1>
      {formError ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {formError}
        </p>
      ) : null}
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Field
          htmlFor="newPassword"
          label={t('auth.reset.newPassword')}
          error={fieldErrors.newPassword}
        >
          <TextInput
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>
          {t('auth.reset.submit')}
        </Button>
      </form>
    </div>
  );
}
