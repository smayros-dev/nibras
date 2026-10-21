'use client';

import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { Alert, Button, Spinner, useSubmit } from '@nibras/ui';
import { Download, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PlaybackSession } from './playback-session';
import { Watermark } from './watermark';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

export interface PdfViewerProps {
  session: PlaybackSession;
  title: string;
  watermarkText: string;
  allowDownload: boolean;
  /** « Télécharger »: fetches the 5-min `attachment` URL and navigates to it. */
  onDownload: () => Promise<void>;
  /** After the first page is drawn. */
  onOpened?: () => void;
}

/** The inline PDF, renewing the 5-min URL once when the store refuses it (AC-MED-06). */
async function loadBytes(session: { current: PlaybackSession }): Promise<Uint8Array> {
  const url = session.current.grant?.url;
  if (!url) throw new Error('no grant');
  let response = await fetch(url, { credentials: 'omit' });
  if (response.status === 401 || response.status === 403) {
    const renewed = await session.current.refresh();
    if (!renewed) throw new Error('refused');
    response = await fetch(renewed.url, { credentials: 'omit' });
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * The PDF viewer (PRD §8.6, D-O8): pdf.js is imported on mount only, with its worker bundled under
 * `_next/static` (same origin: `worker-src 'self'`, never a CDN). The bytes are fetched from the
 * inline URL (CORS from the object store) and handed to pdf.js; pages are drawn to canvases as
 * they scroll into view. Zoom, a page field and, when the lesson allows it, « Télécharger ». The
 * watermark sits over the scrolling frame.
 */
export function PdfViewer({
  session,
  title,
  watermarkText,
  allowDownload,
  onDownload,
  onOpened,
}: PdfViewerProps) {
  const t = useTranslations();
  const pageId = useId();
  const sessionRef = useRef(session);
  const openedRef = useRef(onOpened);
  useEffect(() => {
    sessionRef.current = session;
    openedRef.current = onOpened;
  });
  const frameRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);
  const [page, setPage] = useState('1');
  const opened = useRef(false);
  const download = useSubmit(onDownload);
  const hasGrant = session.grant !== null;
  const onRendered = useCallback(() => {
    if (opened.current) return;
    opened.current = true;
    openedRef.current?.();
  }, []);

  useEffect(() => {
    if (!hasGrant) return;
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    (async () => {
      const data = await loadBytes(sessionRef);
      const pdfjs = await import('pdfjs-dist');
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
      }
      if (cancelled) return;
      task = pdfjs.getDocument({ data });
      const loaded = await task.promise;
      if (!cancelled) setDoc(loaded);
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      // Ends the document and its worker.
      void task?.destroy();
    };
  }, [hasGrant]);

  if (session.status === 'revoked') return <Alert variant="danger">{t('learn.revoked')}</Alert>;
  if (failed || session.status === 'error') {
    return <Alert variant="danger">{t('learn.media.error')}</Alert>;
  }

  const pages = doc?.numPages ?? 0;
  const goTo = (value: string) => {
    setPage(value);
    const n = Number(value);
    if (Number.isInteger(n) && n >= 1 && n <= pages) {
      frameRef.current?.querySelector(`[data-page="${n}"]`)?.scrollIntoView({ block: 'start' });
    }
  };

  return (
    <section
      aria-label={t('learn.media.document', { title })}
      className="flex flex-col gap-2 rounded-md border border-border bg-surface p-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={pageId} className="text-sm">
          {t('learn.media.page')}
        </label>
        <input
          id={pageId}
          type="number"
          inputMode="numeric"
          min={1}
          max={Math.max(pages, 1)}
          value={page}
          onChange={(e) => goTo(e.currentTarget.value)}
          className="h-11 w-16 rounded-md border border-border bg-surface px-2 text-sm"
        />
        <span className="text-sm text-fg-muted">{t('learn.media.pageOf', { total: pages })}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('learn.media.zoomOut')}
          disabled={scale <= ZOOM_MIN}
          onClick={() => setScale((s) => Math.max(ZOOM_MIN, s - ZOOM_STEP))}
        >
          <ZoomOut aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('learn.media.zoomIn')}
          disabled={scale >= ZOOM_MAX}
          onClick={() => setScale((s) => Math.min(ZOOM_MAX, s + ZOOM_STEP))}
        >
          <ZoomIn aria-hidden="true" />
        </Button>
        {allowDownload ? (
          <Button
            variant="secondary"
            className="ms-auto"
            loading={download.busy}
            iconStart={<Download aria-hidden="true" />}
            onClick={() => void download.submit()}
          >
            {t('learn.media.download')}
          </Button>
        ) : null}
      </div>
      <div className="relative overflow-hidden rounded-md">
        <div
          ref={frameRef}
          // Scrollable by keyboard.
          tabIndex={0}
          aria-label={t('learn.media.pages')}
          role="group"
          className="flex max-h-[80vh] flex-col items-center gap-3 overflow-auto bg-bg-subtle p-2 focus-visible:outline-2 focus-visible:outline-focus"
        >
          {doc ? (
            Array.from({ length: pages }, (_, i) => (
              <PdfPage key={i + 1} doc={doc} number={i + 1} scale={scale} onRendered={onRendered} />
            ))
          ) : (
            <div className="flex min-h-64 items-center justify-center">
              <Spinner label={t('learn.media.loading')} />
            </div>
          )}
        </div>
        <Watermark text={watermarkText} />
      </div>
    </section>
  );
}

/** One page: drawn when it nears the viewport, redrawn on zoom; width fits the frame at 100 %. */
function PdfPage({
  doc,
  number,
  scale,
  onRendered,
}: {
  doc: PDFDocumentProxy;
  number: number;
  scale: number;
  onRendered: () => void;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const holder = holderRef.current;
    if (near || !holder) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(holder);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    doc
      .getPage(number)
      .then((pdfPage) => {
        const canvas = canvasRef.current;
        const holder = holderRef.current;
        if (cancelled || !canvas || !holder) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const frame = holder.parentElement?.clientWidth ?? 0;
        const fit = frame > 0 ? Math.min(frame - 16, 900) / base.width : 1;
        const cssWidth = base.width * fit * scale;
        const ratio = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: fit * scale * ratio });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(cssWidth)}px`;
        task = pdfPage.render({ canvas, viewport });
        return task.promise.then(() => {
          if (!cancelled) onRendered();
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, number, scale, near, onRendered]);

  return (
    <div
      ref={holderRef}
      data-page={number}
      data-testid="pdf-page"
      className="min-h-32 max-w-full shrink-0 bg-white shadow-sm"
    >
      <canvas ref={canvasRef} className="block h-auto max-w-none" />
    </div>
  );
}
