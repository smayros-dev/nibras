import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Playback } from '@nibras/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../../test/render';
import type { PlaybackSession } from './playback-session';
import { PdfViewer, type PdfViewerProps } from './pdf-viewer';

const pdfjs = vi.hoisted(() => {
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render,
    cleanup: vi.fn(),
  };
  const doc = { numPages: 3, getPage: vi.fn(async () => page), destroy: vi.fn() };
  const getDocument = vi.fn(() => ({ promise: Promise.resolve(doc), destroy: vi.fn() }));
  return { GlobalWorkerOptions: { workerSrc: '' }, getDocument, render, doc };
});
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: pdfjs.GlobalWorkerOptions,
  getDocument: pdfjs.getDocument,
}));

const GRANT: Extract<Playback, { kind: 'PDF' }> = {
  kind: 'PDF',
  url: 'http://localhost:9000/doc.pdf?sig=1',
  expiresAt: '2026-10-21T08:05:00.000Z',
  allowDownload: false,
};

function session(extra: Partial<PlaybackSession> = {}): PlaybackSession {
  return {
    grant: GRANT,
    status: 'ready',
    refresh: vi.fn(async () => ({ ...GRANT, url: 'http://localhost:9000/doc.pdf?sig=2' })),
    onProviderError: vi.fn(),
    onPlaybackOk: vi.fn(),
    ...extra,
  };
}

const fetchMock = vi.fn();

function renderViewer(props: Partial<PdfViewerProps> = {}) {
  return renderWithIntl(
    <PdfViewer
      session={session()}
      title="Fiche"
      watermarkText="lina@example.tn"
      allowDownload={false}
      onDownload={vi.fn(async () => undefined)}
      {...props}
    />,
  );
}

const ok = () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 });

beforeEach(() => {
  fetchMock.mockReset();
  pdfjs.getDocument.mockClear();
  pdfjs.render.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PdfViewer', () => {
  it('serves the pdf.js worker from our origin and renders the pages', async () => {
    fetchMock.mockImplementation(async () => ok());
    const onOpened = vi.fn();
    renderViewer({ onOpened });
    await waitFor(() => expect(onOpened).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(GRANT.url, expect.anything());
    expect(pdfjs.GlobalWorkerOptions.workerSrc).not.toMatch(/^https?:\/\/(?!localhost)/);
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toContain('pdf.worker');
    expect(screen.getAllByTestId('pdf-page')).toHaveLength(3);
    expect(pdfjs.render).toHaveBeenCalled();
    expect(screen.getByTestId('watermark')).toHaveTextContent('lina@example.tn');
  });

  it('a 403 on the inline URL renews the grant silently and retries once', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 })).mockResolvedValueOnce(ok());
    const s = session();
    renderViewer({ session: s });
    await waitFor(() => expect(screen.getAllByTestId('pdf-page')).toHaveLength(3));
    expect(s.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:9000/doc.pdf?sig=2',
      expect.anything(),
    );
  });

  it('a second refusal shows an error instead of looping', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 403 }));
    const s = session();
    renderViewer({ session: s });
    expect(await screen.findByText(tr('fr', 'learn.media.error'))).toBeInTheDocument();
    expect(s.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('offers the download only when allowed', async () => {
    fetchMock.mockImplementation(async () => ok());
    const { unmount } = renderViewer();
    await waitFor(() => expect(screen.getAllByTestId('pdf-page')).toHaveLength(3));
    expect(
      screen.queryByRole('button', { name: tr('fr', 'learn.media.download') }),
    ).not.toBeInTheDocument();
    unmount();

    const onDownload = vi.fn(async () => undefined);
    renderViewer({ allowDownload: true, onDownload });
    await userEvent.click(
      await screen.findByRole('button', { name: tr('fr', 'learn.media.download') }),
    );
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('zooms and jumps to a page with labelled controls', async () => {
    fetchMock.mockImplementation(async () => ok());
    renderViewer();
    await waitFor(() => expect(screen.getAllByTestId('pdf-page')).toHaveLength(3));
    const before = pdfjs.render.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: tr('fr', 'learn.media.zoomIn') }));
    await waitFor(() => expect(pdfjs.render.mock.calls.length).toBeGreaterThan(before));
    const input = screen.getByRole('spinbutton', { name: tr('fr', 'learn.media.page') });
    expect(input).toHaveAttribute('max', '3');
  });
});
