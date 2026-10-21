'use client';

import { useDirection } from '@nibras/ui';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent } from 'react';

interface Item {
  key: string;
  icon: LucideIcon;
  /** `aria-pressed` for a toggle; absent for an action. */
  active?: boolean;
  disabled?: boolean;
  run: () => void;
  /** Starts a new visual group (a separator before it). */
  group?: boolean;
}

/**
 * The editor's formatting toolbar (WAI-ARIA toolbar pattern): one tab stop, the arrow keys move
 * between buttons in reading order (mirrored in RTL), Home/End jump to the ends; toggles carry
 * `aria-pressed`, every button a translated `aria-label` and the same text as a tooltip.
 */
export function Toolbar({
  editor,
  controls,
  disabled,
  onLink,
  onImage,
}: {
  editor: Editor;
  /** Id of the editable region the toolbar formats. */
  controls: string;
  disabled?: boolean;
  onLink: () => void;
  /** Absent: no image button (a course description has no images). */
  onImage?: () => void;
}) {
  const t = useTranslations('editor');
  const dir = useDirection();
  const [focusIndex, setFocusIndex] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();

  const items: Item[] = [
    { key: 'bold', icon: Bold, active: state.bold, run: () => chain().toggleBold().run() },
    { key: 'italic', icon: Italic, active: state.italic, run: () => chain().toggleItalic().run() },
    {
      key: 'underline',
      icon: Underline,
      active: state.underline,
      run: () => chain().toggleUnderline().run(),
    },
    {
      key: 'strike',
      icon: Strikethrough,
      active: state.strike,
      run: () => chain().toggleStrike().run(),
    },
    { key: 'code', icon: Code, active: state.code, run: () => chain().toggleCode().run() },
    {
      key: 'heading1',
      icon: Heading1,
      active: state.h1,
      group: true,
      run: () => chain().toggleHeading({ level: 1 }).run(),
    },
    {
      key: 'heading2',
      icon: Heading2,
      active: state.h2,
      run: () => chain().toggleHeading({ level: 2 }).run(),
    },
    {
      key: 'heading3',
      icon: Heading3,
      active: state.h3,
      run: () => chain().toggleHeading({ level: 3 }).run(),
    },
    {
      key: 'bulletList',
      icon: List,
      active: state.bulletList,
      group: true,
      run: () => chain().toggleBulletList().run(),
    },
    {
      key: 'orderedList',
      icon: ListOrdered,
      active: state.orderedList,
      run: () => chain().toggleOrderedList().run(),
    },
    {
      key: 'blockquote',
      icon: Quote,
      active: state.blockquote,
      run: () => chain().toggleBlockquote().run(),
    },
    {
      key: 'codeBlock',
      icon: SquareCode,
      active: state.codeBlock,
      run: () => chain().toggleCodeBlock().run(),
    },
    {
      key: 'horizontalRule',
      icon: Minus,
      run: () => chain().setHorizontalRule().run(),
    },
    { key: 'link', icon: Link, active: state.link, group: true, run: onLink },
    ...(onImage ? [{ key: 'image', icon: Image, run: onImage }] : []),
    {
      key: 'undo',
      icon: Undo2,
      group: true,
      disabled: !state.canUndo,
      run: () => chain().undo().run(),
    },
    { key: 'redo', icon: Redo2, disabled: !state.canRedo, run: () => chain().redo().run() },
  ];

  const move = (to: number) => {
    const next = (to + items.length) % items.length;
    setFocusIndex(next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    const keys: Record<string, () => void> = {
      [forward]: () => move(focusIndex + 1),
      [backward]: () => move(focusIndex - 1),
      Home: () => move(0),
      End: () => move(items.length - 1),
    };
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };

  return (
    <div
      role="toolbar"
      aria-label={t('toolbar')}
      aria-controls={controls}
      onKeyDown={onKeyDown}
      className="flex flex-wrap items-center gap-0.5 border-b border-border bg-bg-subtle p-1"
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <span key={item.key} className="flex items-center">
            {item.group ? <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" /> : null}
            <button
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              tabIndex={i === focusIndex ? 0 : -1}
              aria-label={t(item.key)}
              title={t(item.key)}
              aria-pressed={item.active === undefined ? undefined : item.active}
              // Focusable while unavailable (toolbar pattern): `aria-disabled`, not `disabled`.
              aria-disabled={disabled || item.disabled ? true : undefined}
              onFocus={() => setFocusIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!disabled && !item.disabled) item.run();
              }}
              className="inline-flex size-9 items-center justify-center rounded-md text-fg hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary aria-disabled:opacity-40 aria-pressed:bg-surface aria-pressed:text-primary"
            >
              <Icon aria-hidden="true" className="size-4" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
