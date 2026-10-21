import { screen } from '@testing-library/react';
import type { RichTextDoc } from '@nibras/contracts';
import { describe, expect, it } from 'vitest';
import { renderWithIntl, tr } from '../../test/render';
import { RichText } from './renderer';

const IMG = '0192f000-0000-7000-8000-000000000001';
const MISSING = '0192f000-0000-7000-8000-000000000002';

const doc: RichTextDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Titre' }] },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Sous-titre' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'gras', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'italique', marks: [{ type: 'italic' }] },
        { type: 'text', text: 'souligné', marks: [{ type: 'underline' }] },
        { type: 'text', text: 'barré', marks: [{ type: 'strike' }] },
        { type: 'text', text: 'x = 1', marks: [{ type: 'code' }] },
        { type: 'hardBreak' },
        {
          type: 'text',
          text: 'site',
          marks: [{ type: 'link', attrs: { href: 'https://example.com/a' } }, { type: 'bold' }],
        },
        {
          type: 'text',
          text: 'piège',
          marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
        },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'puce' }] }],
        },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 3, type: 'a' },
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'trois' }] }],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'citation' }] }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const a = 1;' }],
    },
    { type: 'horizontalRule' },
    { type: 'image', attrs: { mediaId: IMG, alt: 'Un schéma' } },
    { type: 'image', attrs: { mediaId: MISSING, alt: 'Absente' } },
  ],
};

describe('RichText', () => {
  it('renders every node and mark as elements', () => {
    const { container } = renderWithIntl(
      <RichText doc={doc} images={{ [IMG]: 'https://media.example/x.png?sig=1' }} />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Titre' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Sous-titre' })).toBeInTheDocument();
    expect(screen.getByText('gras').tagName).toBe('STRONG');
    expect(screen.getByText('italique').tagName).toBe('EM');
    expect(screen.getByText('souligné').tagName).toBe('U');
    expect(screen.getByText('barré').tagName).toBe('S');
    expect(screen.getByText('x = 1').tagName).toBe('CODE');
    expect(container.querySelector('br')).not.toBeNull();
    expect(screen.getByText('puce').closest('ul')).not.toBeNull();
    const ol = screen.getByText('trois').closest('ol');
    expect(ol).toHaveAttribute('start', '3');
    expect(screen.getByText('citation').closest('blockquote')).not.toBeNull();
    const pre = screen.getByText('const a = 1;').closest('pre');
    expect(pre).toHaveAttribute('dir', 'ltr');
    expect(container.querySelector('hr')).not.toBeNull();
  });

  it('links open in a new tab with noopener noreferrer and an sr-only cue', () => {
    renderWithIntl(<RichText doc={doc} />);
    const link = screen.getByRole('link', { name: /^site/ });
    expect(link).toHaveAttribute('href', 'https://example.com/a');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('site').tagName).toBe('STRONG');
    expect(link).toHaveTextContent(`site ${tr('fr', 'common.newTab')}`);
  });

  it('a javascript: href never reaches the DOM', () => {
    const { container } = renderWithIntl(<RichText doc={doc} />);
    expect(screen.getByText('piège').closest('a')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('resolves images by mediaId and shows a placeholder for a missing URL', () => {
    renderWithIntl(<RichText doc={doc} images={{ [IMG]: 'https://media.example/x.png?sig=1' }} />);
    const img = screen.getByRole('img', { name: 'Un schéma' });
    expect(img).toHaveAttribute('src', 'https://media.example/x.png?sig=1');
    const placeholder = screen.getByRole('img', { name: 'Absente' });
    expect(placeholder).toHaveTextContent(tr('fr', 'editor.imageUnavailable'));
  });

  it('ignores an unknown node and renders in RTL', () => {
    const odd = {
      type: 'doc',
      content: [
        { type: 'iframe', attrs: { src: 'https://evil.example' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'مرحبا' }] },
      ],
    } as unknown as RichTextDoc;
    const { container } = renderWithIntl(<RichText doc={odd} />, { locale: 'ar' });
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByText('مرحبا')).toHaveAttribute('dir', 'auto');
  });

  it('renders nothing for a null document', () => {
    renderWithIntl(
      <div data-testid="host">
        <RichText doc={null} />
      </div>,
    );
    expect(screen.getByTestId('host')).toBeEmptyDOMElement();
  });
});
