import { z } from 'zod';

/**
 * Rich text (spec §5, PRD §14.7 « texte riche assaini (liste blanche) »): ProseMirror JSON as the
 * Tiptap editor produces it, validated against a closed whitelist of nodes, marks and attributes
 * (`.strict()` everywhere: an unknown key is an issue at its path). Images carry a `mediaId`,
 * never a URL; links are `http(s)` only. The web renders this JSON with React, never as HTML.
 */

/** Serialised (UTF-8 JSON) size limit of one document. */
export const RICH_TEXT_MAX_BYTES = 200_000;
/** Node nesting limit (`doc` = 1). */
export const RICH_TEXT_MAX_DEPTH = 20;
/** Link `href` length limit. */
export const RICH_TEXT_HREF_MAX = 2048;
/** Image `alt` length limit. */
export const RICH_TEXT_ALT_MAX = 200;

export type RichTextMark =
  | { type: 'bold' | 'italic' | 'underline' | 'strike' | 'code' }
  | {
      type: 'link';
      attrs: {
        href: string;
        target?: '_blank' | null;
        rel?: string | null;
        // `class: null` (Tiptap's) is accepted by the schema but left out of the type: the
        // generated OpenAPI client types it as absent, and nothing reads it.
      };
    };

/** The whitelisted nodes; `Extra` is the `image` node for lesson content, `never` for descriptions. */
export type RichTextNodeOf<Extra> =
  | { type: 'text'; text: string; marks?: RichTextMark[] }
  | { type: 'paragraph'; content?: RichTextNodeOf<Extra>[] }
  | { type: 'heading'; attrs: { level: 1 | 2 | 3 }; content?: RichTextNodeOf<Extra>[] }
  | { type: 'bulletList'; content?: RichTextNodeOf<Extra>[] }
  | {
      type: 'orderedList';
      attrs?: { start?: number; type?: '1' | 'a' | 'A' | 'i' | 'I' | null };
      content?: RichTextNodeOf<Extra>[];
    }
  | { type: 'listItem'; content?: RichTextNodeOf<Extra>[] }
  | { type: 'blockquote'; content?: RichTextNodeOf<Extra>[] }
  | { type: 'codeBlock'; attrs?: { language?: string | null }; content?: RichTextNodeOf<Extra>[] }
  | { type: 'hardBreak' }
  | { type: 'horizontalRule' }
  | Extra;

export interface RichTextImageNode {
  type: 'image';
  attrs: { mediaId: string; alt?: string };
}

export type RichTextNode = RichTextNodeOf<RichTextImageNode>;
/** A node of a course description (no image at any depth). */
export type RichTextDescriptionNode = RichTextNodeOf<never>;

export interface RichTextDoc {
  type: 'doc';
  content?: RichTextNode[];
}

/** A course description: assignable to `RichTextDoc`, never holds an image. */
export interface RichTextDescriptionDoc {
  type: 'doc';
  content?: RichTextDescriptionNode[];
}

const MarkSchema: z.ZodType<RichTextMark> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.enum(['bold', 'italic', 'underline', 'strike', 'code']) }),
  z.strictObject({
    type: z.literal('link'),
    attrs: z.strictObject({
      href: z
        .string()
        .max(RICH_TEXT_HREF_MAX)
        .regex(/^https?:\/\//i, 'Only http(s) links are allowed'),
      // Emitted by Tiptap's link extension; the renderer sets its own `target` / `rel`.
      target: z.enum(['_blank']).nullable().optional(),
      rel: z.string().max(100).nullable().optional(),
      class: z.null().optional(),
    }),
  }),
]);

