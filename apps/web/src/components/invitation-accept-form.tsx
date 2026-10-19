'use client';

import type { AcceptResult, InvitationPreview } from '@nibras/contracts';
import { Alert, Button, useSubmit } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Link, useRouter } from '../i18n/navigation';
import { api, asApiResult } from '../lib/api';
import { endSession } from '../lib/logout';
import {
  acceptDestination,
  FormError,
  LegalCheckbox,
  RegisterFields,
  setLocaleCookie,
  StudentFields,
  useAcceptForm,
} from './accept-fields';
import { AuthCard } from './auth-card';

/**
 * The invitation page's body (PRD §8.1.1 « J'ai une invitation », D-P18; AC-INV-02/03): the
 * preview card, then by `viewer`: signed in as another address → « Cette invitation est destinée
 * à … » with a sign-out-and-continue button (the page re-renders anonymous); signed in as the
 * invited address → a join confirmation; anonymous with an account → a login link back here;
 * anonymous → the register form (the address is the invited one, never typed). Students give
 * their birth date and, when minor, a guardian email. The token stays in this component's props
 * and the API path: never in analytics, logs or an error report.
 */
export function InvitationAcceptForm({
  token,
  preview,
}: {
  token: string;
  preview: InvitationPreview;
}) {
  const t = useTranslations();
  const router = useRouter();
  const student = preview.role === 'STUDENT';
  const form = useAcceptForm({
    askBirthDate: student && preview.requiresBirthDate,
    guardianPrefilled: preview.guardianEmailPrefilled,
  });
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const inviter = `${preview.inviter.firstName} ${preview.inviter.lastName}`;
  const email = preview.emailMasked;
  const register = preview.viewer === 'ANONYMOUS';

  const accept = useSubmit(async () => {
    form.reset();
    if (register && !form.checkRegister()) return;
    let result: { data?: AcceptResult; error?: unknown };
    try {
      result = asApiResult<AcceptResult>(
        await api.POST('/invitations/{token}/accept', {
          params: { path: { token } },
          body: register ? form.registerBody() : { mode: 'JOIN', ...form.studentBody() },
        }),
      );
    } catch {
      form.setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    const { data, error } = result;
    if (error || !data) {
      form.fail(error ?? null);
      return;
    }
    if (register) setLocaleCookie(data.user.locale);
    router.replace(acceptDestination(data));
  });

  const signOut = useSubmit(async () => {
    setSignOutError(null);
    if (!(await endSession())) {
      setSignOutError(t('errors.INTERNAL_ERROR'));
      return;
    }
    // Same URL, now anonymous: the server page re-reads the preview (register or login).
    router.refresh();
  });

  const loginHref = `/login?next=${encodeURIComponent(`/invite/${token}`)}`;

  let body: ReactNode;
  if (preview.viewer === 'MISMATCH') {
    body = (
      <div className="flex flex-col gap-4">
        <Alert variant="warning">
          <p className="font-semibold">{t('invite.mismatch', { email })}</p>
          <p>{t('invite.mismatchHint')}</p>
        </Alert>
        {signOutError ? <Alert variant="danger">{signOutError}</Alert> : null}
        <Button variant="primary" loading={signOut.busy} onClick={() => void signOut.submit()}>
          {t('invite.switchAccount', { email })}
        </Button>
      </div>
    );
  } else if (register && preview.accountExists) {
    body = (
      <div className="flex flex-col gap-4">
        <Alert variant="info">
          <p className="font-semibold">{t('invite.accountExists', { email })}</p>
          <p>{t('invite.accountExistsHint')}</p>
        </Alert>
        <Button variant="primary" asChild>
          <Link href={loginHref}>{t('invite.login')}</Link>
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        <FormError form={form} />
        <form
          method="post"
          ref={form.formRef}
          onSubmit={(e) => {
            e.preventDefault();
            void accept.submit();
          }}
          className="flex flex-col gap-4"
        >
          {register ? (
            <>
              <p className="text-sm text-fg-muted">{t('invite.registerLead', { email })}</p>
              <RegisterFields form={form} />
            </>
          ) : (
            <p className="font-medium">{t('invite.join', { name: inviter })}</p>
          )}
          <StudentFields form={form} />
          {register ? <LegalCheckbox form={form} /> : null}
          <Button
            type="submit"
            variant="primary"
            loading={accept.busy}
            disabled={register && !form.values.acceptTerms}
          >
            {register ? t('invite.registerSubmit') : t('invite.joinSubmit')}
          </Button>
        </form>
      </>
    );
  }

  return (
    <AuthCard
      title={t('invite.title', { inviter, workspace: preview.workspace.name })}
      description={t('invite.role', { role: t(`members.role_${preview.role}`) })}
      footer={
        register && !preview.accountExists ? (
          <p>
            {t('auth.register.haveAccount')}{' '}
            <Link href={loginHref} className="font-semibold text-primary hover:underline">
              {t('auth.register.loginLink')}
            </Link>
          </p>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {preview.message ? (
          <figure className="rounded-md border-s-4 border-border bg-bg-subtle p-3 text-sm">
            <figcaption className="font-semibold">
              {t('invite.messageLabel', { inviter })}
            </figcaption>
            <blockquote className="whitespace-pre-line text-fg-muted">{preview.message}</blockquote>
          </figure>
        ) : null}
        {body}
      </div>
    </AuthCard>
  );
}
