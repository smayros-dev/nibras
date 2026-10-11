import { dirOf, intlTag, type Locale } from '@tt/contracts';
import { getMessages, type AbstractIntlMessages } from '@tt/i18n';
import { IntlMessageFormat } from 'intl-messageformat';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]!);
}

/** The catalogue string at a dotted path, or `undefined` when absent. */
export function lookup(locale: Locale, path: string): string | undefined {
  const node = path
    .split('.')
    .reduce<AbstractIntlMessages | string | undefined>(
      (n, part) => (typeof n === 'object' ? n[part] : undefined),
      getMessages(locale),
    );
  return typeof node === 'string' ? node : undefined;
}

/**
 * Formats the ICU message at `path` as plain text; throws when the key or an argument is missing
 * (a broken email must fail loudly, never ship `{firstName}` or a raw key).
 */
export function formatMessage(
  locale: Locale,
  path: string,
  params: Record<string, string | number> = {},
): string {
  const source = lookup(locale, path);
  if (source === undefined) throw new Error(`Missing email message ${locale}:${path}`);
  return String(new IntlMessageFormat(source, intlTag(locale)).format(params));
}

export interface LayoutContent {
  /** Plain text; escaped here. */
  title: string;
  /** Already-escaped HTML. */
  bodyHtml: string;
  /** Call-to-action button; `label` is plain text, `url` an http(s) URL. */
  cta?: { label: string; url: string };
}

/**
 * Wraps an email body in the shared layout: `<html lang dir>` (RTL for Arabic), the app name,
 * an optional call-to-action button followed by its raw link, and the legal footer line
 * (`emails.footer.legal`). Inline styles only: mail clients drop `<style>` blocks inconsistently.
 */
export function layout(locale: Locale, content: LayoutContent): string {
  const dir = dirOf(locale);
  const align = dir === 'rtl' ? 'right' : 'left';
  const appName = formatMessage(locale, 'common.appName');
  const footer = formatMessage(locale, 'emails.footer.legal', { appName });
  const cta = content.cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(content.cta.url)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">${escapeHtml(content.cta.label)}</a></p>
<p style="font-size:13px;color:#4b5563">${escapeHtml(formatMessage(locale, 'emails.footer.linkFallback'))}<br><a href="${escapeHtml(content.cta.url)}" style="color:#1d4ed8;word-break:break-all">${escapeHtml(content.cta.url)}</a></p>
`
    : '';
  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(content.title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6">
<div dir="${dir}" style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;color:#111827;text-align:${align}">
<p style="font-size:14px;font-weight:700;color:#1d4ed8;margin:0 0 16px">${escapeHtml(appName)}</p>
<div style="background:#ffffff;border-radius:8px;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(content.title)}</h1>
${content.bodyHtml}
${cta}</div>
<p style="font-size:12px;color:#6b7280;margin:16px 0 0">${escapeHtml(footer)}</p>
</div>
</body>
</html>
`;
}
