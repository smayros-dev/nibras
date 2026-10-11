import { dirOf, type Locale } from '@tt/contracts';
import type { EmailParams, EmailTemplateKey, RenderedEmail } from '../types';
import { escapeHtml, formatMessage, layout, lookup } from './layout';

export { escapeHtml, layout, type LayoutContent } from './layout';

/** Only absolute http(s) URLs may become a link (no `javascript:`/`data:` in an href). */
function assertHttpUrl(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error(`Email param "link" is not an absolute URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error(`Email param "link" must be an http(s) URL`);
  return link;
}

// Private-use sentinels marking where a string param lands in the HTML source; they survive ICU
// formatting and HTML escaping, then become `<bdi>…</bdi>` around the escaped value.
const SENTINEL = /\uE000(\d+)\uE001/g;
const sentinel = (i: number): string => `\uE000${i}\uE001`;
/** Unicode FIRST STRONG ISOLATE / POP DIRECTIONAL ISOLATE (plain-text bidi isolation). */
const FSI = '\u2068';
const PDI = '\u2069';

type IcuValues = Record<string, string | number>;

/** String params replaced by sentinels (numbers stay raw: ICU plurals need them). */
function sentinelParams(params: IcuValues): { values: string[]; params: IcuValues } {
  const values: string[] = [];
  const out: IcuValues = {};
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      out[name] = sentinel(values.length);
      values.push(value);
    } else out[name] = value;
  }
  return { values, params: out };
}

/** Text part: string params wrapped in FSI…PDI for RTL locales (Latin names, emails, IPs). */
function textParams(locale: Locale, params: IcuValues): IcuValues {
  if (dirOf(locale) !== 'rtl') return params;
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, typeof v === 'string' ? `${FSI}${v}${PDI}` : v]),
  );
}

/**
 * Renders `emails.<key>.{subject,title,body,cta?}` with ICU arguments `params` in `locale`.
 * Paragraphs of `body` are separated by a blank line. The HTML body is the escaped formatted
 * text in which every string param is an escaped `<bdi>` (bidi isolation, no markup injection);
 * the text part isolates string params with FSI…PDI in Arabic. When the template has a `cta`,
 * the `link` param (absolute http(s) URL) becomes the button and is appended to the text part.
 */
export function renderEmail<K extends EmailTemplateKey>(
  key: K,
  locale: Locale,
  params: EmailParams<K>,
): RenderedEmail {
  const raw = params as IcuValues;
  const base = `emails.${key}`;
  const subject = formatMessage(locale, `${base}.subject`, raw);
  const title = formatMessage(locale, `${base}.title`, raw);

  let cta: { label: string; url: string } | undefined;
  if (lookup(locale, `${base}.cta`) !== undefined) {
    const link = raw.link;
    if (typeof link !== 'string') throw new Error(`Email ${key} requires a "link" param`);
    cta = { label: formatMessage(locale, `${base}.cta`, raw), url: assertHttpUrl(link) };
  }

  const marked = sentinelParams(raw);
  const bodyHtml = formatMessage(locale, `${base}.body`, marked.params)
    .split(/\n{2,}/)
    .map((p) => {
      const html = escapeHtml(p)
        .replace(/\n/g, '<br>')
        .replace(SENTINEL, (_, i: string) => `<bdi>${escapeHtml(marked.values[Number(i)]!)}</bdi>`);
      return `<p style="margin:0 0 12px;line-height:1.5">${html}</p>`;
    })
    .join('\n');
  const html = layout(locale, { title, bodyHtml, cta });

  const appName = formatMessage(locale, 'common.appName');
  const text = [
    title,
    ...formatMessage(locale, `${base}.body`, textParams(locale, raw)).split(/\n{2,}/),
    ...(cta ? [`${cta.label}: ${cta.url}`] : []),
    '--',
    appName,
    formatMessage(locale, 'emails.footer.legal', { appName }),
  ].join('\n\n');

  return { subject, html, text: `${text}\n` };
}

const HREF = /href="([^"]*)"/g;
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** First `href` of `html` whose (decoded) URL contains `pathContains`, else `null` (test helper). */
export function extractFirstLink(html: string, pathContains: string): string | null {
  for (const [, raw] of html.matchAll(HREF)) {
    const url = raw!.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]!);
    if (url.includes(pathContains)) return url;
  }
  return null;
}
