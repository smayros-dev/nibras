'use client';

import { CONSENT_VERSIONS, type TeacherVerification } from '@tt/contracts';
import { Button, Checkbox, Field, TextInput } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../../../lib/api-error';
import { api, asApiResult } from '../../../../../../lib/api';

const STEPS = ['EMAIL', 'PHONE', 'CODE_OF_CONDUCT'] as const;

/**
 * Teacher verification (D-O6): email / phone / code-of-conduct ticks, phone OTP delivery
 * (dev: readable in Mailpit through the `phone.otp_dev` email) and the code-of-conduct grant.
 */
export function VerificationPanel({ initialPhoneE164 }: { initialPhoneE164: string | null }) {
  const t = useTranslations();
  const [verification, setVerification] = useState<TeacherVerification | null>(null);
  const [phoneE164, setPhoneE164] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [cocAccepted, setCocAccepted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = asApiResult<TeacherVerification>(await api.GET('/me/verification'));
    setVerification(data ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendOtp() {
    setFieldErrors({});
    setFormError(null);
    setBusy(true);
    const { error } = await api.POST('/me/phone/request-otp', { body: { phoneE164 } });
    setBusy(false);
    if (error) {
      const mapped = issuesToFieldErrors(error as unknown);
      if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
      else setFormError(apiErrorMessage(t, error as unknown));
      return;
    }
    setOtpSent(true);
  }

  async function verifyOtp() {
    setFieldErrors({});
    setFormError(null);
    setBusy(true);
    const { error } = await api.POST('/me/phone/verify-otp', { body: { otpCode } });
    setBusy(false);
    if (error) {
      const mapped = issuesToFieldErrors(error as unknown);
      if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
      else setFormError(apiErrorMessage(t, error as unknown));
      return;
    }
    setOtpSent(false);
    setOtpCode('');
    await load();
  }

  async function acceptCoc() {
    setFieldErrors({});
    setFormError(null);
    setBusy(true);
    const { error } = await api.POST('/me/consents/{type}', {
      params: { path: { type: 'CODE_OF_CONDUCT' } },
      body: { version: CONSENT_VERSIONS.CODE_OF_CONDUCT },
    });
    setBusy(false);
    if (error) {
      setFormError(apiErrorMessage(t, error as unknown));
      return;
    }
    await load();
  }

  const done = (step: (typeof STEPS)[number]) =>
    verification
      ? step === 'EMAIL'
        ? verification.emailVerified
        : step === 'PHONE'
          ? verification.phoneVerified
          : verification.codeOfConductAccepted
      : false;

  return (
    <div className="flex max-w-xl flex-col gap-6">
      {formError ? (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2 text-sm">
        {STEPS.map((step) => (
          <li key={step} className="flex items-center gap-2">
            <span>{t(`settings.verification.${step === 'CODE_OF_CONDUCT' ? 'coc' : step.toLowerCase()}`)}</span>
            {done(step) ? (
              <span data-testid={`tick-${step}`} className="text-success">
                ✓ {t('settings.verification.done')}
              </span>
            ) : (
              <span className="text-gray-500">{t('settings.verification.todo')}</span>
            )}
          </li>
        ))}
      </ul>

      <section aria-labelledby="phone-title">
        <h2 id="phone-title" className="mb-2 text-lg font-bold">
          {t('settings.verification.phone')}
        </h2>
        {!done('PHONE') ? (
          <div className="flex flex-col gap-3">
            <Field
              htmlFor="phoneE164"
              label={t('settings.verification.phoneNumber')}
              error={fieldErrors.phoneE164}
            >
              <TextInput
                id="phoneE164"
                name="phoneE164"
                type="tel"
                placeholder="+21612345678"
                value={phoneE164}
                onChange={(e) => setPhoneE164(e.target.value)}
                required
              />
            </Field>
            <Button
              variant="secondary"
              onClick={() => void sendOtp()}
              disabled={busy || phoneE164.length === 0}
            >
              {t('settings.verification.sendOtp')}
            </Button>
            {otpSent ? (
              <>
                <p role="status" className="text-sm">
                  {t('settings.verification.otpSent')}
                </p>
                <Field
                  htmlFor="otpCode"
                  label={t('settings.verification.otpCode')}
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
                <Button
                  variant="primary"
                  onClick={() => void verifyOtp()}
                  disabled={busy || otpCode.length === 0}
                >
                  {t('settings.verification.verifyOtp')}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="coc-title">
        <h2 id="coc-title" className="mb-2 text-lg font-bold">
          {t('settings.verification.coc')}
        </h2>
        <p className="mb-3 text-sm">{t('settings.verification.cocBody')}</p>
        {!done('CODE_OF_CONDUCT') ? (
          <div className="flex flex-col gap-3">
            <Checkbox
              label={t('settings.verification.cocAccept')}
              checked={cocAccepted}
              onChange={(e) => setCocAccepted(e.target.checked)}
            />
            <Button
              variant="primary"
              onClick={() => void acceptCoc()}
              disabled={busy || !cocAccepted}
            >
              {t('settings.verification.acceptCoc')}
            </Button>
          </div>
        ) : null}
      </section>

      {initialPhoneE164 && done('PHONE') ? (
        <p className="text-sm">{t('settings.verification.phoneDone', { phone: initialPhoneE164 })}</p>
      ) : null}
    </div>
  );
}
