import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PublicFrame } from '../../../components/public-frame';
import { routing } from '../../../i18n/routing';

/**
 * Public token pages (invitation, group code; SP2 design §8): the auth-card frame, reachable
 * anonymous or signed in — the API's preview says who the viewer is and the page adapts, so there
 * is no session redirect here.
 */
export default async function PublicLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <PublicFrame>{children}</PublicFrame>;
}
