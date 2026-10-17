'use client';

import { CONSENT_VERSIONS, type TeacherVerification } from '@tt/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Skeleton,
  useSubmit,
  useToast,
} from '@tt/ui';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage, issuesToFieldErrors } from '../../../../../../lib/api-error';
import { api, asApiResult } from '../../../../../../lib/api';

const STEPS = ['EMAIL', 'PHONE', 'CODE_OF_CONDUCT'] as const;
type Step = (typeof STEPS)[number];

const STEP_KEY: Record<Step, string> = {
  EMAIL: 'settings.verification.email',
  PHONE: 'settings.verification.phone',
  CODE_OF_CONDUCT: 'settings.verification.coc',
};

/**
 * Teacher verification (D-O6): email / phone / code-of-conduct steps with done badges, phone OTP
 * delivery (dev: readable in Mailpit through the `phone.otp_dev` email) and the code-of-conduct
 * grant.
 */
export function VerificationPanel({ initialPhoneE164 }: { initialPhoneE164: string | null }) {
  const t = useTranslations();
  const { toast } = useToast();
  const [verification, setVerification] = useState<TeacherVerification | null>(null);
  const [phoneE164, setPhoneE164] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [cocAccepted, setCocAccepted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, error } = asApiResult<TeacherVerification>(await api.GET('/me/verification'));
      if (error) setFormError(apiErrorMessage(t, error));
      else setVerification(data ?? null);
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one call; `true` on success, errors mapped to fields or the form alert. */
  const call = useCallback(
    async (request: () => Promise<{ error?: unknown }>): Promise<boolean> => {
      setFieldErrors({});
      setFormError(null);
      try {
        const { error } = await request();
        if (!error) return true;
        const mapped = issuesToFieldErrors(t, error);
        if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
        else setFormError(apiErrorMessage(t, error));
      } catch {
        setFormError(t('errors.INTERNAL_ERROR'));
      }
      return false;
    },
    [t],
  );

  const sendOtp = useSubmit(async () => {
    const ok = await call(async () =>
      asApiResult<unknown>(await api.POST('/me/phone/request-otp', { body: { phoneE164 } })),
    );
    if (!ok) return;
    setOtpSent(true);
    toast({ title: t('settings.verification.otpSent'), variant: 'info' });
  });

  const verifyOtp = useSubmit(async () => {
    const ok = await call(async () =>
      asApiResult<unknown>(await api.POST('/me/phone/verify-otp', { body: { otpCode } })),
    );
    if (!ok) return;
    setOtpSent(false);
    setOtpCode('');
    toast({ title: t('settings.verification.phoneVerified'), variant: 'success' });
    await load();
  });

  const acceptCoc = useSubmit(async () => {
    const ok = await call(async () =>
      asApiResult<unknown>(
        await api.POST('/me/consents/{type}', {
          params: { path: { type: 'CODE_OF_CONDUCT' } },
          body: { version: CONSENT_VERSIONS.CODE_OF_CONDUCT },
        }),
      ),
    );
    if (!ok) return;
    toast({ title: t('settings.verification.cocAccepted'), variant: 'success' });
    await load();
  });

  const busy = sendOtp.busy || verifyOtp.busy || acceptCoc.busy;

  const done = (step: Step) =>
    verification
      ? step === 'EMAIL'
        ? verification.emailVerified
        : step === 'PHONE'
          ? verification.phoneVerified
          : verification.codeOfConductAccepted
      : false;

  return (
    <div className="flex max-w-xl flex-col gap-6">
      {formError ? <Alert variant="danger">{formError}</Alert> : null}

      <Card>
        <Card.Header>
          <Card.Title>{t('settings.verification.steps')}</Card.Title>
        </Card.Header>
        <ol className="flex flex-col divide-y divide-border">
          {STEPS.map((step, index) => (
            <li key={step} className="flex min-h-11 items-center justify-between gap-3 py-2">
              <span className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex size-6 items-center justify-center rounded-full bg-bg-subtle text-xs font-semibold text-fg-muted"
                >
                  {index + 1}
                </span>
                {t(STEP_KEY[step])}
              </span>
              {verification === null ? (
                <Skeleton className="h-5 w-16" />
              ) : done(step) ? (
                <Badge variant="success" data-testid={`tick-${step}`}>
                  <Check aria-hidden="true" className="size-3" />
                  {t('settings.verification.done')}
                </Badge>
              ) : (
                <Badge variant="neutral">{t('settings.verification.todo')}</Badge>
              )}
            </li>
          ))}
        </ol>
      </Card>

      {verification && !done('PHONE') ? (
        <Card>
          <Card.Header>
            <Card.Title>{t('settings.verification.phone')}</Card.Title>
          </Card.Header>
          <Field
            htmlFor="phoneE164"
            label={t('settings.verification.phoneNumber')}
            error={fieldErrors.phoneE164}
          >
            <Input
              id="phoneE164"
              name="phoneE164"
              type="tel"
              dir="ltr"
              autoComplete="tel"
              placeholder="+21612345678"
              value={phoneE164}
              onChange={(e) => setPhoneE164(e.target.value)}
              required
            />
          </Field>
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => void sendOtp.submit()}
            loading={sendOtp.busy}
            disabled={busy || phoneE164.length === 0}
          >
            {t('settings.verification.sendOtp')}
          </Button>
          {otpSent ? (
            <>
              <Field
                htmlFor="otpCode"
                label={t('settings.verification.otpCode')}
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
              <Button
                variant="primary"
                className="self-start"
                onClick={() => void verifyOtp.submit()}
                loading={verifyOtp.busy}
                disabled={busy || otpCode.length === 0}
              >
                {t('settings.verification.verifyOtp')}
              </Button>
            </>
          ) : null}
        </Card>
      ) : null}

      {initialPhoneE164 && done('PHONE') ? (
        <p className="text-sm text-fg-muted">
          {t('settings.verification.phoneDone', { phone: initialPhoneE164 })}
        </p>
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title>{t('settings.verification.coc')}</Card.Title>
          <Card.Description>{t('settings.verification.cocBody')}</Card.Description>
        </Card.Header>
        {verification && !done('CODE_OF_CONDUCT') ? (
          <>
            <Checkbox
              label={t('settings.verification.cocAccept')}
              checked={cocAccepted}
              onCheckedChange={(checked) => setCocAccepted(checked === true)}
            />
            <Button
              variant="primary"
              className="self-start"
              onClick={() => void acceptCoc.submit()}
              loading={acceptCoc.busy}
              disabled={busy || !cocAccepted}
            >
              {t('settings.verification.acceptCoc')}
            </Button>
          </>
        ) : null}
      </Card>
    </div>
  );
}
