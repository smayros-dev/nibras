import type {
  RichTextDescriptionDoc,
  RichTextDoc,
  RichTextMark,
  RichTextNode,
} from '@nibras/contracts';

/**
 * Zod-free helpers around the rich-text whitelist (`@nibras/contracts` `rich-text.ts`, PRD §14.7):
 * the web may not import the schema module (first-load budget), so `cleanRichText` rebuilds an
 * editor's JSON into exactly the whitelisted shape and `richTextProblem` checks the size and depth
 * limits before a submit. The API validates again.
 */

/** Mirrors `RICH_TEXT_MAX_BYTES` / `RICH_TEXT_MAX_DEPTH` / `RICH_TEXT_HREF_MAX` / `RICH_TEXT_ALT_MAX`. */
export const RICH_TEXT_LIMITS = {
  maxBytes: 200_000,
  maxDepth: 20,
  hrefMax: 2048,
  altMax: 200,
} as const;

/** A document with one empty paragraph (what a fresh editor holds). */
export const EMPTY_DOC: RichTextDescriptionDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGE = /^[A-Za-z0-9+#_-]{1,50}$/;
const LIST_TYPES = new Set(['1', 'a', 'A', 'i', 'I']);
const SIMPLE_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code']);

/** True for an `http(s)` URL the whitelist accepts as a link `href`. */
export function isAllowedHref(href: string): boolean {
  return href.length <= RICH_TEXT_LIMITS.hrefMax && /^https?:\/\/\S+$/i.test(href);
}

/**
 * The `href` a rendered link may carry: `http(s)` or `mailto:`, else `null` (never a
 * `javascript:`, `data:` or relative URL, whatever the stored document says).
 */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const value = href.trim();
  if (/^https?:\/\/\S+$/i.test(value) || /^mailto:[^\s:]+@\S+$/i.test(value)) return value;
  return null;
}

/** True when the document has no text, image or rule (an empty editor). */
export function isEmptyDoc(doc: RichTextDoc | null | undefined): boolean {
  const visit = (nodes: readonly RichTextNode[] | undefined): boolean =>
    (nodes ?? []).every((n) => {
      if (n.type === 'text') return n.text.trim() === '';
      if (n.type === 'image' || n.type === 'horizontalRule') return false;
      return 'content' in n ? visit(n.content) : true;
    });
  return !doc || visit(doc.content);
}

/** One paragraph per non-blank line; an empty text is the empty document. */
export function docFromPlainText(text: string): RichTextDoc {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) return EMPTY_DOC;
  return {
    type: 'doc',
    content: lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
  };
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null;

function cleanMarks(marks: unknown): RichTextMark[] | undefined {
  if (!Array.isArray(marks)) return undefined;
  const out: RichTextMark[] = [];
  for (const m of marks) {
    if (!isObject(m) || typeof m.type !== 'string') continue;
    if (SIMPLE_MARKS.has(m.type)) {
      out.push({ type: m.type as 'bold' });
    } else if (m.type === 'link' && isObject(m.attrs)) {
      const href = m.attrs.href;
      if (typeof href === 'string' && isAllowedHref(href))
        out.push({ type: 'link', attrs: { href } });
    }
    if (out.length === 10) break;
  }
  return out.length > 0 ? out : undefined;
}

function cleanChildren(content: unknown, allowImage: boolean): RichTextNode[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const out = content
    .map((c) => cleanNode(c, allowImage))
    .filter((c): c is RichTextNode => c !== null);
  return out.length > 0 ? out : undefined;
}

function withContent<T extends RichTextNode>(node: T, content: RichTextNode[] | undefined): T {
  return content ? { ...node, content } : node;
}

function cleanNode(node: unknown, allowImage: boolean): RichTextNode | null {
  if (!isObject(node) || typeof node.type !== 'string') return null;
  const attrs = isObject(node.attrs) ? node.attrs : {};
  const children = () => cleanChildren(node.content, allowImage);
  switch (node.type) {
    case 'text': {
      if (typeof node.text !== 'string' || node.text === '') return null;
      const marks = cleanMarks(node.marks);
      return marks ? { type: 'text', text: node.text, marks } : { type: 'text', text: node.text };
    }
    case 'paragraph':
    case 'bulletList':
    case 'listItem':
    case 'blockquote':
      return withContent({ type: node.type }, children());
    case 'heading': {
      const level = attrs.level === 1 || attrs.level === 2 || attrs.level === 3 ? attrs.level : 2;
      return withContent({ type: 'heading', attrs: { level } }, children());
    }
    case 'orderedList': {
      const out: { start?: number; type?: '1' } = {};
      const { start, type } = attrs;
      if (typeof start === 'number' && Number.isInteger(start) && start > 1 && start <= 100_000) {
        out.start = start;
      }
      if (typeof type === 'string' && LIST_TYPES.has(type)) out.type = type as '1';
      return withContent(
        Object.keys(out).length > 0 ? { type: 'orderedList', attrs: out } : { type: 'orderedList' },
        children(),
      );
    }
    case 'codeBlock': {
      const { language } = attrs;
      const node2: RichTextNode =
        typeof language === 'string' && LANGUAGE.test(language)
          ? { type: 'codeBlock', attrs: { language } }
          : { type: 'codeBlock' };
      return withContent(node2, children());
    }
    case 'hardBreak':
    case 'horizontalRule':
      return { type: node.type };
    case 'image': {
      if (!allowImage || typeof attrs.mediaId !== 'string' || !UUID.test(attrs.mediaId)) {
        return null;
      }
      const alt =
        typeof attrs.alt === 'string' ? attrs.alt.trim().slice(0, RICH_TEXT_LIMITS.altMax) : '';
      return {
        type: 'image',
        attrs: alt ? { mediaId: attrs.mediaId, alt } : { mediaId: attrs.mediaId },
      };
    }
    default:
      return null;
  }
}

function depthOf(node: { content?: readonly unknown[] }): number {
  let max = 0;
  for (const child of node.content ?? []) {
    max = Math.max(max, depthOf(child as { content?: readonly unknown[] }));
  }
  return max + 1;
}

export type RichTextProblem = 'tooLarge' | 'tooDeep';

/**
 * An editor's JSON rebuilt as a whitelisted document (`allowImage: false` for a course
 * description): unknown nodes, marks and attributes are dropped, links keep an `http(s)` `href`.
 */
export function cleanRichText(
  json: unknown,
  options: { allowImage: false },
): RichTextDescriptionDoc;
export function cleanRichText(json: unknown, options: { allowImage: boolean }): RichTextDoc;
export function cleanRichText(json: unknown, { allowImage }: { allowImage: boolean }): RichTextDoc {
  const content = isObject(json) ? cleanChildren(json.content, allowImage) : undefined;
  return content ? { type: 'doc', content } : EMPTY_DOC;
}

/** The message of a limit `richTextProblem` reports. */
export function richTextProblemMessage(
  t: (key: 'editor.tooLarge' | 'editor.tooDeep') => string,
  problem: RichTextProblem,
): string {
  return problem === 'tooLarge' ? t('editor.tooLarge') : t('editor.tooDeep');
}

/** The limit a document breaks (`RICH_TEXT_MAX_DEPTH`, `RICH_TEXT_MAX_BYTES`), or `null`. */
export function richTextProblem(doc: RichTextDoc): RichTextProblem | null {
  if (depthOf(doc) > RICH_TEXT_LIMITS.maxDepth) return 'tooDeep';
  if (new TextEncoder().encode(JSON.stringify(doc)).length > RICH_TEXT_LIMITS.maxBytes) {
    return 'tooLarge';
  }
  return null;
}
