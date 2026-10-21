'use client';

import type { RichTextDoc } from '@nibras/contracts';
import { MEDIA_MIME_TYPES } from '@nibras/contracts/web';
import { Button, Input } from '@nibras/ui';
import { Link } from '@tiptap/extension-link';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cleanRichText, EMPTY_DOC, isAllowedHref, RICH_TEXT_LIMITS } from '../../lib/rich-text';
import { MediaImageNode } from './media-image-node';
import { Toolbar } from './toolbar';

export interface RichTextEditorProps {
  /** Id of the editable region (`aria-invalid` focus after a failed submit finds it). */
  id: string;
  label: string;
  description?: string;
  /** Translated message; marks the region invalid. */
  error?: string;
  value: RichTextDoc | null;
  /** The whitelisted document after each change (`cleanRichText`). */
  onChange: (doc: RichTextDoc) => void;
  /**
   * Inline images (TEXT lessons): `urls` maps the document's `mediaId`s to the lesson's presigned
   * URLs and `upload` stores a picked file as an IMAGE media of the workspace. Absent: no image
   * button and images are dropped (a course description has none).
   */
  images?: RichTextImages;
  disabled?: boolean;
}

export interface RichTextImages {
  urls: Record<string, string>;
  upload: (file: File, signal: AbortSignal) => Promise<{ id: string }>;
}

type Panel = 'link' | 'image' | null;

const CONTENT_CLASSES = [
  'min-h-40 px-3 py-2 text-fg outline-none',
  '[&_p]:my-1 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold',
  '[&_h3]:font-semibold [&_ul]:list-disc [&_ul]:ps-6 [&_ol]:list-decimal [&_ol]:ps-6',
  '[&_blockquote]:border-s-4 [&_blockquote]:border-border [&_blockquote]:ps-4',
  '[&_pre]:rounded-md [&_pre]:bg-bg-subtle [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-sm',
  '[&_code]:font-mono [&_a]:text-primary [&_a]:underline [&_hr]:my-3 [&_hr]:border-border',
].join(' ');

/**
 * The rich-text editor (Tiptap 3, PRD §14.7): StarterKit limited to the whitelist (headings 1–3,
 * lists, quote, code, rule, bold/italic/underline/strike/code, `http(s)` links only), plus the
 * `image` node for TEXT lessons. Emits whitelisted JSON (`cleanRichText`), never HTML. Each block
 * takes its own direction (`textDirection: 'auto'`). Heavy: consumers load it lazily
 * (`LazyRichTextEditor`).
 */