/** The node schema, with or without the `image` node (course descriptions have none). */
function nodeSchema(allowImage: boolean): z.ZodType<RichTextNode> {
  const self: z.ZodType<RichTextNode> = z.lazy(() => {
    const children = z.array(self).optional();
    const options = [
      z.strictObject({
        type: z.literal('text'),
        text: z.string().min(1),
        marks: z.array(MarkSchema).max(10).optional(),
      }),
      z.strictObject({ type: z.literal('paragraph'), content: children }),
      z.strictObject({
        type: z.literal('heading'),
        attrs: z.strictObject({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
        content: children,
      }),
      z.strictObject({ type: z.literal('bulletList'), content: children }),
      z.strictObject({
        type: z.literal('orderedList'),
        attrs: z
          .strictObject({
            start: z.number().int().min(1).max(100_000).optional(),
            type: z.enum(['1', 'a', 'A', 'i', 'I']).nullable().optional(),
          })
          .optional(),
        content: children,
      }),
      z.strictObject({ type: z.literal('listItem'), content: children }),
      z.strictObject({ type: z.literal('blockquote'), content: children }),
      z.strictObject({
        type: z.literal('codeBlock'),
        attrs: z
          .strictObject({
            language: z
              .string()
              .max(50)
              .regex(/^[A-Za-z0-9+#_-]*$/)
              .nullable()
              .optional(),
          })
          .optional(),
        content: children,
      }),
      z.strictObject({ type: z.literal('hardBreak') }),
      z.strictObject({ type: z.literal('horizontalRule') }),
      ...(allowImage
        ? [
            z.strictObject({
              type: z.literal('image'),
              attrs: z.strictObject({
                mediaId: z.uuid(),
                alt: z.string().max(RICH_TEXT_ALT_MAX).optional(),
              }),
            }),
          ]
        : []),
    ];
    return z.discriminatedUnion(
      'type',
      options as unknown as [z.ZodObject, z.ZodObject, ...z.ZodObject[]],
    ) as unknown as z.ZodType<RichTextNode>;
  });
  return self;
}

/** Node depth of a parsed tree (`doc` = 1). */
function depthOf(node: { content?: readonly unknown[] }): number {
  let max = 0;
  for (const child of node.content ?? []) {
    max = Math.max(max, depthOf(child as { content?: readonly unknown[] }));
  }
  return max + 1;
}

const encoder = new TextEncoder();

function docSchema(allowImage: boolean): z.ZodType<RichTextDoc> {
  return z
    .strictObject({
      type: z.literal('doc'),
      content: z.array(nodeSchema(allowImage)).optional(),
    })
    .superRefine((doc, ctx) => {
      if (depthOf(doc) > RICH_TEXT_MAX_DEPTH) {
        ctx.addIssue({
          code: 'custom',
          message: `Nesting deeper than ${RICH_TEXT_MAX_DEPTH} levels`,
        });
      }
      if (encoder.encode(JSON.stringify(doc)).length > RICH_TEXT_MAX_BYTES) {
        ctx.addIssue({ code: 'custom', message: `Larger than ${RICH_TEXT_MAX_BYTES} bytes` });
      }
    }) as unknown as z.ZodType<RichTextDoc>;
}

/** A TEXT lesson's content. */
export const RichTextDocSchema = docSchema(true);
/** A course description: the same whitelist without `image`. */
export const RichTextDescriptionSchema = docSchema(
  false,
) as unknown as z.ZodType<RichTextDescriptionDoc>;

/** A document with one empty paragraph (what a fresh editor holds). */
export const EMPTY_DOC: RichTextDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

function walk(node: RichTextDoc | RichTextNode, visit: (n: RichTextNode) => void): void {
  if (node.type !== 'doc') visit(node);
  if ('content' in node && node.content) for (const child of node.content) walk(child, visit);
}

/** The `mediaId`s of the document's images, in document order, deduplicated. */
export function collectImageIds(doc: RichTextDoc): string[] {
  const ids = new Set<string>();
  walk(doc, (n) => {
    if (n.type === 'image') ids.add(n.attrs.mediaId);
  });
  return [...ids];
}

const BLOCKS = new Set<RichTextNode['type']>([
  'paragraph',
  'heading',
  'listItem',
  'blockquote',
  'codeBlock',
  'hardBreak',
  'horizontalRule',
]);

/**
 * The document's text (blocks separated by one space, whitespace collapsed) for list excerpts,
 * cut to at most `max` characters ending with `…` when longer.
 */
export function richTextPlainText(doc: RichTextDoc, max = 200): string {
  const parts: string[] = [];
  walk(doc, (n) => {
    if (n.type === 'text') parts.push(n.text);
    else if (BLOCKS.has(n.type)) parts.push(' ');
  });
  const text = parts.join('').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
