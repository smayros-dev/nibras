'use client';

import type { CourseDetail, CreateCourseInput, RichTextDescriptionDoc } from '@nibras/contracts';
import { COURSE_LEVELS, LOCALES, type CourseLevel, type Locale } from '@nibras/contracts/web';
import { Alert, Button, Dialog, Field, Input, Select, Switch, useSubmit } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, asApiResult } from '../../lib/api';
import { apiErrorMessage, issuesToFieldErrors } from '../../lib/api-error';
import { LANGUAGE_NAMES } from '../../lib/courses';
import {
  EMPTY_DOC,
  isEmptyDoc,
  richTextProblem,
  richTextProblemMessage,
} from '../../lib/rich-text';
import { useErrorFocus } from '../../lib/use-error-focus';
import { LazyRichTextEditor } from '../rich-text/lazy-editor';

const FIELDS = ['title', 'description', 'level', 'language', 'sequentialLessons'];

/**
 * « + Créer » on the courses page (PRD §8.4.1): title, description (rich text, no images), level, teaching language (the workspace's
 * default) and « Leçons dans l'ordre ». `POST /courses` creates a DRAFT; `onCreated` gets it (the
 * panel opens it). Validation issues land on their fields, anything else in a form alert. Loaded
 * on the first click (React.lazy), so the route's first-load JS does not carry it.
 */
export function CreateCourseDialog({
  wid,
  defaultLanguage,
  open,
  onOpenChange,
  onCreated,
  onCloseAutoFocus,
}: {
  wid: string;
  defaultLanguage: Locale;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (course: CourseDetail) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        title={t('courses.createTitle')}
        closeLabel={t('common.close')}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <CreateCourseForm wid={wid} defaultLanguage={defaultLanguage} onCreated={onCreated} />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function CreateCourseForm({
  wid,
  defaultLanguage,
  onCreated,
}: {
  wid: string;
  defaultLanguage: Locale;
  onCreated: (course: CourseDetail) => void;
}) {
  const t = useTranslations();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState<RichTextDescriptionDoc>(EMPTY_DOC);
  const [level, setLevel] = useState<CourseLevel | ''>('');
  const [language, setLanguage] = useState<Locale>(defaultLanguage);
  const [sequential, setSequential] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);

  const submit = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    const problem = richTextProblem(description);
    if (problem) {
      setFieldErrors({ description: richTextProblemMessage(t, problem) });
      return;
    }
    const body: CreateCourseInput = {
      title: title.trim(),
      language,
      ...(isEmptyDoc(description) ? {} : { description }),
      ...(level ? { level } : {}),
      ...(sequential ? { sequentialLessons: true } : {}),
    };
    let result: { data?: CourseDetail; error?: unknown };
    try {
      result = asApiResult<CourseDetail>(
        await api.POST('/workspaces/{wid}/courses', { params: { path: { wid } }, body }),
      );
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    const { data, error } = result;
    if (error || !data) {
      const onFields = Object.fromEntries(
        Object.entries(issuesToFieldErrors(t, error)).filter(([f]) => FIELDS.includes(f)),
      );
      if (Object.keys(onFields).length > 0) setFieldErrors(onFields);
      else setFormError(apiErrorMessage(t, error ?? null));
      return;
    }
    onCreated(data);
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
      <Field
        htmlFor="create-course-title"
        label={t('courses.fieldTitle')}
        error={fieldErrors.title}
        required
      >
        <Input
          id="create-course-title"
          name="title"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </Field>
      <LazyRichTextEditor
        id="create-course-description"
        label={t('courses.fieldDescription')}
        error={fieldErrors.description}
        value={description}
        // Without `images` the editor drops every image node.
        onChange={(doc) => setDescription(doc as RichTextDescriptionDoc)}
      />
      <Field
        htmlFor="create-course-level"
        label={t('courses.fieldLevel')}
        error={fieldErrors.level}
      >
        <Select
          id="create-course-level"
          name="level"
          value={level}
          onChange={(e) => setLevel(e.target.value as CourseLevel | '')}
        >
          <option value="">{t('courses.levelNone')}</option>
          {COURSE_LEVELS.map((l) => (
            <option key={l} value={l}>
              {t(`courses.level_${l}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        htmlFor="create-course-language"
        label={t('courses.fieldLanguage')}
        error={fieldErrors.language}
      >
        <Select
          id="create-course-language"
          name="language"
          value={language}
          onChange={(e) => setLanguage(e.target.value as Locale)}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l} lang={l}>
              {LANGUAGE_NAMES[l]}
            </option>
          ))}
        </Select>
      </Field>
      <Switch
        name="sequentialLessons"
        label={t('courses.fieldSequential')}
        description={t('courses.fieldSequentialHint')}
        checked={sequential}
        onCheckedChange={setSequential}
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
          {t('courses.createSubmit')}
        </Button>
      </Dialog.Footer>
    </form>
  );
}
