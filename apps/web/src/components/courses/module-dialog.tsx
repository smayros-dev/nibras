'use client';

import type { ModuleWithLessons, UnlockRule } from '@nibras/contracts';
import { MVP_UNLOCK_RULES } from '@nibras/contracts/web';
import {
  Alert,
  Button,
  Dialog,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
  useSubmit,
} from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '../../lib/api';
import { apiErrorMessage, issuesToFieldErrors } from '../../lib/api-error';
import { withIfMatch, type CourseWrite, type WriteOutcome } from '../../lib/courses';
import { useErrorFocus } from '../../lib/use-error-focus';

const FIELDS = ['title', 'description', 'isOptional', 'unlockRule'];

/**
 * Create or edit a module (PRD §8.4.2): title, description, « Module optionnel » and the unlock
 * rule (`NONE` / `PREVIOUS_MODULE_COMPLETED`, the MVP rules). The write goes through the editor's
 * `run` (course `If-Match`, structure reload, conflict dialog).
 */
export function ModuleDialog({
  wid,
  courseId,
  module,
  open,
  onOpenChange,
  run,
  onCloseAutoFocus,
}: {
  wid: string;
  courseId: string;
  /** `null` creates a module (appended at the end). */
  module: ModuleWithLessons | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: (write: CourseWrite) => Promise<WriteOutcome>;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        title={t(module ? 'structure.moduleEditTitle' : 'structure.moduleCreateTitle')}
        closeLabel={t('common.close')}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <ModuleForm
          wid={wid}
          courseId={courseId}
          module={module}
          run={run}
          onDone={() => onOpenChange(false)}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function ModuleForm({
  wid,
  courseId,
  module,
  run,
  onDone,
}: {
  wid: string;
  courseId: string;
  module: ModuleWithLessons | null;
  run: (write: CourseWrite) => Promise<WriteOutcome>;
  onDone: () => void;
}) {
  const t = useTranslations();
  const [title, setTitle] = useState(module?.title ?? '');
  const [description, setDescription] = useState(module?.description ?? '');
  const [isOptional, setOptional] = useState(module?.isOptional ?? false);
  const [unlock, setUnlock] = useState<UnlockRule['type']>(module?.unlockRule.type ?? 'NONE');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);

  const submit = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    const text = description.trim();
    const body = {
      title: title.trim(),
      ...(module ? { description: text === '' ? null : text } : text ? { description: text } : {}),
      isOptional,
      unlockRule: { type: unlock },
    };
    const outcome = await run((version) =>
      module
        ? api.PATCH('/workspaces/{wid}/modules/{mid}', {
            params: { path: { wid, mid: module.id }, header: withIfMatch(version) },
            body,
          })
        : api.POST('/workspaces/{wid}/courses/{cid}/modules', {
            params: { path: { wid, cid: courseId }, header: withIfMatch(version) },
            body,
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
      <Field
        htmlFor="module-title"
        label={t('structure.fieldTitle')}
        error={fieldErrors.title}
        required
      >
        <Input
          id="module-title"
          name="title"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </Field>
      <Field
        htmlFor="module-description"
        label={t('structure.fieldDescription')}
        error={fieldErrors.description}
      >
        <Textarea
          id="module-description"
          name="description"
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Switch
        name="isOptional"
        label={t('structure.fieldOptional')}
        description={t('structure.fieldOptionalHint')}
        checked={isOptional}
        onCheckedChange={setOptional}
      />
      <Field
        htmlFor="module-unlock"
        label={t('structure.fieldUnlock')}
        error={fieldErrors.unlockRule}
      >
        <Select
          id="module-unlock"
          name="unlockRule"
          value={unlock}
          onChange={(e) => setUnlock(e.target.value as UnlockRule['type'])}
        >
          {MVP_UNLOCK_RULES.map((rule) => (
            <option key={rule} value={rule}>
              {t(`structure.unlock_${rule}`)}
            </option>
          ))}
        </Select>
      </Field>
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
          {t(module ? 'structure.save' : 'structure.create')}
        </Button>
      </Dialog.Footer>
    </form>
  );
}
