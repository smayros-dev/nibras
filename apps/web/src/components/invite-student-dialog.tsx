'use client';

import type {
  CreateInvitationInput,
  InvitationSummary,
  MemberSummary,
  MembersPage,
  TeacherVerificationStep,
  WorkspaceDetail,
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
import { useAbortableQuery } from '../lib/paged-fetch';
import { useErrorFocus } from '../lib/use-error-focus';

const FIELDS = ['email', 'firstName', 'lastName', 'guardianEmail', 'birthDate', 'message'];

/**
 * « + Inviter » on the students page (AC-INV-01, PRD §8.3.2): email, optional names, guardian
 * email (« si l'élève est mineur »), birth date and message; in an organisation, an OWNER/ADMIN
 * may assign the student to a teaching member (`teacherUserId`; a TEACHER invites for himself).
 * `POST /invitations`: `409 ALREADY_MEMBER` / `INVITATION_PENDING` are errors on the email field,
 * `403 TEACHER_NOT_VERIFIED` an alert naming the missing steps with the verification link
 * (D-O6). Controlled: the opener restores focus through `onCloseAutoFocus`; the form remounts
 * blank on every open.
 */
export function InviteStudentDialog({
  wid,
  detail,
  open,
  onOpenChange,
  onInvited,
  onCloseAutoFocus,
}: {
  wid: string;
  detail: WorkspaceDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: (invitation: InvitationSummary) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        title={t('invitations.inviteTitle')}
        closeLabel={t('common.close')}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <InviteStudentForm
          wid={wid}
          detail={detail}
          onDone={(invitation) => {
            onInvited(invitation);
            onOpenChange(false);
          }}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function InviteStudentForm({
  wid,
  detail,
  onDone,
}: {
  wid: string;
  detail: WorkspaceDetail;
  onDone: (invitation: InvitationSummary) => void;
}) {
  const t = useTranslations();
  const { toast } = useToast();
  const [values, setValues] = useState({
    email: '',
    firstName: '',
    lastName: '',
    guardianEmail: '',
    birthDate: '',
    message: '',
    teacherUserId: '',
  });
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [missing, setMissing] = useState<TeacherVerificationStep[] | null>(null);
  // The verification alert takes the focus like a form error (its message is built below).
  const { formRef, alertRef } = useErrorFocus(
    fieldErrors,
    missing ? `missing:${missing.join(',')}` : formError,
  );
  const today = new Date().toISOString().slice(0, 10);

  // Organisation OWNER/ADMIN: the teaching members a student may be assigned to.
  const assignable = detail.type === 'ORGANIZATION' && detail.myRole !== 'TEACHER';
  const teachers = useAbortableQuery([wid, assignable], async (signal) => {
    if (!assignable) return [];
    const load = async (role: 'TEACHER' | 'ADMIN'): Promise<MemberSummary[]> => {
      const { data } = asApiResult<MembersPage>(
        await api.GET('/workspaces/{wid}/members', {
          params: { path: { wid }, query: { role, status: 'ACTIVE', limit: 100 } },
          signal,
        }),
      );
      return data?.items ?? [];
    };
    const [teaching, admins] = await Promise.all([load('TEACHER'), load('ADMIN')]);
    return [...teaching, ...admins.filter((m) => m.canTeach)];
  });

  const submit = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    setMissing(null);
    // Empty optional fields are left out; no course to pick before SP3.
    const optional = {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      guardianEmail: values.guardianEmail.trim().toLowerCase(),
      birthDate: values.birthDate,
      message: values.message.trim(),
      teacherUserId: assignable ? values.teacherUserId : '',
    };
    const payload: CreateInvitationInput = {
      email: values.email.trim().toLowerCase(),
      role: 'STUDENT',
      courseIds: [],
      ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== '')),
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
      const body = error as { code?: string } | undefined;
      if (body?.code && EMAIL_CONFLICTS.includes(body.code)) {
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
            {t('invitations.notVerified', {
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
        htmlFor="invite-email"
        label={t('invitations.email')}
        error={fieldErrors.email}
        required
      >
        <Input
          id="invite-email"
          name="email"
          type="email"
          autoComplete="off"
          maxLength={254}
          value={values.email}
          onChange={(e) => set('email')(e.target.value)}
          required
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          htmlFor="invite-first-name"
          label={t('invitations.firstName')}
          error={fieldErrors.firstName}
        >
          <Input
            id="invite-first-name"
            name="firstName"
            autoComplete="off"
            maxLength={80}
            value={values.firstName}
            onChange={(e) => set('firstName')(e.target.value)}
          />
        </Field>
        <Field
          htmlFor="invite-last-name"
          label={t('invitations.lastName')}
          error={fieldErrors.lastName}
        >
          <Input
            id="invite-last-name"
            name="lastName"
            autoComplete="off"
            maxLength={80}
            value={values.lastName}
            onChange={(e) => set('lastName')(e.target.value)}
          />
        </Field>
      </div>
      <Field
        htmlFor="invite-guardian-email"
        label={t('invitations.guardianEmail')}
        description={t('invitations.guardianHint')}
        error={fieldErrors.guardianEmail}
      >
        <Input
          id="invite-guardian-email"
          name="guardianEmail"
          type="email"
          autoComplete="off"
          maxLength={254}
          value={values.guardianEmail}
          onChange={(e) => set('guardianEmail')(e.target.value)}
        />
      </Field>
      <Field
        htmlFor="invite-birth-date"
        label={t('invitations.birthDate')}
        error={fieldErrors.birthDate}
      >
        <Input
          id="invite-birth-date"
          name="birthDate"
          type="date"
          autoComplete="off"
          min="1900-01-01"
          max={today}
          value={values.birthDate}
          onChange={(e) => set('birthDate')(e.target.value)}
        />
      </Field>
      {assignable ? (
        <Field htmlFor="invite-teacher" label={t('invitations.teacher')}>
          <Select
            id="invite-teacher"
            name="teacherUserId"
            value={values.teacherUserId}
            onChange={(e) => set('teacherUserId')(e.target.value)}
          >
            <option value="">{t('invitations.teacherNone')}</option>
            {(teachers.data ?? []).map((m) => (
              <option key={m.userId} value={m.userId}>
                {`${m.firstName} ${m.lastName}`}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field htmlFor="invite-message" label={t('invitations.message')} error={fieldErrors.message}>
        <Textarea
          id="invite-message"
          name="message"
          rows={3}
          autoResize
          maxLength={500}
          value={values.message}
          onChange={(e) => set('message')(e.target.value)}
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
          disabled={values.email.trim() === ''}
        >
          {t('invitations.submit')}
        </Button>
      </Dialog.Footer>
    </form>
  );
}
