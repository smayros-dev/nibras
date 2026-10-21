'use client';

import type { CourseDetail, RichTextDescriptionDoc, UpdateCourseInput } from '@nibras/contracts';
import { COURSE_LEVELS, LOCALES, type CourseLevel, type Locale } from '@nibras/contracts/web';
import { Alert, Button, Card, Field, Input, Select, Switch, useSubmit, useToast } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { lazy, Suspense, useState } from 'react';
import { api, asApiResult } from '../../lib/api';
import { apiErrorMessage, issuesToFieldErrors } from '../../lib/api-error';
import { conflictVersion, LANGUAGE_NAMES, withIfMatch } from '../../lib/courses';
import {
  cleanRichText,
  EMPTY_DOC,
  richTextProblem,
  richTextProblemMessage,
} from '../../lib/rich-text';
import { useErrorFocus } from '../../lib/use-error-focus';
import { LazyRichTextEditor } from '../rich-text/lazy-editor';

/** Fetched on the first conflict (PRD §14.1 budget). */
const VersionConflictDialog = lazy(() =>
  import('./version-conflict-dialog').then((m) => ({ default: m.VersionConflictDialog })),
);

const FIELDS = [
  'title',
  'description',
  'category',
  'level',
  'language',
  'estimatedMinutes',
  'sequentialLessons',
];

interface Values {
  title: string;
  description: RichTextDescriptionDoc;
  category: string;
  level: CourseLevel | '';
  language: Locale;
  estimated: string;
  sequential: boolean;
}

const valuesOf = (c: CourseDetail): Values => ({
  title: c.title,
  description: cleanRichText(c.description ?? EMPTY_DOC, { allowImage: false }),
  category: c.category ?? '',
  level: c.level ?? '',
  language: c.language,
  estimated: c.estimatedMinutesOverride === null ? '' : String(c.estimatedMinutesOverride),
  sequential: c.sequentialLessons,
});

/** The fields that differ from `course`: a PATCH sends only what the teacher changed. */
function changes(v: Values, course: CourseDetail): UpdateCourseInput {
  const before = valuesOf(course);
  const out: UpdateCourseInput = {};
  if (v.title.trim() !== before.title) out.title = v.title.trim();
  if (JSON.stringify(v.description) !== JSON.stringify(before.description)) {
    out.description = v.description;
  }
  if (v.category.trim() !== before.category) out.category = v.category.trim();
  // « Non précisé » ('') clears the level (`null`).
  if (v.level !== before.level) out.level = v.level === '' ? null : v.level;
  if (v.language !== before.language) out.language = v.language;
  if (v.estimated.trim() !== before.estimated) {
    out.estimatedMinutes = v.estimated.trim() === '' ? null : Number(v.estimated);
  }
  if (v.sequential !== before.sequential) out.sequentialLessons = v.sequential;
  return out;
}

/**
 * The course's Paramètres tab (PRD §8.4.1; AC-CRS-03): title, description (the rich-text editor,
 * without images, loaded on demand), category, level, teaching language,
 * duration override (empty = derived from the lessons) and « Leçons dans l'ordre ». « Enregistrer »
 * PATCHes the changed fields with `If-Match: "<version>"`. A `409 VERSION_CONFLICT` opens
 * `VersionConflictDialog`: « Recharger » takes the latest version and drops the local edits,
 * « Écraser » re-sends them with the current version. Read-only on a SUSPENDED workspace.
 */
