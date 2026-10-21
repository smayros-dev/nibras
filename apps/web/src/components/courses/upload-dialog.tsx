'use client';

import type { MediaAssetView } from '@nibras/contracts';
import { MEDIA_MIME_TYPES } from '@nibras/contracts/web';
import { Alert, Button, Dialog, Field } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { issuesToFieldErrors, apiErrorMessage } from '../../lib/api-error';
import { formatBytes } from '../../lib/format-bytes';
import {
  cancelUpload,
  findResumable,
  resumeUpload,
  startUpload,
  type ResumeRecord,
} from '../../lib/upload/engine';

/** Re-exported for the rich-text editor's inline images, which load this chunk on demand. */
export { startUpload };

export type LessonMediaKind = 'VIDEO' | 'PDF';

type Phase = 'idle' | 'uploading' | 'paused' | 'finishing' | 'error';

interface ErrorLike {
  code?: string;
  body?: { code?: string; details?: Record<string, unknown> } | null;
}

/** BigInt-safe sum of decimal strings (the API sends byte counts as strings). */
function addBytes(...values: unknown[]): string {
  try {
    return values.reduce<bigint>((sum, v) => sum + BigInt(String(v ?? '0')), 0n).toString();
  } catch {
    return String(values[0] ?? '0');
  }
}

/**
 * « Envoyer un fichier » (PRD §8.4.4, spec D1; AC-MED-01): a file input restricted to the kind's
 * types, a progress bar (`role="progressbar"`), Pause / Annuler, and « Reprendre l'envoi » when an
 * interrupted upload of the same file (name + size + date) is stored in this browser — the parts
 * already stored are not sent again. A quota refusal (`402`) shows the workspace's usage, a
 * signature refusal (`415`/`422`) the detected type. Loaded on demand (React.lazy).
 */
