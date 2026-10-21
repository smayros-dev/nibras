import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MediaAssetView } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../../test/render';
import { UploadDialog } from './upload-dialog';

const engine = vi.hoisted(() => {
  class UploadError extends Error {
    constructor(
      readonly code: string,
      readonly body: { code: string; details?: Record<string, unknown> } | null = null,
    ) {
      super(code);
    }
  }
  return {
    UploadError,
    startUpload: vi.fn(),
    resumeUpload: vi.fn(),
    cancelUpload: vi.fn(),
    findResumable: vi.fn(),
  };
});
vi.mock('../../lib/upload/engine', () => engine);

const asset = { id: 'a1', kind: 'PDF', status: 'PROCESSING' } as MediaAssetView;
const pdf = () =>
  new File(['%PDF-1.7 hello'], 'cours.pdf', { type: 'application/pdf', lastModified: 1 });
const onUploaded = vi.fn();

beforeEach(() => {
  engine.startUpload.mockReset();
  engine.resumeUpload.mockReset();
  engine.cancelUpload.mockReset();
  engine.findResumable.mockReset().mockReturnValue(null);
  onUploaded.mockReset();
});

function renderDialog(locale: 'fr' | 'ar' = 'fr') {
  renderWithIntl(
    <UploadDialog wid="w1" kind="PDF" open onOpenChange={() => {}} onUploaded={onUploaded} />,
    { locale },
  );
}

async function pick(ue: ReturnType<typeof userEvent.setup>, file: File = pdf()) {
  await ue.upload(screen.getByLabelText(tr('fr', 'upload.fieldFile')), file);
}

describe('UploadDialog', () => {
  it('shows the progress and hands the asset over when the upload completes', async () => {
    let finish: (a: MediaAssetView) => void = () => {};
    engine.startUpload.mockImplementation(
      (input: { onProgress: (sent: number, total: number) => void }) =>
        new Promise<MediaAssetView>((resolve) => {
          input.onProgress(7, 14);
          finish = resolve;
        }),
    );
    renderDialog();
    const ue = userEvent.setup();
    await pick(ue);
    await ue.click(screen.getByRole('button', { name: tr('fr', 'upload.start') }));
    const bar = await screen.findByRole('progressbar', { name: tr('fr', 'upload.progress') });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(engine.startUpload).toHaveBeenCalledWith(
      expect.objectContaining({ wid: 'w1', kind: 'PDF', file: expect.any(File) }),
    );
    finish(asset);
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(asset));
  });

  it('explains a 402 with the workspace usage', async () => {
    engine.startUpload.mockRejectedValue(
      new engine.UploadError('QUOTA_EXCEEDED', {
        code: 'QUOTA_EXCEEDED',
        details: {
          usedBytes: String(1024 ** 3),
          reservedBytes: '0',
          quotaBytes: String(2 * 1024 ** 3),
          requestedBytes: String(1024 ** 3 + 1),
        },
      }),
    );
    renderDialog();
    const ue = userEvent.setup();
    await pick(ue);
    await ue.click(screen.getByRole('button', { name: tr('fr', 'upload.start') }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('1.0 GB');
    expect(alert).toHaveTextContent('2.0 GB');
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('explains a 415 with the detected type', async () => {
    engine.startUpload.mockRejectedValue(
      new engine.UploadError('INVALID_FILE_SIGNATURE', {
        code: 'INVALID_FILE_SIGNATURE',
        details: { detected: 'application/x-msdownload', kind: 'PDF' },
      }),
    );
    renderDialog();
    const ue = userEvent.setup();
    await pick(ue);
    await ue.click(screen.getByRole('button', { name: tr('fr', 'upload.start') }));
    expect(await screen.findByRole('alert')).toHaveTextContent('application/x-msdownload');
  });

  it('offers « Reprendre l’envoi » when an interrupted upload of the same file is stored', async () => {
    const record = {
      mediaId: 'a1',
      wid: 'w1',
      kind: 'PDF',
      fileName: 'cours.pdf',
      size: 14,
      lastModified: 1,
      done: [1],
      partCount: 2,
    };
    engine.findResumable.mockReturnValue(record);
    engine.resumeUpload.mockResolvedValue(asset);
    renderDialog('ar');
    const ue = userEvent.setup();
    await ue.upload(screen.getByLabelText(tr('ar', 'upload.fieldFile')), pdf());
    expect(
      await screen.findByText(tr('ar', 'upload.resumable').replace('{percent}', '50')),
    ).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: tr('ar', 'upload.resume') }));
    await waitFor(() =>
      expect(engine.resumeUpload).toHaveBeenCalledWith(
        expect.objectContaining({ wid: 'w1', record, file: expect.any(File) }),
      ),
    );
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(asset));
    expect(engine.startUpload).not.toHaveBeenCalled();
  });
});
