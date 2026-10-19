'use client';

import type { AcceptResult, JoinPreview } from '@nibras/contracts';
import { Button, useSubmit } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link, useRouter } from '../i18n/navigation';
import { api, asApiResult } from '../lib/api';
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
 * The join page's body (PRD §8.3.3, D-P18: a group code is not bound to an address): anonymous →
 * the register form with the email (the account is created unverified and must verify it, D2);
 * signed in → a join confirmation. A code with approval ends on « Demande envoyée — en attente de
 * l'approbation de {teacher} » (plus « Vérifiez votre email » for a new account); otherwise an
 * unverified account goes to `/verify-email`, a waiting minor to the workspace (its waiting
 * panel), anyone else to the dashboard.
 */
export function JoinForm({ code, preview }: { code: string; preview: JoinPreview }) {
  const t = useTranslations();
  const router = useRouter();
  const register = preview.viewer === 'ANONYMOUS';
  const form = useAcceptForm({ askBirthDate: register, withEmail: true });
  const [requested, setRequested] = useState<{ unverified: boolean } | null>(null);
  const teacher = `${preview.teacher.firstName} ${preview.teacher.lastName}`;

  const accept = useSubmit(async () => {
    form.reset();
    if (register && !form.checkRegister()) return;
    let result: { data?: AcceptResult; error?: unknown };
    try {
      result = asApiResult<AcceptResult>(
        await api.POST('/join/{code}/accept', {
          params: { path: { code } },
          body: register
            ? { ...form.registerBody(), email: form.values.email }
            : { mode: 'JOIN', ...form.studentBody() },
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
    const unverified = data.user.emailVerifiedAt === null;
    if (data.membershipStatus === 'PENDING_APPROVAL') {
      setRequested({ unverified });
      return;
    }
    router.replace(unverified ? '/verify-email' : acceptDestination(data));
  });

  if (requested) {
    return (
      <AuthCard title={t('join.requested', { teacher })} description={t('join.requestedHint')}>
        <div className="flex flex-col gap-4">
          {requested.unverified ? <p>{t('join.verifyEmailHint')}</p> : null}
          <Button variant="primary" asChild>
            {requested.unverified ? (
              <Link href="/verify-email">{t('join.verifyEmail')}</Link>
            ) : (
              <Link href="/app">{t('join.dashboard')}</Link>
            )}
          </Button>
        </div>
      </AuthCard>
    );
  }

  const loginHref = `/login?next=${encodeURIComponent(`/join/${code}`)}`;

  return (
    <AuthCard
      title={t('join.title', { workspace: preview.workspace.name })}
      description={t('join.lead', { teacher })}
      footer={
        register ? (
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
        {preview.requiresApproval ? (
          <p className="text-sm text-fg-muted">{t('join.approvalNotice', { teacher })}</p>
        ) : null}
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
            <RegisterFields form={form} withEmail />
          ) : (
            <p className="font-medium">{t('invite.join', { name: teacher })}</p>
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
      </div>
    </AuthCard>
  );
}
