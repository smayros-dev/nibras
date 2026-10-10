'use client';

import type { Locale } from '@tt/contracts';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '../i18n/navigation';
import { routing } from '../i18n/routing';

/** Each language is labelled in its own script, whatever the current locale. */
const NATIVE_NAMES: Record<Locale, string> = {
  fr: 'Français',
  ar: 'العربية',
  en: 'English',
};

/** Links to the current page in every locale. */
export function LocaleSwitcher() {
  const t = useTranslations('hello');
  const pathname = usePathname();
  const current = useLocale();
  return (
    <nav aria-label={t('switchLocale')}>
      <ul className="flex flex-wrap gap-3">
        {routing.locales.map((locale) => (
          <li key={locale}>
            <Link
              href={pathname}
              locale={locale}
              hrefLang={locale}
              lang={locale}
              aria-current={locale === current ? 'true' : undefined}
              className="rounded-md px-3 py-1.5 text-brand-700 hover:bg-brand-50 aria-[current=true]:font-semibold"
            >
              {NATIVE_NAMES[locale]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
