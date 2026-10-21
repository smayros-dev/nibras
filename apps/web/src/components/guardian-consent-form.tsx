'use client';

import {
  GUARDIAN_RELATIONSHIPS,
  type GuardianRelationship,
  type Locale,
} from '@nibras/contracts/web';
import type { GuardianConsentPreview, GuardianDecisionResult } from '@nibras/contracts';
import { formatDate } from '@nibras/i18n';
import {
  Alert,
  AlertDialog,
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  useSubmit,
  VisuallyHidden,
} from '@nibras/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '../i18n/navigation';
import { api, asApiResult } from '../lib/api';
import { apiErrorMessage, issuesToFieldErrors } from '../lib/api-error';
import { useErrorFocus } from '../lib/use-error-focus';
import { AuthCard } from './auth-card';

/**
 * Shared identity part of the guardian's consent (PRD §8.3.5, D-O5): the guardian's first and
 * last name, the relationship, the minors notice and « J'autorise {student} à utiliser l'espace de
 * {teacher} ». Used by the consent page (grant / refuse) and the guardian page (re-grant).
 */

/** `410` answers of the consent routes: the request can no longer be answered from this link. */
const GONE_CODES = ['TOKEN_INVALID', 'CONSENT_LINK_EXPIRED', 'CONSENT_ALREADY_DECIDED'];

export function isGoneCode(code: unknown): code is string {
  return typeof code === 'string' && GONE_CODES.includes(code);
}

/** The guardian-page token of an API `guardianPageUrl` (`…/{locale}/guardian/{token}`). */
export function pageTokenOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, 'http://localhost').pathname.split('/').filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}

/** The viewer's time zone, resolved after mount (the server has none: no hydration mismatch). */
export function useViewerTimezone(): string {
  const [zone, setZone] = useState('UTC');
  useEffect(() => {
    try {
      setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    } catch {
      // keep UTC
    }
  }, []);
  return zone;
}

export function useGuardianIdentity() {
  const t = useTranslations();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [relationship, setRelationship] = useState<GuardianRelationship | ''>('');
  const [acceptNotice, setAcceptNotice] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);

  function reset() {
    setFieldErrors({});
    setFormError(null);
  }

  /** Required fields (names, relationship); `false` with field errors set when one is missing. */
  function check(): boolean {
    const missing: Record<string, string> = {};
    const required = t('validation.required');
    if (!firstName.trim()) missing.guardianFirstName = required;
    if (!lastName.trim()) missing.guardianLastName = required;
    if (!relationship) missing.relationship = required;
    setFieldErrors(missing);
    setFormError(null);
    return Object.keys(missing).length === 0;
  }

  function identity() {
    return {
      guardianFirstName: firstName.trim(),
      guardianLastName: lastName.trim(),
      relationship: relationship as GuardianRelationship,
    };
  }

  /** Maps a failed request onto the fields (`422`) or the form (anything else, translated). */
  function fail(error: unknown) {
    const mapped = issuesToFieldErrors(t, error);
    if (Object.keys(mapped).length > 0) {
      setFieldErrors(mapped);
      return;
    }
    setFormError(apiErrorMessage(t, error));
  }

  return {
    values: { firstName, lastName, relationship, acceptNotice },
    set: {
      firstName: setFirstName,
      lastName: setLastName,
      relationship: setRelationship,
      acceptNotice: setAcceptNotice,
    },
    fieldErrors,
    formError,
    setFormError,
    formRef,
    alertRef,
    reset,
    check,
    identity,
    fail,
  };
}

export type GuardianIdentity = ReturnType<typeof useGuardianIdentity>;

/** The form-level error, focused after a failed submit. */
export function GuardianFormError({ identity }: { identity: GuardianIdentity }) {
  return identity.formError ? (
    <Alert ref={identity.alertRef} tabIndex={-1} variant="danger">
      {identity.formError}
    </Alert>
  ) : null;
}

/**
 * Prénom, nom, lien de parenté, the minors notice (`noticeUrl` from the API, else this locale's
 * `/legal/minors`; a new tab keeps the half-filled form) and the authorisation checkbox.
 */
export function GuardianIdentityFields({
  identity,
  student,
  teacher,
  noticeUrl,
}: {
  identity: GuardianIdentity;
  student: string;
  teacher: string;
  noticeUrl?: string;
}) {
  const t = useTranslations();
  const { values, set, fieldErrors } = identity;
  const noticeLabel = (
    <>
      {t('guardian.notice')} <VisuallyHidden>{t('common.newTab')}</VisuallyHidden>
    </>
  );
  const noticeClass = 'font-semibold text-primary underline-offset-4 hover:underline';
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          htmlFor="guardianFirstName"
          label={t('guardian.firstName')}
          error={fieldErrors.guardianFirstName}
        >
          <Input
            id="guardianFirstName"
            name="guardianFirstName"
            autoComplete="given-name"
            maxLength={80}
            value={values.firstName}
            onChange={(e) => set.firstName(e.target.value)}
            required
          />
        </Field>
        <Field
          htmlFor="guardianLastName"
          label={t('guardian.lastName')}
          error={fieldErrors.guardianLastName}
        >
          <Input
            id="guardianLastName"
            name="guardianLastName"
            autoComplete="family-name"
            maxLength={80}
            value={values.lastName}
            onChange={(e) => set.lastName(e.target.value)}
            required
          />
        </Field>
      </div>
      <Field
        htmlFor="relationship"
        label={t('guardian.relationship')}
        error={fieldErrors.relationship}
      >
        <Select
          id="relationship"
          name="relationship"
          value={values.relationship}
          onChange={(e) => set.relationship(e.target.value as GuardianRelationship | '')}
          required
        >
          <option value="" disabled>
            {t('guardian.relationshipPlaceholder')}
          </option>
          {GUARDIAN_RELATIONSHIPS.map((r) => (
            <option key={r} value={r}>
              {t(`guardian.relationship_${r}`)}
            </option>
          ))}
        </Select>
      </Field>
      <p className="text-sm">
        {noticeUrl ? (
          <a href={noticeUrl} target="_blank" rel="noopener noreferrer" className={noticeClass}>
            {noticeLabel}
          </a>
        ) : (
          <Link
            href="/legal/minors"
            target="_blank"
            rel="noopener noreferrer"
            className={noticeClass}
          >
            {noticeLabel}
          </Link>
        )}
      </p>
      <Checkbox
        label={t('guardian.authorize', { student, teacher })}
        checked={values.acceptNotice}
        onCheckedChange={(checked) => set.acceptNotice(checked === true)}
      />
    </>
  );
}

