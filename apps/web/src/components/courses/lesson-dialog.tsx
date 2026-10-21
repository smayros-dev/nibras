'use client';

import type { LessonDetail, LessonSummary } from '@nibras/contracts';
import { MVP_LESSON_TYPES } from '@nibras/contracts/web';
import { Alert, Button, Dialog, Field, Input, Switch, Textarea, useSubmit } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, asApiResult } from '../../lib/api';
import { apiErrorMessage, issuesToFieldErrors } from '../../lib/api-error';
import {
  docToText,
  textToDoc,
  withIfMatch,
  type CourseWrite,
  type WriteOutcome,
} from '../../lib/courses';
import { useErrorFocus } from '../../lib/use-error-focus';
import { MediaPicker } from './media-picker';

type LessonType = (typeof MVP_LESSON_TYPES)[number];

const FIELDS = ['title', 'mediaAssetId', 'content', 'isRequired', 'allowDownload'];

/**
 * Create or edit a lesson (PRD §8.4.3): the type is picked on create (Vidéo / PDF / Texte) and
 * immutable afterwards; VIDEO and PDF take a workspace media (`MediaPicker`, with upload), PDF
 * also « Autoriser le téléchargement », TEXT a content (a plain `Textarea` stored one paragraph
 * per line until T13's editor). The write goes through the editor's `run`.
 */
export function LessonDialog({
  wid,
  moduleId,
  lesson,
  open,
  onOpenChange,
  run,
  onCloseAutoFocus,
}: {
  wid: string;
  moduleId: string;
  /** `null` creates a lesson at the end of the module. */
  lesson: LessonSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: (write: CourseWrite) => Promise<WriteOutcome>;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        title={t(lesson ? 'structure.lessonEditTitle' : 'structure.lessonCreateTitle')}
        closeLabel={t('common.close')}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <LessonForm
          wid={wid}
          moduleId={moduleId}
          lesson={lesson}
          run={run}
          onDone={() => onOpenChange(false)}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function LessonForm({
  wid,
  moduleId,
  lesson,
  run,
  onDone,
}: {
  wid: string;
  moduleId: string;
  lesson: LessonSummary | null;
  run: (write: CourseWrite) => Promise<WriteOutcome>;
  onDone: () => void;
}) {
  const t = useTranslations();
  const [type, setType] = useState<LessonType>(lesson?.type ?? 'VIDEO');
  const [title, setTitle] = useState(lesson?.title ?? '');
  const [isRequired, setRequired] = useState(lesson?.isRequired ?? true);
  const [mediaId, setMediaId] = useState<string | null>(lesson?.mediaAssetId ?? null);
  // Unset on create: the API applies the workspace's default (`default_pdf_download`).
  const [allowDownload, setAllowDownload] = useState<boolean | undefined>(lesson?.allowDownload);
  const [content, setContent] = useState('');
  const [loadedContent, setLoadedContent] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);

  // Editing a text lesson: its content comes with the lesson's detail.
  const lessonId = lesson?.type === 'TEXT' ? lesson.id : null;
  useEffect(() => {
    if (!lessonId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const { data } = asApiResult<LessonDetail>(
          await api.GET('/workspaces/{wid}/lessons/{lid}', {
            params: { path: { wid, lid: lessonId } },
            signal: controller.signal,
          }),
        );
        if (data) {
          const text = docToText(data.content);
          setContent(text);
          setLoadedContent(text);
        }
      } catch {
        // Left empty: saving without touching the content does not send it.
      }
    })();
    return () => controller.abort();
  }, [wid, lessonId]);

  const submit = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    if (type !== 'TEXT' && !mediaId) {
      setFieldErrors({ mediaAssetId: t('structure.mediaRequired') });
      return;
    }
    let body: Record<string, unknown>;
    if (!lesson) {
      body = { type, title: title.trim(), isRequired };
      if (type === 'TEXT') body.content = textToDoc(content);
      else body.mediaAssetId = mediaId;
      if (type === 'PDF' && allowDownload !== undefined) body.allowDownload = allowDownload;
    } else {
      body = { title: title.trim(), isRequired };
      if (type !== 'TEXT' && mediaId !== lesson.mediaAssetId) body.mediaAssetId = mediaId;
      if (type === 'PDF' && allowDownload !== lesson.allowDownload) {
        body.allowDownload = allowDownload;
      }
      if (type === 'TEXT' && content !== loadedContent) body.content = textToDoc(content);
    }
    const outcome = await run((version) =>
      lesson
        ? api.PATCH('/workspaces/{wid}/lessons/{lid}', {
            params: { path: { wid, lid: lesson.id }, header: withIfMatch(version) },
            // The generated type of the recursive rich-text union is narrower than the contract's.
            body: body as never,
          })
        : api.POST('/workspaces/{wid}/modules/{mid}/lessons', {
            params: { path: { wid, mid: moduleId }, header: withIfMatch(version) },
            body: body as never,
          }),
    );
    if (outcome.ok || outcome.conflict) {
      onDone();
      return;
    }
    const onFields = Object.fromEntries(
      Object.entries(issuesToFieldErrors(t, outcome.error)).filter(([f]) => FIELDS.includes(f)),
    );
    if (Object.keys(onFields).length > 0) setFieldErrors(onFields);
    else setFormError(apiErrorMessage(t, outcome.error ?? null));
  });

  return (
    <form
      method="post"
      ref={formRef}
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit.submit();
      }}
    >
      {formError ? (
        <Alert ref={alertRef} tabIndex={-1} variant="danger">
          {formError}
        </Alert>
      ) : null}
      {lesson ? null : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-fg">{t('structure.fieldType')}</legend>
          <div className="flex flex-wrap gap-2">
            {MVP_LESSON_TYPES.map((value) => (
              <label
                key={value}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 has-[:checked]:border-primary has-[:checked]:bg-bg-subtle"
              >
                <input
                  type="radio"
                  name="type"
                  value={value}
                  checked={type === value}
                  onChange={() => {
                    setType(value);
                    setMediaId(null);
                  }}
                  className="accent-primary"
                />
                <span className="text-fg">{t(`structure.type_${value}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field
        htmlFor="lesson-title"
        label={t('structure.fieldTitle')}
        error={fieldErrors.title}
        required
      >
        <Input
          id="lesson-title"
          name="title"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </Field>
      {type === 'TEXT' ? (
        <Field
          htmlFor="lesson-content"
          label={t('structure.fieldContent')}
          error={fieldErrors.content}
        >
          <Textarea
            id="lesson-content"
            name="content"
            rows={6}
            autoResize
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </Field>
      ) : (
        <MediaPicker
          key={type}
          wid={wid}
          kind={type}
          value={mediaId}
          onChange={setMediaId}
          error={fieldErrors.mediaAssetId}
        />
      )}
      {type === 'PDF' ? (
        <Switch
          name="allowDownload"
          label={t('structure.fieldAllowDownload')}
          checked={allowDownload ?? false}
          onCheckedChange={setAllowDownload}
        />
      ) : null}
      <Switch
        name="isRequired"
        label={t('structure.fieldRequired')}
        description={t('structure.fieldRequiredHint')}
        checked={isRequired}
        onCheckedChange={setRequired}
      />
      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="secondary">{t('common.cancel')}</Button>
        </Dialog.Close>
        <Button
          type="submit"
          variant="primary"
          loading={submit.busy}
          disabled={title.trim() === ''}
        >
          {t(lesson ? 'structure.save' : 'structure.create')}
        </Button>
      </Dialog.Footer>
    </form>
  );
}
