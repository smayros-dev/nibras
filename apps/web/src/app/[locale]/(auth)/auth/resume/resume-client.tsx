'use client';

import { Spinner } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { useRouter } from '../../../../../i18n/navigation';
import { refreshSession, RESUME_COOKIE } from '../../../../../lib/auth-refresh';

/**
 * Refreshes once, then returns to `next` (sanitized, locale-less) or goes to login. The short-lived
 * `tt_resume` cookie is the loop guard: if the `(app)` layout still sees no session while it is
 * set, it sends the user to login instead of back here.
 */
export function ResumeClient({ next }: { next: string }) {
  const t = useTranslations();
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    document.cookie = `${RESUME_COOKIE}=1; Max-Age=20; Path=/; SameSite=Lax`;
    void refreshSession().then((ok) => {
      router.replace(ok ? next : `/login?next=${encodeURIComponent(next)}`);
    });
  }, [next, router]);

  return <Spinner size="lg" label={t('auth.resume.loading')} />;
}
