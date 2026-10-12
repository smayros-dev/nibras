import { dirOf, type Locale } from '@tt/contracts';
import { formatMessage } from '../email/templates/layout';
import type { SmsParamsByKey, SmsTemplateKey } from './types';

export { SMS_TEMPLATE_KEYS } from './types';

/** Unicode FIRST STRONG ISOLATE / POP DIRECTIONAL ISOLATE. */
const FSI = '\u2068';
const PDI = '\u2069';

/**
 * Plain-text body of SMS `key` in `locale` (`sms.<key>`, ICU), with `appName` supplied. In an RTL
 * locale every string argument is wrapped in FSI…PDI so a code or a Latin name keeps its order
 * inside Arabic text. Throws on a missing message or argument (a broken SMS must fail loudly).
 * Real gateways (P1) send this text; the log and in-memory providers carry key and params only.
 */
export function renderSms<K extends SmsTemplateKey>(
  key: K,
  locale: Locale,
  params: SmsParamsByKey[K],
): string {
  const values: Record<string, string> = {
    appName: formatMessage(locale, 'common.appName'),
    ...params,
  };
  const isolated =
    dirOf(locale) === 'rtl'
      ? Object.fromEntries(Object.entries(values).map(([k, v]) => [k, `${FSI}${v}${PDI}`]))
      : values;
  return formatMessage(locale, `sms.${key}`, isolated);
}
