import type { RichTextDoc } from '@nibras/contracts';
import { RichText } from '../rich-text/renderer';

/**
 * A text lesson's body: the rich-text document rendered as React elements, inline images through
 * the lesson's 5-minute URL map. Rendered by the server page and handed to `LessonShell` as its
 * child, so the renderer adds nothing to the route's client JS (PRD §14.1).
 */
export function LessonText({
  content,
  images,
}: {
  content: RichTextDoc | null;
  images: Record<string, string>;
}) {
  return (
    <article className="rounded-md border border-border bg-surface p-4 sm:p-6">
      <RichText doc={content} images={images} />
    </article>
  );
}
