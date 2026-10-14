'use client';

import { Button, Field, TextInput } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiErrorMessage } from '../../../../lib/api-error';
import { api } from '../../../../lib/api';

export default function ForgotPasswordPage() {
  const t = useTranslations();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setBusy(true);
    const { error } = await api.POST('/auth/password/forgot', { body: { email } });
    setBusy(false);
    if (error) {
      setFormError(apiErrorMessage(t, error as unknown));
      return;
    }
    setSent(true);
  }

  return (
    <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
      <h1 className="mb-4 text-2xl font-bold">{t('auth.forgot.title')}</h1>
      {formError ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {formError}
        </p>
      ) : null}
      {sent ? (
        <p role="status" className="mb-4 text-sm">
          {t('auth.forgot.always')}
        </p>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <Field htmlFor="email" label={t('auth.forgot.email')}>
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
          <Button type="submit" variant="primary" disabled={busy}>
            {t('auth.forgot.submit')}
          </Button>
        </form>
      )}
    </div>
  );
}
