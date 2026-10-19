'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, useSubmit, useToast } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DevicesList } from '../../../../../../components/devices-list';
import { useRouter } from '../../../../../../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../../../lib/api-error';
import { api, asApiResult } from '../../../../../../lib/api';
import { useErrorFocus } from '../../../../../../lib/use-error-focus';

type Translator = ReturnType<typeof useTranslations>;

/** Maps an API error to inline field errors when it is a validation failure, else one message. */
function applyError(
  t: Translator,
  error: unknown,
  setFieldErrors: (errors: Record<string, string>) => void,
  setFormError: (message: string) => void,
) {
  const mapped = issuesToFieldErrors(t, error);
  if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
  else setFormError(apiErrorMessage(t, error));
}

/**
 * 2FA status; enable reuses the `/2fa/setup` flow, disable asks for the current password and a
 * code in a dialog (step-up, SP1.6 F5).
 */
function TwoFactorCard({ twoFactor }: { twoFactor: { enabled: boolean; required: boolean } }) {
  const t = useTranslations();
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);

  const disable = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    try {
      const { error } = asApiResult<unknown>(
        await api.POST('/auth/2fa/disable', { body: { otpCode, password } }),
      );
      if (error) {
        if ((error as { code?: string } | null)?.code === 'INVALID_CREDENTIALS') {
          setFieldErrors({ password: t('auth.setup.wrongPassword') });
          return;
        }
        applyError(t, error, setFieldErrors, setFormError);
        return;
      }
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    setOpen(false);
    setOtpCode('');
    setPassword('');
    toast({ title: t('settings.security.twoFactorDisabled'), variant: 'success' });
    router.refresh();
  });

  return (
    <Card>
      <Card.Header>
        <div className="flex flex-wrap items-center gap-2">
          <Card.Title>{t('settings.security.twoFactor')}</Card.Title>
          <Badge variant={twoFactor.enabled ? 'success' : 'neutral'}>
            {twoFactor.enabled
              ? t('settings.security.twoFactorStatusOn')
              : t('settings.security.twoFactorStatusOff')}
          </Badge>
        </div>
        <Card.Description>
          {twoFactor.enabled
            ? t('settings.security.twoFactorOn')
            : t('settings.security.twoFactorOff')}
        </Card.Description>
      </Card.Header>
      {twoFactor.enabled ? (
        twoFactor.required ? (
          <p className="text-sm text-fg-muted">{t('settings.security.twoFactorRequired')}</p>
        ) : (
          <Dialog.Root
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) {
                setOtpCode('');
                setPassword('');
                setFieldErrors({});
                setFormError(null);
              }
            }}
          >
            <Dialog.Trigger asChild>
              <Button variant="danger" className="self-start">
                {t('settings.security.twoFactorDisable')}
              </Button>
            </Dialog.Trigger>
            <Dialog.Content
              title={t('settings.security.twoFactorDisable')}
              description={t('settings.security.disableHint')}
              closeLabel={t('common.close')}
              size="sm"
            >
              <form
                method="post"
                ref={formRef}
                onSubmit={(e) => {
                  e.preventDefault();
                  void disable.submit();
                }}
                className="flex flex-col gap-4"
              >
                {formError ? (
                  <Alert ref={alertRef} tabIndex={-1} variant="danger">
                    {formError}
                  </Alert>
                ) : null}
                <Field
                  htmlFor="disablePassword"
                  label={t('settings.security.twoFactorDisablePassword')}
                  error={fieldErrors.password}
                >
                  <Input
                    id="disablePassword"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </Field>
                <Field
                  htmlFor="otpCode"
                  label={t('settings.security.otpCode')}
                  error={fieldErrors.otpCode}
                >
                  <Input
                    id="otpCode"
                    name="otpCode"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoComplete="one-time-code"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    required
                  />
                </Field>
                <Dialog.Footer>
                  <Dialog.Close asChild>
                    <Button variant="secondary">{t('common.cancel')}</Button>
                  </Dialog.Close>
                  <Button
                    type="submit"
                    variant="danger"
                    loading={disable.busy}
                    disabled={otpCode.length === 0 || password.length === 0}
                  >
                    {t('settings.security.twoFactorDisable')}
                  </Button>
                </Dialog.Footer>
              </form>
            </Dialog.Content>
          </Dialog.Root>
        )
      ) : (
        <Button variant="primary" className="self-start" onClick={() => router.push('/2fa/setup')}>
          {t('settings.security.twoFactorEnable')}
        </Button>
      )}
    </Card>
  );
}

function PasswordCard() {
  const t = useTranslations();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const change = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    try {
      const { error } = asApiResult<unknown>(
        await api.PATCH('/me/password', { body: { currentPassword, newPassword } }),
      );
      if (error) {
        applyError(t, error, setFieldErrors, setFormError);
        return;
      }
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    toast({ title: t('settings.security.passwordChanged'), variant: 'success' });
  });

  return (
    <Card>
      <Card.Header>
        <Card.Title>{t('settings.security.changePassword')}</Card.Title>
      </Card.Header>
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          void change.submit();
        }}
        className="flex max-w-md flex-col gap-4"
      >
        {formError ? <Alert variant="danger">{formError}</Alert> : null}
        <Field
          htmlFor="currentPassword"
          label={t('settings.security.currentPassword')}
          error={fieldErrors.currentPassword}
        >
          <Input
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
        <Button
          type="submit"
          variant="primary"
          className="self-start"
          loading={change.busy}
          disabled={currentPassword.length === 0 || newPassword.length === 0}
        >
          {t('settings.security.changePasswordSubmit')}
        </Button>
      </form>
    </Card>
  );
}

/**
 * Security settings: 2FA (disabled with an explanation when the role makes it mandatory),
 * password change and connected devices, one card each.
 */
export function SecurityPanel({
  twoFactor,
}: {
  twoFactor: { enabled: boolean; required: boolean };
}) {
  const t = useTranslations();
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <TwoFactorCard twoFactor={twoFactor} />
      <PasswordCard />
      <Card>
        <Card.Header>
          <Card.Title>{t('settings.security.devices')}</Card.Title>
        </Card.Header>
        <DevicesList />
      </Card>
    </div>
  );
}
