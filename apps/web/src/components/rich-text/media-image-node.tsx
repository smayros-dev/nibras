import { mergeAttributes, Node } from '@tiptap/core';

export interface MediaImageOptions {
  /**
   * `mediaId` → displayable URL (the lesson's presigned URLs, or a local preview after upload). A
   * function: `configure` deep-copies plain objects, which would freeze a map.
   */
  resolveUrl: (mediaId: string) => string | undefined;
  /** Placeholder text of an image whose URL is not known. */
  unavailableLabel: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mediaImage: {
      /** Inserts an inline image of the workspace's media (`mediaId`, never a URL). */
      insertMediaImage: (attrs: { mediaId: string; alt?: string }) => ReturnType;
    };
  }
}

/**
 * The `image` node of the rich-text whitelist: an atom block holding a `mediaId` and an `alt`,
 * never a URL (the API signs one per read). Pasted HTML images without `data-media-id` are not
 * parsed, so no foreign URL can enter a document. The editor shows the image through a plain DOM
 * node view resolving the id through `resolveUrl`.
 */
export const MediaImageNode = Node.create<MediaImageOptions>({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { resolveUrl: () => undefined, unavailableLabel: '' };
  },

  addAttributes() {
    return {
      mediaId: { default: null },
      alt: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[data-media-id]',
        getAttrs: (el) => ({
          mediaId: el.getAttribute('data-media-id'),
          alt: el.getAttribute('alt') ?? '',
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { mediaId, alt } = HTMLAttributes as { mediaId?: string; alt?: string };
    return ['img', mergeAttributes({ 'data-media-id': mediaId, alt: alt ?? '' })];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('figure');
      dom.className = 'my-2';
      const mediaId = String(node.attrs.mediaId ?? '');
      const alt = String(node.attrs.alt ?? '');
      const src = this.options.resolveUrl(mediaId);
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = alt;
        img.referrerPolicy = 'no-referrer';
        img.className = 'h-auto max-w-full rounded-md';
        dom.append(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.setAttribute('role', 'img');
        placeholder.setAttribute('aria-label', alt || this.options.unavailableLabel);
        placeholder.className =
          'rounded-md border border-dashed border-border p-4 text-center text-sm text-fg-muted';
        placeholder.textContent = this.options.unavailableLabel;
        dom.append(placeholder);
      }
      return { dom };
    };
  },

  addCommands() {
    return {
      insertMediaImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
