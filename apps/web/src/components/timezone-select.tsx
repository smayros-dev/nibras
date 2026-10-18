'use client';

import { Select } from '@nibras/ui';
import type { SelectHTMLAttributes } from 'react';
import { useTimezones } from '../lib/timezones';

/**
 * Time-zone `<select>`: the PRD zones on the server and in the first client render, the runtime's
 * full list after mount (`useTimezones`), so hydration never mismatches. An unlisted `value` is
 * kept; an empty one shows a blank placeholder until the caller fills it.
 */
export function TimezoneSelect({
  value,
  ...props
}: { value: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  const { options } = useTimezones(value || undefined);
  return (
    <Select value={value} {...props}>
      {value ? null : <option value="" disabled />}
      {options.map((tz) => (
        <option key={tz} value={tz}>
          {tz}
        </option>
      ))}
    </Select>
  );
}