export function RichTextEditor({
  id,
  label,
  description,
  error,
  value,
  onChange,
  images,
  disabled,
}: RichTextEditorProps) {
  const t = useTranslations('editor');
  const base = useId();
  const labelId = `${base}-label`;
  const descriptionId = description ? `${base}-description` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  const allowImage = images !== undefined;
  const urls = useRef<Record<string, string>>({});
  const previews = useRef<string[]>([]);
  /** The documents this editor emitted: one coming back through `value` is not re-applied. */
  const emitted = useRef(new WeakSet<RichTextDoc>());
  const onChangeRef = useRef(onChange);
  const [panel, setPanel] = useState<Panel>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    immediatelyRender: false,
    textDirection: 'auto',
    editable: !disabled,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
      Link.configure({
        openOnClick: false,
        isAllowedUri: (url) => isAllowedHref(url),
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      ...(allowImage
        ? [
            MediaImageNode.configure({
              resolveUrl: (mediaId) => urls.current[mediaId],
              unavailableLabel: t('imageUnavailable'),
            }),
          ]
        : []),
    ],
    content: value ?? EMPTY_DOC,
    onUpdate: ({ editor: e }) => {
      const doc = cleanRichText(e.getJSON(), { allowImage });
      emitted.current.add(doc);
      onChangeRef.current(doc);
    },
  });

  // ARIA of the editable region: it follows the label, description and error.
  useEffect(() => {
    if (!editor) return;
    const attributes: Record<string, string> = {
      id,
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-labelledby': labelId,
      class: CONTENT_CLASSES,
    };
    const describedBy = [descriptionId, errorId].filter(Boolean).join(' ');
    if (describedBy) attributes['aria-describedby'] = describedBy;
    if (error) attributes['aria-invalid'] = 'true';
    editor.setOptions({ editorProps: { attributes } });
  }, [editor, id, labelId, descriptionId, errorId, error]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  // A value from outside (the lesson's content arriving, a reload after a conflict) replaces the
  // document; the editor's own changes coming back through `value` (even late, while typing
  // fast) do not.
  useEffect(() => {
    if (images) Object.assign(urls.current, images.urls);
    if (!editor || (value && emitted.current.has(value))) return;
    editor.commands.setContent(value ?? EMPTY_DOC, { emitUpdate: false });
  }, [editor, value, images]);

  useEffect(() => {
    const created = previews.current;
    return () => created.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      <div id={labelId} className="font-medium text-fg">
        {label}
      </div>
      {description ? (
        <p id={descriptionId} className="text-sm text-fg-muted">
          {description}
        </p>
      ) : null}
      <div
        className={`overflow-hidden rounded-md border bg-surface focus-within:ring-2 focus-within:ring-primary ${
          error ? 'border-danger' : 'border-border'
        }`}
      >
        {editor ? (
          <Toolbar
            editor={editor}
            controls={id}
            disabled={disabled}
            onLink={() => setPanel((p) => (p === 'link' ? null : 'link'))}
            onImage={
              allowImage ? () => setPanel((p) => (p === 'image' ? null : 'image')) : undefined
            }
          />
        ) : null}
        {editor && panel === 'link' ? (
          <LinkPanel
            initial={(editor.getAttributes('link').href as string | undefined) ?? ''}
            active={editor.isActive('link')}
            onApply={(href) => {
              const chain = editor.chain().focus().extendMarkRange('link');
              if (editor.state.selection.empty && !editor.isActive('link')) {
                chain
                  .insertContent({
                    type: 'text',
                    text: href,
                    marks: [{ type: 'link', attrs: { href } }],
                  })
                  .run();
              } else {
                chain.setLink({ href }).run();
              }
              setPanel(null);
            }}
            onRemove={() => {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
              setPanel(null);
            }}
            onCancel={() => {
              setPanel(null);
              editor.commands.focus();
            }}
          />
        ) : null}
        {editor && images && panel === 'image' ? (
          <ImagePanel
            upload={images.upload}
            onInserted={(mediaId, alt, file) => {
              const preview = URL.createObjectURL(file);
              previews.current.push(preview);
              urls.current[mediaId] = preview;
              editor
                .chain()
                .focus()
                .insertMediaImage(alt ? { mediaId, alt } : { mediaId })
                .run();
              setPanel(null);
            }}
            onCancel={() => {
              setPanel(null);
              editor.commands.focus();
            }}
          />
        ) : null}
        <EditorContent editor={editor} />
      </div>
      {error ? (
        <p role="alert" id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Enter in a panel's field runs its action instead of submitting the surrounding form. */
const onEnter = (run: () => void) => (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    run();
  }
};

function LinkPanel({
  initial,
  active,
  onApply,
  onRemove,
  onCancel,
}: {
  initial: string;
  active: boolean;
  onApply: (href: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const inputId = useId();
  const [href, setHref] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const apply = () => {
    const value = href.trim();
    if (!isAllowedHref(value)) {
      setInvalid(true);
      return;
    }
    onApply(value);
  };
  return (
    <div className="flex flex-col gap-2 border-b border-border p-2">
      <label htmlFor={inputId} className="text-sm font-medium text-fg">
        {t('editor.linkUrl')}
      </label>
      <Input
        id={inputId}
        type="url"
        dir="ltr"
        inputMode="url"
        autoFocus
        maxLength={RICH_TEXT_LIMITS.hrefMax}
        value={href}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${inputId}-error` : undefined}
        onChange={(e) => {
          setHref(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={onEnter(apply)}
        placeholder="https://"
      />
      {invalid ? (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-danger">
          {t('editor.linkInvalid')}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        {active ? (
          <Button type="button" variant="secondary" size="sm" onClick={onRemove}>
            {t('editor.linkRemove')}
          </Button>
        ) : null}
        <Button type="button" variant="primary" size="sm" onClick={apply}>
          {t('editor.linkApply')}
        </Button>
      </div>
    </div>
  );
}

function ImagePanel({
  upload,
  onInserted,
  onCancel,
}: {
  upload: RichTextImages['upload'];
  onInserted: (mediaId: string, alt: string, file: File) => void;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const fileId = useId();
  const altId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const insert = async () => {
    if (!file || busy) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setFailed(false);
    try {
      const asset = await upload(file, abort.signal);
      onInserted(asset.id, alt.trim(), file);
    } catch {
      if (!abort.signal.aborted) setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b border-border p-2">
      <label htmlFor={fileId} className="text-sm font-medium text-fg">
        {t('editor.imageFile')}
      </label>
      <p className="text-sm text-fg-muted">{t('editor.imageHint')}</p>
      <input
        id={fileId}
        type="file"
        accept={MEDIA_MIME_TYPES.IMAGE.join(',')}
        disabled={busy}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-fg file:me-3 file:rounded-md file:border-0 file:bg-bg-subtle file:px-3 file:py-2 file:text-fg"
      />
      <label htmlFor={altId} className="text-sm font-medium text-fg">
        {t('editor.imageAlt')}
      </label>
      <Input
        id={altId}
        value={alt}
        maxLength={RICH_TEXT_LIMITS.altMax}
        disabled={busy}
        aria-describedby={`${altId}-hint`}
        onChange={(e) => setAlt(e.target.value)}
        onKeyDown={onEnter(() => void insert())}
      />
      <p id={`${altId}-hint`} className="text-sm text-fg-muted">
        {t('editor.imageAltHint')}
      </p>
      <p aria-live="polite" className="text-sm text-fg-muted">
        {busy ? t('editor.imageUploading') : ''}
      </p>
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {t('editor.imageFailed')}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={busy}
          disabled={!file}
          onClick={() => void insert()}
        >
          {t('editor.imageInsert')}
        </Button>
      </div>
    </div>
  );
}
