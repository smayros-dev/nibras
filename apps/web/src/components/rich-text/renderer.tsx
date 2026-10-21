import type { RichTextDoc, RichTextMark, RichTextNode } from '@nibras/contracts';
import { useTranslations } from 'next-intl';
import { Fragment, type ReactNode } from 'react';
import { safeHref } from '../../lib/rich-text';

type Translate = ReturnType<typeof useTranslations>;

interface Ctx {
  images: Record<string, string>;
  t: Translate;
}

const LIST_STYLE: Record<string, string> = {
  '1': 'list-decimal',
  a: 'list-[lower-alpha]',
  A: 'list-[upper-alpha]',
  i: 'list-[lower-roman]',
  I: 'list-[upper-roman]',
};

function applyMark(mark: RichTextMark, child: ReactNode, ctx: Ctx, key: number): ReactNode {
  switch (mark.type) {
    case 'bold':
      return <strong key={key}>{child}</strong>;
    case 'italic':
      return <em key={key}>{child}</em>;
    case 'underline':
      return <u key={key}>{child}</u>;
    case 'strike':
      return <s key={key}>{child}</s>;
    case 'code':
      return (
        <code key={key} dir="ltr" className="rounded-sm bg-bg-subtle px-1 font-mono text-[0.9em]">
          {child}
        </code>
      );
    case 'link': {
      const href = safeHref(mark.attrs?.href);
      // An href outside http(s)/mailto never reaches the DOM: the text stays, unlinked.
      if (!href) return <Fragment key={key}>{child}</Fragment>;
      return (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {child}
          <span className="sr-only"> {ctx.t('common.newTab')}</span>
        </a>
      );
    }
    default:
      return child;
  }
}

function children(node: { content?: RichTextNode[] }, ctx: Ctx): ReactNode {
  return (node.content ?? []).map((child, i) => renderNode(child, ctx, i));
}

function renderNode(node: RichTextNode, ctx: Ctx, key: number): ReactNode {
  switch (node.type) {
    case 'text':
      // Marks wrap innermost-first, so a link stays the outermost element of its text.
      return (
        <Fragment key={key}>
          {[...(node.marks ?? [])]
            .sort((a, b) => Number(a.type === 'link') - Number(b.type === 'link'))
            .reduce<ReactNode>((acc, mark, i) => applyMark(mark, acc, ctx, i), node.text)}
        </Fragment>
      );
    case 'paragraph':
      return (
        <p key={key} dir="auto">
          {children(node, ctx)}
        </p>
      );
    case 'heading': {
      const Tag = (['h2', 'h3', 'h4'] as const)[(node.attrs?.level ?? 1) - 1] ?? 'h4';
      const size = { h2: 'text-xl', h3: 'text-lg', h4: 'text-base' }[Tag];
      // Rendered one level below the page's own `h1`.
      return (
        <Tag key={key} dir="auto" className={`${size} font-semibold text-fg`}>
          {children(node, ctx)}
        </Tag>
      );
    }
    case 'bulletList':
      return (
        <ul key={key} className="list-disc ps-6">
          {children(node, ctx)}
        </ul>
      );
    case 'orderedList':
      return (
        <ol
          key={key}
          start={node.attrs?.start}
          className={`${LIST_STYLE[node.attrs?.type ?? '1'] ?? 'list-decimal'} ps-6`}
        >
          {children(node, ctx)}
        </ol>
      );
    case 'listItem':
      return (
        <li key={key} dir="auto">
          {children(node, ctx)}
        </li>
      );
    case 'blockquote':
      return (
        <blockquote key={key} className="border-s-4 border-border ps-4 text-fg-muted">
          {children(node, ctx)}
        </blockquote>
      );
    case 'codeBlock':
      return (
        <pre
          key={key}
          dir="ltr"
          className="overflow-x-auto rounded-md bg-bg-subtle p-3 text-start font-mono text-sm"
        >
          <code>{children(node, ctx)}</code>
        </pre>
      );
    case 'hardBreak':
      return <br key={key} />;
    case 'horizontalRule':
      return <hr key={key} className="border-border" />;
    case 'image': {
      const src = ctx.images[node.attrs.mediaId];
      if (!src) {
        return (
          <p
            key={key}
            role="img"
            aria-label={node.attrs.alt || ctx.t('editor.imageUnavailable')}
            className="rounded-md border border-dashed border-border p-4 text-center text-sm text-fg-muted"
          >
            {ctx.t('editor.imageUnavailable')}
          </p>
        );
      }
      return (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL of the media store
        <img
          key={key}
          src={src}
          alt={node.attrs.alt ?? ''}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-auto max-w-full rounded-md"
        />
      );
    }
    default:
      // Defensive: the API never sends a node outside the whitelist.
      return null;
  }
}

/**
 * A rich-text document (PRD §14.7) as React elements — never HTML: headings (one level below the
 * page's), lists, quotes, code, links (`http(s)`/`mailto` only, new tab, `noopener noreferrer`)
 * and inline images resolved through `images` (`mediaId` → presigned URL), with a placeholder when
 * a URL is missing. Each block takes its own direction (`dir="auto"`), so Arabic and French
 * paragraphs sit correctly in either UI direction; code stays left-to-right.
 */
export function RichText({
  doc,
  images = {},
  className,
}: {
  doc: RichTextDoc | null | undefined;
  images?: Record<string, string>;
  className?: string;
}) {
  const t = useTranslations();
  if (!doc) return null;
  return (
    <div className={`flex flex-col gap-3 leading-relaxed text-fg ${className ?? ''}`}>
      {children(doc, { images, t })}
    </div>
  );
}
