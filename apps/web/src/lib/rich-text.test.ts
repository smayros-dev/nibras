import { describe, expect, it } from 'vitest';
import {
  cleanRichText,
  docFromPlainText,
  EMPTY_DOC,
  isEmptyDoc,
  richTextProblem,
  safeHref,
} from './rich-text';

const MEDIA = '0192f000-0000-7000-8000-0000000000aa';

describe('cleanRichText', () => {
  it('keeps the whitelist and drops Tiptap extras, unknown nodes and unsafe links', () => {
    const tiptap = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { dir: 'auto' }, content: [{ type: 'text', text: 'a' }] },
        { type: 'orderedList', attrs: { start: 1, type: null }, content: [] },
        { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'x' }] },
        { type: 'iframe', attrs: { src: 'https://evil.example' } },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'l',
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'https://a.example', target: '_blank', rel: 'x', class: null },
                },
                { type: 'textStyle', attrs: { color: 'red' } },
              ],
            },
            { type: 'text', text: 'j', marks: [{ type: 'link', attrs: { href: 'javascript:x' } }] },
          ],
        },
        { type: 'image', attrs: { mediaId: MEDIA, alt: ' Schéma ' } },
      ],
    };
    expect(cleanRichText(tiptap, { allowImage: true })).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'orderedList' },
        { type: 'codeBlock', content: [{ type: 'text', text: 'x' }] },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'l',
              marks: [{ type: 'link', attrs: { href: 'https://a.example' } }],
            },
            { type: 'text', text: 'j' },
          ],
        },
        { type: 'image', attrs: { mediaId: MEDIA, alt: 'Schéma' } },
      ],
    });
    expect(cleanRichText(tiptap, { allowImage: false }).content).not.toContainEqual(
      expect.objectContaining({ type: 'image' }),
    );
    expect(cleanRichText(null, { allowImage: true })).toEqual(EMPTY_DOC);
  });

  it('reports the size and depth limits', () => {
    const big = docFromPlainText('x'.repeat(200_001));
    expect(richTextProblem(big)).toBe('tooLarge');
    let deep: { type: string; content?: unknown[] } = { type: 'paragraph' };
    for (let i = 0; i < 20; i += 1) deep = { type: 'blockquote', content: [deep] };
    expect(richTextProblem({ type: 'doc', content: [deep as never] })).toBe('tooDeep');
    expect(richTextProblem(EMPTY_DOC)).toBeNull();
  });
});

describe('helpers', () => {
  it('safeHref allows http(s) and mailto only', () => {
    expect(safeHref('https://a.example/x')).toBe('https://a.example/x');
    expect(safeHref('mailto:prof@ecole.tn')).toBe('mailto:prof@ecole.tn');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref(' JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('/relative')).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });

  it('isEmptyDoc and docFromPlainText', () => {
    expect(isEmptyDoc(EMPTY_DOC)).toBe(true);
    expect(isEmptyDoc(null)).toBe(true);
    expect(isEmptyDoc(docFromPlainText('  \n '))).toBe(true);
    expect(isEmptyDoc(docFromPlainText('a'))).toBe(false);
    expect(
      isEmptyDoc({ type: 'doc', content: [{ type: 'image', attrs: { mediaId: MEDIA } }] }),
    ).toBe(false);
    expect(docFromPlainText('a\n\nb').content).toHaveLength(2);
  });
});
