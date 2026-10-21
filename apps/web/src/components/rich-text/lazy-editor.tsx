'use client';

import { Skeleton } from '@nibras/ui';
import { lazy, Suspense } from 'react';
import type { RichTextEditorProps } from './editor';

/** Tiptap and ProseMirror are fetched when a form shows the editor (PRD §14.1 budget). */
const RichTextEditor = lazy(() => import('./editor').then((m) => ({ default: m.RichTextEditor })));

/**
 * `RichTextEditor` loaded on demand (React.lazy): while its chunk loads, the label and a
 * placeholder of the editor's height keep the form's layout.
 */
export function LazyRichTextEditor(props: RichTextEditorProps) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-1.5">
          <div className="font-medium text-fg">{props.label}</div>
          <Skeleton className="h-52 w-full" />
        </div>
      }
    >
      <RichTextEditor {...props} />
    </Suspense>
  );
}