export function UploadDialog({
  wid,
  kind,
  open,
  onOpenChange,
  onUploaded,
  onCloseAutoFocus,
}: {
  wid: string;
  kind: LessonMediaKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (asset: MediaAssetView) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations();
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [resumable, setResumable] = useState<ResumeRecord | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mediaId = useRef<string | null>(null);

  // Closing the dialog (or unmounting) stops the transfer; the stored state allows a resume.
  useEffect(() => () => controller.current?.abort(), []);

  const busy = phase === 'uploading' || phase === 'finishing';

  const describe = (err: unknown): string => {
    const e = err as ErrorLike;
    const code = e?.code ?? e?.body?.code;
    const details = e?.body?.details ?? {};
    if (code === 'QUOTA_EXCEEDED') {
      return t('upload.quota', {
        used: formatBytes(addBytes(details.usedBytes, details.reservedBytes)),
        quota: formatBytes(String(details.quotaBytes ?? '0')),
        requested: formatBytes(String(details.requestedBytes ?? file?.size ?? 0)),
      });
    }
    if (code === 'INVALID_FILE_SIGNATURE' || code === 'MEDIA_KIND_MISMATCH') {
      const detected = typeof details.detected === 'string' ? details.detected : null;
      return t('upload.signature', { detected: detected ?? t('upload.unknownType') });
    }
    if (code === 'CORS_ETAG') return t('upload.corsEtag');
    if (code === 'NETWORK') return t('upload.failed');
    if (code === 'VALIDATION_FAILED') {
      const messages = Object.values(issuesToFieldErrors(t, e.body));
      if (messages.length > 0) return messages.join(' ');
    }
    return apiErrorMessage(t, e?.body ?? null);
  };

  const run = async (record: ResumeRecord | null) => {
    if (!file) return;
    const abort = new AbortController();
    controller.current = abort;
    setError(null);
    setPhase('uploading');
    setPercent(record ? Math.round((record.done.length / Math.max(1, record.partCount)) * 100) : 0);
    const callbacks = {
      wid,
      kind,
      file,
      signal: abort.signal,
      onProgress: (sent: number, total: number) =>
        setPercent(total > 0 ? Math.floor((sent / total) * 100) : 0),
      onStarted: (id: string) => {
        mediaId.current = id;
      },
      onFinishing: () => setPhase('finishing'),
    };
    try {
      const asset = record
        ? await resumeUpload({ ...callbacks, record })
        : await startUpload(callbacks);
      setResumable(null);
      setPhase('idle');
      onUploaded(asset);
    } catch (err) {
      if (abort.signal.aborted || (err as ErrorLike)?.code === 'ABORTED') return;
      setError(describe(err));
      // A transfer failure can be resumed; a refusal by the API cannot.
      const code = (err as ErrorLike)?.code;
      const again = code === 'NETWORK' ? findResumable(file, { wid, kind }) : null;
      setResumable(again);
      setPhase(again ? 'paused' : 'error');
    }
  };

  const pause = () => {
    controller.current?.abort();
    setResumable(file ? findResumable(file, { wid, kind }) : null);
    setPhase('paused');
  };

  const cancel = () => {
    controller.current?.abort();
    if (mediaId.current) void cancelUpload({ wid, mediaId: mediaId.current });
    mediaId.current = null;
    setResumable(null);
    setPhase('idle');
    setPercent(0);
    onOpenChange(false);
  };

  const restart = () => {
    if (resumable) void cancelUpload({ wid, mediaId: resumable.mediaId });
    setResumable(null);
    void run(null);
  };

  const pick = (picked: File | null) => {
    setFile(picked);
    setError(null);
    setPhase('idle');
    setPercent(0);
    setResumable(picked ? findResumable(picked, { wid, kind }) : null);
  };

  const showProgress = phase === 'uploading' || phase === 'finishing' || phase === 'paused';

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) controller.current?.abort();
        onOpenChange(next);
      }}
    >
      <Dialog.Content
        title={t(`upload.title_${kind}`)}
        closeLabel={t('common.close')}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <div className="flex flex-col gap-4">
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <Field
            htmlFor={inputId}
            label={t('upload.fieldFile')}
            description={t(`upload.hint_${kind}`)}
          >
            <input
              id={inputId}
              type="file"
              accept={MEDIA_MIME_TYPES[kind].join(',')}
              disabled={busy}
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-fg file:me-3 file:rounded-md file:border-0 file:bg-bg-subtle file:px-3 file:py-2 file:text-fg"
            />
          </Field>
          {resumable && phase !== 'uploading' && phase !== 'finishing' ? (
            <p className="text-sm text-fg-muted">
              {t('upload.resumable', {
                percent: Math.round(
                  (resumable.done.length / Math.max(1, resumable.partCount)) * 100,
                ),
              })}
            </p>
          ) : null}
          {showProgress ? (
            <div className="flex flex-col gap-1">
              <div
                role="progressbar"
                aria-label={t('upload.progress')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-valuetext={t('upload.progressValue', { percent })}
                className="h-2 w-full overflow-hidden rounded-full bg-bg-subtle"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="text-sm text-fg-muted" aria-live="polite">
                {phase === 'finishing'
                  ? t('upload.finishing')
                  : phase === 'paused'
                    ? t('upload.paused')
                    : t('upload.progressValue', { percent })}
              </p>
            </div>
          ) : null}
          <Dialog.Footer>
            {busy ? (
              <>
                <Button variant="secondary" onClick={cancel}>
                  {t('upload.cancel')}
                </Button>
                {phase === 'uploading' ? (
                  <Button variant="secondary" onClick={pause}>
                    {t('upload.pause')}
                  </Button>
                ) : null}
              </>
            ) : resumable ? (
              <>
                <Button variant="secondary" onClick={restart}>
                  {t('upload.restart')}
                </Button>
                <Button variant="primary" onClick={() => void run(resumable)}>
                  {t('upload.resume')}
                </Button>
              </>
            ) : (
              <Button variant="primary" disabled={!file} onClick={() => void run(null)}>
                {t('upload.start')}
              </Button>
            )}
          </Dialog.Footer>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