export function CourseSettingsForm({
  wid,
  course,
  writable,
  onChanged,
  onReload,
}: {
  wid: string;
  course: CourseDetail;
  writable: boolean;
  onChanged: (course: CourseDetail) => void;
  onReload: () => Promise<CourseDetail | null>;
}) {
  const t = useTranslations();
  const { toast } = useToast();
  const [values, setValues] = useState<Values>(() => valuesOf(course));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  /** The current version of a `409`; `null` when no conflict is shown. */
  const [conflict, setConflict] = useState<number | null>(null);
  const [conflictMounted, setConflictMounted] = useState(false);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const save = useSubmit(async (version: number) => {
    setFieldErrors({});
    setFormError(null);
    const problem = richTextProblem(values.description);
    if (problem) {
      setFieldErrors({ description: richTextProblemMessage(t, problem) });
      return;
    }
    const body = changes(values, course);
    if (Object.keys(body).length === 0) {
      toast({ title: t('courses.noChanges') });
      return;
    }
    let result: { data?: CourseDetail; error?: unknown };
    try {
      result = asApiResult<CourseDetail>(
        await api.PATCH('/workspaces/{wid}/courses/{cid}', {
          params: { path: { wid, cid: course.id }, header: withIfMatch(version) },
          body,
        }),
      );
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    const { data, error } = result;
    if (data && !error) {
      onChanged(data);
      toast({ title: t('courses.saved'), variant: 'success' });
      return;
    }
    const current = conflictVersion(error);
    if (current !== null) {
      setConflictMounted(true);
      setConflict(current);
      return;
    }
    const onFields = Object.fromEntries(
      Object.entries(issuesToFieldErrors(t, error)).filter(([f]) => FIELDS.includes(f)),
    );
    if (Object.keys(onFields).length > 0) setFieldErrors(onFields);
    else setFormError(apiErrorMessage(t, error ?? null));
  });

  const reload = async () => {
    const fresh = await onReload();
    if (fresh) setValues(valuesOf(fresh));
    else setFormError(t('errors.INTERNAL_ERROR'));
  };

  const error = (field: string) => fieldErrors[field === 'estimated' ? 'estimatedMinutes' : field];

  return (
    <Card>
      <form
        method="post"
        ref={formRef}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save.submit(course.version);
        }}
      >
        <h3 className="font-semibold text-fg">{t('courses.settingsTitle')}</h3>
        {formError ? (
          <Alert ref={alertRef} tabIndex={-1} variant="danger">
            {formError}
          </Alert>
        ) : null}
        <fieldset disabled={!writable} className="flex flex-col gap-4">
          <Field
            htmlFor="course-title"
            label={t('courses.fieldTitle')}
            error={error('title')}
            required
          >
            <Input
              id="course-title"
              name="title"
              maxLength={200}
              value={values.title}
              onChange={(e) => set('title', e.target.value)}
              required
            />
          </Field>
          <LazyRichTextEditor
            id="course-description"
            label={t('courses.fieldDescription')}
            error={error('description')}
            value={values.description}
            // Without `images` the editor drops every image node.
            onChange={(doc) => set('description', doc as RichTextDescriptionDoc)}
            disabled={!writable}
          />
          <Field
            htmlFor="course-category"
            label={t('courses.fieldCategory')}
            error={error('category')}
          >
            <Input
              id="course-category"
              name="category"
              maxLength={60}
              value={values.category}
              onChange={(e) => set('category', e.target.value)}
            />
          </Field>
          <Field htmlFor="course-level" label={t('courses.fieldLevel')} error={error('level')}>
            <Select
              id="course-level"
              name="level"
              value={values.level}
              onChange={(e) => set('level', e.target.value as CourseLevel | '')}
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
            htmlFor="course-language"
            label={t('courses.fieldLanguage')}
            error={error('language')}
          >
            <Select
              id="course-language"
              name="language"
              value={values.language}
              onChange={(e) => set('language', e.target.value as Locale)}
            >
              {LOCALES.map((l) => (
                <option key={l} value={l} lang={l}>
                  {LANGUAGE_NAMES[l]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            htmlFor="course-estimated"
            label={t('courses.fieldEstimated')}
            description={t('courses.fieldEstimatedHint')}
            error={error('estimated')}
          >
            <Input
              id="course-estimated"
              name="estimatedMinutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={100000}
              value={values.estimated}
              onChange={(e) => set('estimated', e.target.value)}
            />
          </Field>
          <Switch
            name="sequentialLessons"
            label={t('courses.fieldSequential')}
            description={t('courses.fieldSequentialHint')}
            checked={values.sequential}
            onCheckedChange={(checked) => set('sequential', checked)}
          />
        </fieldset>
        {writable ? (
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={save.busy}>
              {t('courses.save')}
            </Button>
          </div>
        ) : null}
      </form>
      {conflictMounted ? (
        <Suspense fallback={null}>
          <VersionConflictDialog
            open={conflict !== null}
            currentVersion={conflict ?? course.version}
            onOpenChange={(open) => {
              if (!open) setConflict(null);
            }}
            onReload={() => void reload()}
            onOverwrite={(version) => void save.submit(version)}
          />
        </Suspense>
      ) : null}
    </Card>
  );
}
