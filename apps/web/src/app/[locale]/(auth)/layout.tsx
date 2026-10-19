import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PublicFrame } from '../../../components/public-frame';
import { routing } from '../../../i18n/routing';

/**
 * Auth screens (spec §5) in the public frame (`PublicFrame`). Session logic lives in the pages.
 */
export default async function AuthLayout({
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
