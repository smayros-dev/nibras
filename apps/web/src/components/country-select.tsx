'use client';

import { Select, TextInput } from '@tt/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

/** The market countries (PRD D-O3): Maghreb + France, offered as quick options. */
const REGION_CODES = ['TN', 'DZ', 'MA', 'FR'] as const;
const OTHER = 'OTHER';

function isKnownCode(value: string): boolean {
  return (REGION_CODES as readonly string[]).includes(value.toUpperCase());
}

/**
 * Plan Task 21: organisation country is a *TN/DZ/MA/FR/other* select — option labels come from
 * `Intl.DisplayNames` (localised country names, no message keys), *Autre* switches to a two-letter
 * free-text input, and an unknown stored value (e.g. edited before this select existed) opens on
 * *Autre* with the value preserved. Emits an uppercased ISO code or `''`.
 */
export function CountrySelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [other, setOther] = useState(() => value !== '' && !isKnownCode(value));
  const names = new Intl.DisplayNames([locale], { type: 'region' });

  return (
    <>
      <Select
        id={id}
        value={other ? OTHER : value.toUpperCase()}
        onChange={(event) => {
          if (event.target.value === OTHER) {
            setOther(true);
            onChange('');
          } else {
            setOther(false);
            onChange(event.target.value);
          }
        }}
      >
        <option value="">—</option>
        {REGION_CODES.map((code) => (
          <option key={code} value={code}>
            {names.of(code) ?? code}
          </option>
        ))}
        <option value={OTHER}>{t('workspace.countryOther')}</option>
      </Select>
      {other ? (
        <TextInput
          id={`${id}-other`}
          aria-label={t('workspace.country')}
          value={value}
          maxLength={2}
          placeholder="XX"
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
      ) : null}
    </>
  );
}
