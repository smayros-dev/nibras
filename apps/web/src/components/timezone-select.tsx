'use client';

import { Select } from '@tt/ui';
import type { SelectHTMLAttributes } from 'react';

const FALLBACK_TIMEZONES = [
  'Africa/Tunis',
  'Africa/Cairo',
  'Africa/Algiers',
  'Africa/Casablanca',
  'Europe/Paris',
  'Europe/London',
  'UTC',
];

function supportedTimezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return FALLBACK_TIMEZONES;
  }
}

/** Time-zone `<select>` backed by `Intl.supportedValuesOf` (no static list shipped). */
export function TimezoneSelect({
  value,
  ...props
}: { value: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  const timezones = supportedTimezones();
  const options = timezones.includes(value) ? timezones : [value, ...timezones];
  return (
    <Select value={value} {...props}>
      {options.map((tz) => (
        <option key={tz} value={tz}>
          {tz}
        </option>
      ))}
    </Select>
  );
}
