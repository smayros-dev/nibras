import { describe, expect, it } from 'vitest';
import {
  EMPTY_DOC,
  RICH_TEXT_MAX_BYTES,
  RICH_TEXT_MAX_DEPTH,
  RichTextDescriptionSchema,
  RichTextDocSchema,
  collectImageIds,
  richTextPlainText,
  type RichTextDoc,
  type RichTextNode,
} from './rich-text';

const IMG_A = '0192f2a0-0000-7000-8000-00000000000a';
const IMG_B = '0192f2a0-0000-7000-8000-00000000000b';

const text = (t: string, marks?: unknown[]) => ({ type: 'text', text: t, ...(marks && { marks }) });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

/** A doc whose node depth is `depth` (doc = 1, the text node counts): blockquotes around a paragraph. */
function nested(depth: number): unknown {
  let node: unknown = para(text('x'));
  for (let d = 3; d < depth; d++) node = { type: 'blockquote', content: [node] };
  return doc(node);
}

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (result.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('RichTextDocSchema', () => {
  it('accepts headings, lists, marks, an https link and the editor attrs', () => {
    const value = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Titre')] },
      para(
        text('gras', [{ type: 'bold' }, { type: 'italic' }]),
        { type: 'hardBreak' },
        text('lien', [
          {
            type: 'link',
            attrs: {
              href: 'https://example.com/a?b=c',
              target: '_blank',
              rel: 'noopener noreferrer nofollow',
              class: null,
            },
          },
        ]),
      ),
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [para(text('un'))] }],
      },
      {
        type: 'orderedList',
        attrs: { start: 3, type: null },
        content: [{ type: 'listItem', content: [para(text('deux', [{ type: 'code' }]))] }],
      },
      { type: 'codeBlock', attrs: { language: null }, content: [text('const a = 1;')] },
      { type: 'horizontalRule' },
      { type: 'blockquote', content: [para(text('cité', [{ type: 'underline' }]))] },
      para(text('barré', [{ type: 'strike' }])),
      { type: 'image', attrs: { mediaId: IMG_A, alt: 'Schéma' } },
    );
    const result = RichTextDocSchema.safeParse(value);
    expect(issuePaths(result)).toEqual([]);
    expect(result.success).toBe(true);
    expect(RichTextDocSchema.safeParse(EMPTY_DOC).success).toBe(true);
  });

  it('refuses a javascript: link at marks[0].attrs.href', () => {
    const result = RichTextDocSchema.safeParse(
      doc(para(text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))),
    );
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('content.0.content.0.marks.0.attrs.href');
  });

  it('refuses a link longer than 2048 characters', () => {
    const href = `https://example.com/${'a'.repeat(2048)}`;
    expect(
      RichTextDocSchema.safeParse(doc(para(text('x', [{ type: 'link', attrs: { href } }]))))
        .success,
    ).toBe(false);
  });

  it('refuses unknown nodes, marks and attributes', () => {
    expect(RichTextDocSchema.safeParse(doc({ type: 'iframe', attrs: { src: 'x' } })).success).toBe(
      false,
    );
    expect(RichTextDocSchema.safeParse(doc(para(text('x', [{ type: 'color' }])))).success).toBe(
      false,
    );
    expect(
      RichTextDocSchema.safeParse(doc({ type: 'paragraph', attrs: { style: 'x' }, content: [] }))
        .success,
    ).toBe(false);
    expect(
      RichTextDocSchema.safeParse(doc({ type: 'heading', attrs: { level: 4 }, content: [] }))
        .success,
    ).toBe(false);
    expect(RichTextDocSchema.safeParse(doc(para({ type: 'text', text: '' }))).success).toBe(false);
    expect(
      RichTextDocSchema.safeParse(
        doc({ type: 'image', attrs: { mediaId: IMG_A, src: 'https://evil.test/x.png' } }),
      ).success,
    ).toBe(false);
    expect(RichTextDocSchema.safeParse({ type: 'paragraph' }).success).toBe(false);
    expect(RichTextDocSchema.safeParse(doc(doc())).success).toBe(false);
  });

  it('accepts an image in RichTextDocSchema, refuses it in RichTextDescriptionSchema', () => {
    const value = doc({ type: 'image', attrs: { mediaId: IMG_A } });
    expect(RichTextDocSchema.safeParse(value).success).toBe(true);
    expect(RichTextDescriptionSchema.safeParse(value).success).toBe(false);
    expect(RichTextDescriptionSchema.safeParse(doc(para(text('ok')))).success).toBe(true);
  });

  it(`refuses a depth over ${RICH_TEXT_MAX_DEPTH}`, () => {
    expect(RichTextDocSchema.safeParse(nested(RICH_TEXT_MAX_DEPTH)).success).toBe(true);
    const result = RichTextDocSchema.safeParse(nested(RICH_TEXT_MAX_DEPTH + 1));
    expect(result.success).toBe(false);
  });

  it(`refuses a serialised size over ${RICH_TEXT_MAX_BYTES} bytes`, () => {
    const big = doc(...Array.from({ length: 30 }, () => para(text('é'.repeat(4000)))));
    expect(RichTextDocSchema.safeParse(big).success).toBe(false);
    const small = doc(...Array.from({ length: 10 }, () => para(text('a'.repeat(4000)))));
    expect(RichTextDocSchema.safeParse(small).success).toBe(true);
  });
});

describe('rich-text helpers', () => {
  const sample = RichTextDocSchema.parse(
    doc(
      { type: 'heading', attrs: { level: 1 }, content: [text('Introduction')] },
      { type: 'image', attrs: { mediaId: IMG_B } },
      para(text('Bonjour '), text('à tous', [{ type: 'bold' }])),
      { type: 'image', attrs: { mediaId: IMG_A } },
      { type: 'blockquote', content: [{ type: 'image', attrs: { mediaId: IMG_B } }] },
    ),
  );

  it('collectImageIds returns ids in document order, deduplicated', () => {
    expect(collectImageIds(sample)).toEqual([IMG_B, IMG_A]);
    expect(collectImageIds(EMPTY_DOC)).toEqual([]);
  });

  it('richTextPlainText joins blocks and truncates at max with …', () => {
    expect(richTextPlainText(sample)).toBe('Introduction Bonjour à tous');
    const cut = richTextPlainText(sample, 10);
    expect(cut.length).toBeLessThanOrEqual(10);
    expect(cut.endsWith('…')).toBe(true);
    expect(richTextPlainText(EMPTY_DOC)).toBe('');
  });

  it('exposes typed nodes', () => {
    const node: RichTextNode = { type: 'paragraph', content: [{ type: 'text', text: 'a' }] };
    const d: RichTextDoc = { type: 'doc', content: [node] };
    expect(RichTextDocSchema.parse(d)).toEqual(d);
  });
});
