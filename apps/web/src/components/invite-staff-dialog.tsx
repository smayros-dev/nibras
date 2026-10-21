'use client';

import type {
  CreateInvitationInput,
  InvitationSummary,
  TeacherVerificationStep,
} from '@nibras/contracts';
import {
  Alert,
  Button,
  Dialog,
  Field,
  Input,
  Select,
  Textarea,
  useSubmit,
  useToast,
} from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '../i18n/navigation';
import { api, asApiResult } from '../lib/api';
import { apiErrorMessage, issuesToFieldErrors } from '../lib/api-error';
import {
  EMAIL_CONFLICTS,
  missingVerificationSteps,
  VERIFICATION_STEP_LABELS,
} from '../lib/invite-errors';
import { useErrorFocus } from '../lib/use-error-focus';

/** The staff roles an organisation invites by email (`INVITABLE_ROLES` minus `STUDENT`). */
const STAFF_INVITE_ROLES = ['TEACHER', 'ADMIN'] as const;
type StaffInviteRole = (typeof STAFF_INVITE_ROLES)[number];

const FIELDS = ['email', 'role', 'message'];

/**
 * « + Inviter un professeur / un admin » on an organisation's members page (PRD §8.2.2, « même
 * mécanique que les étudiants »; D-O7: the accepted teacher gets no personal workspace): email,
 * role (TEACHER / ADMIN) and message. `POST /invitations` with the role, the same error mapping as
 * the student dialog: `409 ALREADY_MEMBER` / `INVITATION_PENDING` on the email field, `403
 * TEACHER_NOT_VERIFIED` an alert naming the missing steps with the verification link (D-O6), any
 * other error a form alert. Controlled; the form remounts blank on every open.
 */
export function InviteStaffDialog({
  wid,
  open,
  onOpenChange,
  onInvited,
  onCloseAutoFocus,
}: {
  wid: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: (invitation: InvitationSummary) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        title={t('members.inviteStaffTitle')}
        closeLabel={t('common.close')}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <InviteStaffForm
          wid={wid}
          onDone={(invitation) => {
            onInvited(invitation);
            onOpenChange(false);
          }}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function InviteStaffForm({
  wid,
  onDone,
}: {
  wid: string;
  onDone: (invitation: InvitationSummary) => void;
}) {
  const t = useTranslations();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffInviteRole>('TEACHER');
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [missing, setMissing] = useState<TeacherVerificationStep[] | null>(null);
  const { formRef, alertRef } = useErrorFocus(
    fieldErrors,
    missing ? `missing:${missing.join(',')}` : formError,
  );

  const submit = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    setMissing(null);
    const payload: CreateInvitationInput = {
      email: email.trim().toLowerCase(),
      role,
      courseIds: [],
      ...(message.trim() ? { message: message.trim() } : {}),
    };

    let result: { data?: InvitationSummary; error?: unknown };
    try {
      result = asApiResult<InvitationSummary>(
        await api.POST('/workspaces/{wid}/invitations', {
          params: { path: { wid } },
          body: payload,
        }),
      );
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    const { data, error } = result;
    if (error || !data) {
      const steps = missingVerificationSteps(error);
      if (steps) {
        setMissing(steps);
        return;
      }
      const code = (error as { code?: string } | undefined)?.code;
      if (code && EMAIL_CONFLICTS.includes(code)) {
        setFieldErrors({ email: apiErrorMessage(t, error) });
        return;
      }
      const mapped = issuesToFieldErrors(t, error);
      const onFields = Object.fromEntries(
        Object.entries(mapped).filter(([field]) => FIELDS.includes(field)),
      );
      if (Object.keys(onFields).length > 0) setFieldErrors(onFields);
      else setFormError(apiErrorMessage(t, error ?? null));
      return;
    }
    toast({ title: t('invitations.sent', { email: data.email }), variant: 'success' });
    onDone(data);
  });

  return (
    <form
      method="post"
      ref={formRef}
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit.submit();
      }}
    >
      {missing ? (
        <Alert ref={alertRef} tabIndex={-1} variant="danger">
          <p>
            {t('members.inviteStaffNotVerified', {
              steps: missing.map((step) => t(VERIFICATION_STEP_LABELS[step])).join(', '),
            })}
          </p>
          <Link href="/app/settings/verification" className="font-medium text-primary underline">
            {t('invitations.verifyLink')}
          </Link>
        </Alert>
      ) : formError ? (
        <Alert ref={alertRef} tabIndex={-1} variant="danger">
          {formError}
        </Alert>
      ) : null}
      <Field
        htmlFor="invite-staff-email"
        label={t('members.inviteStaffEmail')}
        error={fieldErrors.email}
        required
      >
        <Input
          id="invite-staff-email"
          name="email"
          type="email"
          autoComplete="off"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>
      <Field htmlFor="invite-staff-role" label={t('members.role')} error={fieldErrors.role}>
        <Select
          id="invite-staff-role"
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value as StaffInviteRole)}
        >
          {STAFF_INVITE_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`members.role_${r}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        htmlFor="invite-staff-message"
        label={t('invitations.message')}
        error={fieldErrors.message}
      >
        <Textarea
          id="invite-staff-message"
          name="message"
          rows={3}
          autoResize
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </Field>
      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="secondary">{t('common.cancel')}</Button>
        </Dialog.Close>
        <Button
          type="submit"
          variant="primary"
          loading={submit.busy}
          disabled={email.trim() === ''}
        >
          {t('invitations.submit')}
        </Button>
      </Dialog.Footer>
    </form>
  );
}
