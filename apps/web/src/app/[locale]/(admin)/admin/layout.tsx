import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { routing } from '../../../../i18n/routing';
import { getSession } from '../../../../lib/session';

/**
 * Super-admin console shell (plan Task 22): `platformRole === 'SUPER_ADMIN'` or 404 —
 * anonymous and ordinary teachers see the same not-found page (no existence leak).
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const user = await getSession();
  if (!user || user.platformRole !== 'SUPER_ADMIN') notFound();

  const t = await getTranslations();
  const base = `/${locale}/admin`;
  const links = [
    { href: `${base}/workspaces`, label: t('admin.navWorkspaces') },
    { href: `${base}/abuse-reports`, label: t('admin.navAbuseReports') },
    { href: `${base}/health`, label: t('admin.navHealth') },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">{t('admin.title')}</h1>
      <nav
        aria-label={t('admin.title')}
        className="flex gap-4 border-b border-gray-200 pb-2 text-sm"
      >
        {links.map((link) => (
          <a key={link.href} href={link.href} className="text-brand-700 hover:underline">
            {link.label}
          </a>
        ))}
      </nav>
      {children}
    </div>
  );
}
