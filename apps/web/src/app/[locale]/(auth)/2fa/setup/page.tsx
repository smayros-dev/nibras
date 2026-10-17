'use client';

import type { TwoFactorRecoveryCodes, TwoFactorSetupResponse } from '@tt/contracts';
import { Alert, Button, Checkbox, Field, Input, useSubmit, useToast } from '@tt/ui';
import { Copy, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { AuthCard, AuthLoading } from '../../../../../components/auth-card';
import { useRouter } from '../../../../../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../../lib/api-error';
import { api, asApiResult } from '../../../../../lib/api';
import { useErrorFocus } from '../../../../../lib/use-error-focus';

type Phase = 'loading' | 'scan' | 'codes' | 'failed';

/**
 * Mandatory 2FA enrolment (AC-AUTH-05): scan the QR, confirm a code, then the single-use
 * recovery codes are shown once — download or copy, acknowledge, continue.
 */
export default function TwoFactorSetupPage() {
  const t = useTranslations();
  const router = useRouter();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>('loading');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [savedAck, setSavedAck] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const { data, error } = asApiResult<TwoFactorSetupResponse>(
          await api.POST('/auth/2fa/setup'),
        );
        if (error || !data) {
          setFormError(apiErrorMessage(t, error));
          setPhase('failed');
          return;
        }
        const dataUrl = await QRCode.toDataURL(data.otpauthUrl, { margin: 1, width: 240 });
        setQrDataUrl(dataUrl);
        setSecret(data.secret);
        setPhase('scan');
      } catch {
        setFormError(t('errors.INTERNAL_ERROR'));
        setPhase('failed');
      }
    })();
  }, [t]);

  const confirm = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    let result: { data?: TwoFactorRecoveryCodes; error?: unknown };
    try {
      result = asApiResult<TwoFactorRecoveryCodes>(
        await api.POST('/auth/2fa/verify', { body: { otpCode: code, remember: false } }),
      );
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    const { data, error } = result;
    if (error) {
      const mapped = issuesToFieldErrors(t, error);
      if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
      else setFormError(apiErrorMessage(t, error));
      return;
    }
    if (data && 'recoveryCodes' in data) {
      setRecoveryCodes(data.recoveryCodes);
      setPhase('codes');
    }
  });

  function downloadCodes() {
    const blob = new Blob([recoveryCodes.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      toast({ title: t('auth.setup.copied'), variant: 'success' });
    } catch {
      toast({ title: t('auth.setup.copyFailed'), variant: 'danger' });
    }
  }

  if (phase === 'loading') {
    return <AuthLoading title={t('auth.setup.title')} label={t('common.loading')} />;
  }

  if (phase === 'failed') {
    return (
      <AuthCard title={t('auth.setup.title')}>
        <Alert variant="danger">{formError}</Alert>
      </AuthCard>
    );
  }

  if (phase === 'codes') {
    return (
      <AuthCard title={t('auth.setup.recoveryCodes')} description={t('auth.setup.recoveryHint')}>
        <ol
          dir="ltr"
          className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-border bg-bg-subtle p-4 font-mono text-sm text-fg"
          data-testid="recovery-codes"
        >
          {recoveryCodes.map((c) => (
            <li key={c} className="tabular-nums">
              {c}
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            className="flex-1"
            iconStart={<Copy aria-hidden="true" className="size-4" />}
            onClick={() => void copyCodes()}
          >
            {t('auth.setup.copy')}
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            iconStart={<Download aria-hidden="true" className="size-4" />}
            onClick={downloadCodes}
          >
            {t('auth.setup.download')}
          </Button>
        </div>
        <Checkbox
          label={t('auth.setup.savedAck')}
          checked={savedAck}
          onCheckedChange={(checked) => setSavedAck(checked === true)}
        />
        <Button variant="primary" disabled={!savedAck} onClick={() => router.push('/app')}>
          {t('auth.setup.continue')}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('auth.setup.title')} description={t('auth.setup.scanQr')}>
      {qrDataUrl ? (
        // The QR stays dark-on-white in both themes so every scanner reads it.
        // eslint-disable-next-line @next/next/no-img-element -- a data URL; an <img> is the right tool.
        <img
          src={qrDataUrl}
          alt={t('auth.setup.qrAlt')}
          width={240}
          height={240}
          className="mx-auto rounded-md border border-border bg-white p-2"
        />
      ) : null}
      <p className="text-sm text-fg-muted">
        {t('auth.setup.secret')}:{' '}
        <code dir="ltr" className="font-mono break-all text-fg" data-testid="totp-secret">
          {secret}
        </code>
      </p>
      {formError ? (
        <Alert ref={alertRef} tabIndex={-1} variant="danger">
          {formError}
        </Alert>
      ) : null}
      <form
        method="post"
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          void confirm.submit();
        }}
        className="flex flex-col gap-4"
      >
        <Field htmlFor="otpCode" label={t('auth.setup.code')} error={fieldErrors.otpCode}>
          <Input
            id="otpCode"
            name="otpCode"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
            dir="ltr"
            className="font-mono tracking-[0.3em]"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" loading={confirm.busy} disabled={code.length === 0}>
          {t('auth.setup.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
