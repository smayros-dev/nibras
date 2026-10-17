'use client';

import type { TwoFactorRecoveryCodes, TwoFactorSetupResponse } from '@tt/contracts';
import { Button, Checkbox, Field, TextInput } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useRouter } from '../../../../../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../../lib/api-error';
import { api, asApiResult } from '../../../../../lib/api';

type Phase = 'loading' | 'scan' | 'codes' | 'failed';

/**
 * Mandatory 2FA enrolment (AC-AUTH-05): scan the QR, confirm a code, then the single-use
 * recovery codes are shown once — download or copy, acknowledge, continue.
 */
export default function TwoFactorSetupPage() {
  const t = useTranslations();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [savedAck, setSavedAck] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const { data, error } = asApiResult<TwoFactorSetupResponse>(
        await api.POST('/auth/2fa/setup'),
      );
      if (error || !data) {
        setFormError(apiErrorMessage(t, error as unknown));
        setPhase('failed');
        return;
      }
      const dataUrl = await QRCode.toDataURL(data.otpauthUrl, { margin: 1, width: 240 });
      setQrDataUrl(dataUrl);
      setSecret(data.secret);
      setPhase('scan');
    })();
  }, [t]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);
    setBusy(true);
    const { data, error } = asApiResult<TwoFactorRecoveryCodes>(
      await api.POST('/auth/2fa/verify', { body: { otpCode: code, remember: false } }),
    );
    setBusy(false);
    if (error) {
      const body = error as unknown;
      const mapped = issuesToFieldErrors(t, body);
      if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
      else setFormError(apiErrorMessage(t, body));
      return;
    }
    if (data && 'recoveryCodes' in data) {
      setRecoveryCodes(data.recoveryCodes);
      setPhase('codes');
    }
  }

  function downloadCodes() {
    const blob = new Blob([recoveryCodes.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (phase === 'loading') {
    return <p className="text-lg">{t('common.loading')}</p>;
  }

  if (phase === 'failed') {
    return (
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
        <p role="alert" className="text-danger">
          {formError}
        </p>
      </div>
    );
  }

  if (phase === 'codes') {
    return (
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
        <h1 className="mb-2 text-2xl font-bold">{t('auth.setup.recoveryCodes')}</h1>
        <p className="mb-4 text-sm">{t('auth.setup.recoveryHint')}</p>
        <ul
          className="mb-4 rounded-md bg-gray-50 p-3 font-mono text-sm"
          data-testid="recovery-codes"
        >
          {recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="mb-4 flex flex-col gap-3">
          <Button variant="secondary" onClick={downloadCodes}>
            {t('auth.setup.download')}
          </Button>
          <Checkbox
            label={t('auth.setup.savedAck')}
            checked={savedAck}
            onChange={(e) => setSavedAck(e.target.checked)}
          />
          <Button variant="primary" disabled={!savedAck} onClick={() => router.push('/app')}>
            {t('auth.setup.continue')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
      <h1 className="mb-4 text-2xl font-bold">{t('auth.setup.title')}</h1>
      <p className="mb-4 text-sm">{t('auth.setup.scanQr')}</p>
      {qrDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL; an <img> is the right tool.
        <img src={qrDataUrl} alt={t('auth.setup.title')} className="mx-auto mb-4" />
      ) : null}
      <p className="mb-4 break-all font-mono text-xs" data-testid="totp-secret">
        {t('auth.setup.secret')}: {secret}
      </p>
      {formError ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {formError}
        </p>
      ) : null}
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Field htmlFor="otpCode" label={t('auth.setup.code')} error={fieldErrors.otpCode}>
          <TextInput
            id="otpCode"
            name="otpCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" disabled={busy || code.length === 0}>
          {t('auth.setup.submit')}
        </Button>
      </form>
    </div>
  );
}
