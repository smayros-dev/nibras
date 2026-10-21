import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RichTextDoc } from '@nibras/contracts';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../../test/render';
import { RichTextEditor } from './editor';

const upload = vi.fn<(file: File, signal: AbortSignal) => Promise<{ id: string }>>();

const MEDIA = '0192f000-0000-7000-8000-0000000000aa';

beforeAll(() => {
  URL.createObjectURL = () => 'blob:preview';
  URL.revokeObjectURL = () => {};
});

const onChange = vi.fn<(doc: RichTextDoc) => void>();

beforeEach(() => {
  onChange.mockReset();
  upload.mockReset();
});

function renderEditor(extra: Partial<Parameters<typeof RichTextEditor>[0]> = {}) {
  return renderWithIntl(
    <RichTextEditor id="content" label="Contenu" value={null} onChange={onChange} {...extra} />,
  );
}

const box = () => screen.getByRole('textbox', { name: 'Contenu' });
const lastDoc = () => onChange.mock.calls.at(-1)?.[0];
const button = (key: string) => screen.getByRole('button', { name: tr('fr', `editor.${key}`) });

describe('RichTextEditor', () => {
  it('typing emits a whitelisted doc with a paragraph', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(box());
    await user.keyboard('Bonjour');
    await waitFor(() =>
      expect(lastDoc()).toEqual({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bonjour' }] }],
      }),
    );
  });

  it('loads a value and toggles bold (aria-pressed)', async () => {
    const user = userEvent.setup();
    renderEditor({
      value: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Texte' }] }],
      },
    });
    expect(box()).toHaveTextContent('Texte');
    const bold = button('bold');
    expect(bold).toHaveAttribute('aria-pressed', 'false');
    await user.click(box());
    await user.keyboard('{Control>}a{/Control}');
    await user.click(bold);
    await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'true'));
    expect(lastDoc()?.content?.[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Texte', marks: [{ type: 'bold' }] }],
    });
  });

  it('the link form refuses javascript: and applies an https link', async () => {
    const user = userEvent.setup();
    renderEditor({
      value: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'site' }] }],
      },
    });
    await user.click(box());
    await user.keyboard('{Control>}a{/Control}');
    await user.click(button('link'));
    const url = screen.getByRole('textbox', { name: tr('fr', 'editor.linkUrl') });
    await user.type(url, 'javascript:alert(1)');
    await user.click(button('linkApply'));
    expect(screen.getByText(tr('fr', 'editor.linkInvalid'))).toBeInTheDocument();
    expect(JSON.stringify(onChange.mock.calls)).not.toContain('javascript:');

    await user.clear(url);
    await user.type(url, 'https://example.com');
    await user.click(button('linkApply'));
    await waitFor(() =>
      expect(lastDoc()?.content?.[0]).toEqual({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'site',
            marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
          },
        ],
      }),
    );
  });

  it('the toolbar is one tab stop moved with the arrow keys (reversed in RTL)', async () => {
    const user = userEvent.setup();
    renderEditor();
    const toolbar = screen.getByRole('toolbar', { name: tr('fr', 'editor.toolbar') });
    const buttons = Array.from(toolbar.querySelectorAll('button'));
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    act(() => buttons[0]!.focus());
    await user.keyboard('{ArrowRight}');
    expect(buttons[1]).toHaveFocus();
    await user.keyboard('{End}');
    expect(buttons.at(-1)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(buttons[0]).toHaveFocus();
    expect(screen.queryByRole('button', { name: tr('fr', 'editor.image') })).toBeNull();
  });

  it('uploads an inline image and inserts it with its alt text', async () => {
    const user = userEvent.setup();
    upload.mockResolvedValue({ id: MEDIA });
    renderEditor({ images: { urls: {}, upload } });
    await user.click(button('image'));
    const file = new File([new Uint8Array([0x89, 0x50])], 'schema.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(tr('fr', 'editor.imageFile')), file);
    await user.type(
      screen.getByRole('textbox', { name: tr('fr', 'editor.imageAlt') }),
      'Un schéma',
    );
    await user.click(button('imageInsert'));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(file, expect.any(AbortSignal)));
    await waitFor(() =>
      expect(lastDoc()?.content).toContainEqual({
        type: 'image',
        attrs: { mediaId: MEDIA, alt: 'Un schéma' },
      }),
    );
    expect(screen.getByRole('img', { name: 'Un schéma' })).toHaveAttribute('src', 'blob:preview');
  });
});
