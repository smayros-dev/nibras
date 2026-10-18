'use client';

import { Alert, Button, Field, Input, useSubmit } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AuthCard } from '../../../../components/auth-card';
import { Link } from '../../../../i18n/navigation';
import { apiErrorMessage } from '../../../../lib/api-error';
import { api } from '../../../../lib/api';
import { useErrorFocus } from '../../../../lib/use-error-focus';

export default function ForgotPasswordPage() {
  const t = useTranslations();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(undefined, formError);

  const request = useSubmit(async () => {
    setFormError(null);
    try {
      const { error } = await api.POST('/auth/password/forgot', { body: { email } });
      if (error) {
        setFormError(apiErrorMessage(t, error));
        return;
      }
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    setSent(true);
  });

  return (
    <AuthCard
      title={t('auth.forgot.title')}
      description={sent ? undefined : t('auth.forgot.subtitle')}
      footer={
        <Link href="/login" className="self-start font-semibold text-primary hover:underline">
          {t('auth.forgot.backToLogin')}
        </Link>
      }
    >
      {formError ? (
        <Alert ref={alertRef} tabIndex={-1} variant="danger">
          {formError}
        </Alert>
      ) : null}
      {sent ? (
        // Same message whether or not the address has an account (no enumeration).
        <Alert variant="success">{t('auth.forgot.always')}</Alert>
      ) : (
        <form
          method="post"
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            void request.submit();
          }}
          className="flex flex-col gap-4"
        >
          <Field htmlFor="email" label={t('auth.forgot.email')}>
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
          <Button type="submit" variant="primary" loading={request.busy}>
            {t('auth.forgot.submit')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
