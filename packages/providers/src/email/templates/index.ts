import type { Locale } from '@tt/contracts';
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

/**
 * Renders `emails.<key>.{subject,title,body,cta?}` with ICU arguments `params` in `locale`.
 * Paragraphs of `body` are separated by a blank line. Params are formatted raw then the whole
 * text is HTML-escaped, so no param can inject markup. When the template has a `cta`, the
 * `link` param becomes the button (and is appended to the text part).
 */
export function renderEmail(
  key: EmailTemplateKey,
  locale: Locale,
  params: EmailParams,
): RenderedEmail {
  const base = `emails.${key}`;
  const subject = formatMessage(locale, `${base}.subject`, params);
  const title = formatMessage(locale, `${base}.title`, params);
  const paragraphs = formatMessage(locale, `${base}.body`, params).split(/\n{2,}/);

  let cta: { label: string; url: string } | undefined;
  if (lookup(locale, `${base}.cta`) !== undefined) {
    const link = params.link;
    if (typeof link !== 'string') throw new Error(`Email ${key} requires a "link" param`);
    cta = { label: formatMessage(locale, `${base}.cta`, params), url: assertHttpUrl(link) };
  }

  const bodyHtml = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`,
    )
    .join('\n');
  const html = layout(locale, { title, bodyHtml, cta });

  const appName = formatMessage(locale, 'common.appName');
  const text = [
    title,
    ...paragraphs,
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
