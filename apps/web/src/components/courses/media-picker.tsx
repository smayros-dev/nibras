'use client';

import type { MediaAssetView, MediaPage } from '@nibras/contracts';
import { Button, Field, Select } from '@nibras/ui';
import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { lazy, Suspense, useEffect, useState } from 'react';
import { api, asApiResult } from '../../lib/api';
import type { LessonMediaKind } from './upload-dialog';

/** The upload dialog and its engine are fetched on the first « Envoyer un fichier ». */
const UploadDialog = lazy(() =>
  import('./upload-dialog').then((m) => ({ default: m.UploadDialog })),
);

/**
 * The media of a VIDEO / PDF lesson: a workspace asset of that kind that is `READY` or still
 * `PROCESSING` (a lesson may point to one being processed, PRD §8.4.4), or « Envoyer un fichier »
 * for a new one, selected once its upload completes.
 */
export function MediaPicker({
  wid,
  kind,
  value,
  onChange,
  error,
}: {
  wid: string;
  kind: LessonMediaKind;
  value: string | null;
  onChange: (mediaId: string) => void;
  error?: string;
}) {
  const t = useTranslations();
  const [items, setItems] = useState<MediaAssetView[]>([]);
  const [uploadOpen, setUploadOpen] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { data } = asApiResult<MediaPage>(
          await api.GET('/workspaces/{wid}/media', {
            params: { path: { wid }, query: { kind, limit: 100 } },
            signal: controller.signal,
          }),
        );
        if (data) {
          setItems(data.items.filter((a) => a.status === 'READY' || a.status === 'PROCESSING'));
        }
      } catch {
        // The picker stays empty; uploading a file still works.
      }
    })();
    return () => controller.abort();
  }, [wid, kind]);

  const known = value === null || items.some((a) => a.id === value);

  return (
    <div className="flex flex-col gap-2">
      <Field htmlFor="lesson-media" label={t('structure.fieldMedia')} error={error} required>
        <Select
          id="lesson-media"
          name="mediaAssetId"
          value={value ?? ''}
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value);
          }}
        >
          <option value="">
            {items.length === 0 ? t('structure.mediaNone') : t('structure.mediaPick')}
          </option>
          {!known && value ? <option value={value}>{value}</option> : null}
          {items.map((a) => (
            <option key={a.id} value={a.id}>
              {`${a.originalFilename} — ${t(`upload.status_${a.status}`)}`}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <Button variant="secondary" size="sm" onClick={() => setUploadOpen(true)}>
          <Upload aria-hidden="true" className="size-4" />
          {t('structure.uploadFile')}
        </Button>
      </div>
      {uploadOpen !== null ? (
        <Suspense fallback={null}>
          <UploadDialog
            wid={wid}
            kind={kind}
            open={uploadOpen}
            onOpenChange={setUploadOpen}
            onUploaded={(asset) => {
              setItems((list) => [asset, ...list.filter((a) => a.id !== asset.id)]);
              onChange(asset.id);
              setUploadOpen(false);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
