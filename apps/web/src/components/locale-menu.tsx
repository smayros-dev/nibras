'use client';

import { LOCALES } from '@nibras/contracts/web';
import type { Locale } from '@nibras/contracts';
import { Button, DropdownMenu } from '@nibras/ui';
import { Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '../i18n/navigation';

/** Each language is labelled in its own script, whatever the current locale. */
export const NATIVE_NAMES: Record<Locale, string> = {
  fr: 'Français',
  ar: 'العربية',
  en: 'English',
};

/** `tt_locale` cookie: the proxy prefers it over `Accept-Language` on later requests. */
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** Language menu: switches the current page to another locale and remembers the choice. */
export function LocaleMenu() {
  const t = useTranslations('shell');
  const current = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  const onChange = (next: string) => {
    if (!isLocale(next) || next === current) return;
    document.cookie = `tt_locale=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
    // Same page, same query (filters, pagination) and hash in the other locale.
    const { search, hash } = window.location;
    router.replace(`${pathname}${search}${hash}`, { locale: next });
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('language')}>
          <Languages aria-hidden="true" className="size-5" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.RadioGroup value={current} onValueChange={onChange}>
          {LOCALES.map((locale) => (
            <DropdownMenu.RadioItem key={locale} value={locale} lang={locale} dir="auto">
              {NATIVE_NAMES[locale]}
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
