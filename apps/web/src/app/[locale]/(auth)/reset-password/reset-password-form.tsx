'use client';

import { Alert, Button, Field, Input, useSubmit, useToast } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AuthCard } from '../../../../components/auth-card';
import { Link, useRouter } from '../../../../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../lib/api-error';
import { api } from '../../../../lib/api';

const MIN_PASSWORD_LENGTH = 12;

/** Expiry of the emailed link (or a bad body): "Lien expiré" + a way to request a fresh one. */
function isTokenInvalid(body: unknown): boolean {
  return (body as { code?: string } | null)?.code === 'TOKEN_INVALID';
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const t = useTranslations();
  const router = useRouter();
  const { toast } = useToast();
  const [newPassword, setNewPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [tokenInvalid, setTokenInvalid] = useState(false);

  const reset = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setFieldErrors({ newPassword: t('errors.PASSWORD_TOO_SHORT') });
      return;
    }
    try {
      const { error } = await api.POST('/auth/password/reset', {
        body: { token: token ?? '', newPassword },
      });
      if (error) {
        if (isTokenInvalid(error)) {
          setTokenInvalid(true);
          return;
        }
        const mapped = issuesToFieldErrors(t, error);
        if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
        else setFormError(apiErrorMessage(t, error));
        return;
      }
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    // The toast outlives the client navigation (provider in the locale layout).
    toast({ title: t('auth.reset.success'), variant: 'success' });
    router.push('/login');
  });

  if (!token || tokenInvalid) {
    return (
      <AuthCard title={t('auth.reset.tokenInvalid')}>
        <Button asChild variant="primary">
          <Link href="/forgot-password">{t('auth.reset.requestNew')}</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('auth.reset.title')}>
      {formError ? <Alert variant="danger">{formError}</Alert> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void reset.submit();
        }}
        className="flex flex-col gap-4"
      >
        <Field
          htmlFor="newPassword"
          label={t('auth.reset.newPassword')}
          description={t('auth.register.passwordHint')}
          error={fieldErrors.newPassword}
        >
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" loading={reset.busy}>
          {t('auth.reset.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
