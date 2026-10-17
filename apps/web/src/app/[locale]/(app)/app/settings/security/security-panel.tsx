'use client';

import { Button, Field, TextInput } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DevicesList } from '../../../../../../components/devices-list';
import { useRouter } from '../../../../../../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../../../lib/api-error';
import { api } from '../../../../../../lib/api';

/**
 * Security settings: 2FA (enable reuses the `/2fa/setup` flow; disable needs a code; disabled
 * with an explanation when the role makes it mandatory), password change and connected devices.
 */
export function SecurityPanel({
  twoFactor,
}: {
  twoFactor: { enabled: boolean; required: boolean };
}) {
  const t = useTranslations();
  const router = useRouter();
  const [otpCode, setOtpCode] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function disable(event: React.FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);
    setStatus(null);
    setBusy(true);
    const { error } = await api.POST('/auth/2fa/disable', { body: { otpCode } });
    setBusy(false);
    if (error) {
      const mapped = issuesToFieldErrors(error as unknown);
      if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
      else setFormError(apiErrorMessage(t, error as unknown));
      return;
    }
    router.refresh();
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);
    setStatus(null);
    setBusy(true);
    const { error } = await api.PATCH('/me/password', {
      body: { currentPassword, newPassword },
    });
    setBusy(false);
    if (error) {
      const mapped = issuesToFieldErrors(error as unknown);
      if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
      else setFormError(apiErrorMessage(t, error as unknown));
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setStatus(t('settings.security.passwordChanged'));
  }

  return (
    <div className="flex max-w-xl flex-col gap-8">
      {formError ? (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="text-sm text-success">
          {status}
        </p>
      ) : null}

      <section aria-labelledby="two-factor-title">
        <h2 id="two-factor-title" className="mb-2 text-lg font-bold">
          {t('settings.security.twoFactor')}
        </h2>
        {twoFactor.enabled ? (
          <p className="mb-3 text-sm">{t('settings.security.twoFactorOn')}</p>
        ) : (
          <p className="mb-3 text-sm">{t('settings.security.twoFactorOff')}</p>
        )}
        {twoFactor.enabled ? (
          twoFactor.required ? (
            <p className="text-sm text-gray-500">{t('settings.security.twoFactorRequired')}</p>
          ) : (
            <form onSubmit={(e) => void disable(e)} className="flex flex-col gap-3">
              <p className="text-sm">{t('settings.security.disableHint')}</p>
              <Field
                htmlFor="otpCode"
                label={t('settings.security.otpCode')}
                error={fieldErrors.otpCode}
              >
                <TextInput
                  id="otpCode"
                  name="otpCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  required
                />
              </Field>
              <Button type="submit" variant="danger" disabled={busy || otpCode.length === 0}>
                {t('settings.security.twoFactorDisable')}
              </Button>
            </form>
          )
        ) : (
          <Button variant="primary" onClick={() => router.push('/2fa/setup')}>
            {t('settings.security.twoFactorEnable')}
          </Button>
        )}
      </section>

      <section aria-labelledby="password-title">
        <h2 id="password-title" className="mb-2 text-lg font-bold">
          {t('settings.security.changePassword')}
        </h2>
        <form onSubmit={(e) => void changePassword(e)} className="flex flex-col gap-3">
          <Field
            htmlFor="currentPassword"
            label={t('settings.security.currentPassword')}
            error={fieldErrors.currentPassword}
          >
            <TextInput
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </Field>
          <Field
            htmlFor="newPassword"
            label={t('settings.security.newPassword')}
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
          <Button
            type="submit"
            variant="primary"
            disabled={busy || currentPassword.length === 0 || newPassword.length === 0}
          >
            {t('settings.security.changePasswordSubmit')}
          </Button>
        </form>
      </section>

      <section aria-labelledby="devices-title">
        <h2 id="devices-title" className="mb-2 text-lg font-bold">
          {t('settings.security.devices')}
        </h2>
        <DevicesList />
      </section>
    </div>
  );
}