type Outcome =
  | { kind: 'granted'; pageToken: string | null }
  | { kind: 'refused' }
  | { kind: 'gone'; code: string };

/**
 * The consent page's body (PRD §8.3.5, D-O5; AC-INV-10): who asks for what, the guardian's
 * identity, **Autoriser** (once the authorisation box is checked) or **Refuser** (confirmed in a
 * dialog). The outcome replaces the form: thanks + the guardian page link, the refusal, or — on a
 * `410` (link used, replaced or expired meanwhile) — the decided / expired message. The token
 * stays in the props and the API path: never logged, never sent to an error reporter.
 */
export function GuardianConsentForm({
  token,
  preview,
}: {
  token: string;
  preview: GuardianConsentPreview;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const zone = useViewerTimezone();
  const identity = useGuardianIdentity();
  const [confirmRefuse, setConfirmRefuse] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const student = `${preview.student.firstName} ${preview.student.lastName}`;
  const teacher = `${preview.teacher.firstName} ${preview.teacher.lastName}`;

  const decide = useSubmit(async (decision: 'GRANT' | 'REFUSE') => {
    identity.reset();
    let result: { data?: GuardianDecisionResult; error?: unknown };
    try {
      result = asApiResult<GuardianDecisionResult>(
        await api.POST('/guardian-consent/{token}', {
          params: { path: { token } },
          body:
            decision === 'GRANT'
              ? { decision, ...identity.identity(), acceptNotice: true }
              : { decision, ...identity.identity() },
        }),
      );
    } catch {
      setConfirmRefuse(false);
      identity.setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    setConfirmRefuse(false);
    const { data, error } = result;
    if (error || !data) {
      const code = (error as { code?: unknown } | undefined)?.code;
      if (isGoneCode(code)) setOutcome({ kind: 'gone', code });
      else identity.fail(error ?? null);
      return;
    }
    setOutcome(
      data.decision === 'GRANT'
        ? { kind: 'granted', pageToken: pageTokenOf(data.guardianPageUrl) }
        : { kind: 'refused' },
    );
  });

  if (outcome?.kind === 'granted') {
    return (
      <AuthCard
        title={t('guardian.granted', { student, teacher })}
        description={t('guardian.grantedHint')}
      >
        {outcome.pageToken ? (
          <Button variant="primary" asChild>
            <Link href={`/guardian/${outcome.pageToken}`}>
              {t('guardian.viewSessions', { student })}
            </Link>
          </Button>
        ) : null}
      </AuthCard>
    );
  }
  if (outcome?.kind === 'refused') {
    return (
      <AuthCard
        title={t('guardian.refused', { student, teacher })}
        description={t('guardian.refusedHint', { student })}
      />
    );
  }
  if (outcome?.kind === 'gone') {
    const expired = outcome.code === 'CONSENT_LINK_EXPIRED';
    return (
      <AuthCard
        title={expired ? t('guardian.expired') : t('guardian.decided')}
        description={expired ? t('guardian.expiredHint') : t('guardian.decidedHint')}
      />
    );
  }

  return (
    <AuthCard
      className="max-w-[520px]"
      title={t('guardian.consentTitle', { student, teacher, workspace: preview.workspace.name })}
      description={t('guardian.consentLead', { student })}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">
          {t('guardian.validUntil', {
            date: formatDate(new Date(preview.expiresAt), locale, zone, { dateStyle: 'long' }),
          })}
        </p>
        <GuardianFormError identity={identity} />
        <form
          method="post"
          noValidate
          ref={identity.formRef}
          onSubmit={(e) => {
            e.preventDefault();
            if (!identity.check()) return;
            void decide.submit('GRANT');
          }}
          className="flex flex-col gap-4"
        >
          <GuardianIdentityFields
            identity={identity}
            student={student}
            teacher={teacher}
            noticeUrl={preview.noticeUrl}
          />
          <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
            <Button
              type="submit"
              variant="primary"
              loading={decide.busy && !confirmRefuse}
              disabled={!identity.values.acceptNotice}
            >
              {t('guardian.grant')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (identity.check()) setConfirmRefuse(true);
              }}
            >
              {t('guardian.refuse')}
            </Button>
          </div>
        </form>
      </div>
      <AlertDialog.Root open={confirmRefuse} onOpenChange={setConfirmRefuse}>
        {confirmRefuse ? (
          <AlertDialog.Content
            title={t('guardian.refuseTitle', { student })}
            description={t('guardian.refuseDescription', { student, teacher })}
          >
            <AlertDialog.Footer>
              <AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
              <AlertDialog.Action
                destructive
                loading={decide.busy}
                onClick={(event) => {
                  // Stay open while the request runs; the outcome replaces the page.
                  event.preventDefault();
                  void decide.submit('REFUSE');
                }}
              >
                {t('guardian.refuseConfirm')}
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        ) : null}
      </AlertDialog.Root>
    </AuthCard>
  );
}
