'use client';

import type { AbuseCategory } from '@nibras/contracts';
import {
  ABUSE_CATEGORIES,
  ABUSE_DESCRIPTION_MAX,
  ABUSE_DESCRIPTION_MIN,
} from '@nibras/contracts/web';
import { Alert, Button, Dialog, Field, Select, Textarea, useSubmit, useToast } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiErrorMessage, issuesToFieldErrors } from '../lib/api-error';
import { api } from '../lib/api';
import { useErrorFocus } from '../lib/use-error-focus';

/**
 * *Signaler* a member (PRD §11.7): dialog with category + description, POSTed to the workspace
 * abuse queue (or the account-level route when there is no workspace); success shows in place and
 * as a toast. Later plans mount the same button in rooms, messages and courses. Uncontrolled, it
 * renders its own trigger (focus returns to it on close). Controlled (`open`/`onOpenChange`), it
 * renders no trigger: a row menu item opens it and the caller restores focus (members page).
 */
export function ReportAbuseButton({
  workspaceId,
  entityType,
  entityId,
  open: controlledOpen,
  onOpenChange,
}: {
  workspaceId: string | null;
  entityType: 'USER' | 'MESSAGE' | 'SESSION' | 'COURSE';
  entityId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations();
  const { toast } = useToast();
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : ownOpen;
  const [category, setCategory] = useState<AbuseCategory>('HARASSMENT');
  const [description, setDescription] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);

  const setOpen = (next: boolean) => {
    if (!next) {
      // A new report starts blank.
      setCategory('HARASSMENT');
      setDescription('');
      setFieldErrors({});
      setFormError(null);
      setSent(false);
    }
    if (!controlled) setOwnOpen(next);
    onOpenChange?.(next);
  };

  const report = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    const body = { category, description: description.trim(), entityType, entityId };
    let postError: unknown;
    try {
      ({ error: postError } = workspaceId
        ? await api.POST('/workspaces/{wid}/abuse-reports', {
            params: { path: { wid: workspaceId } },
            body,
          })
        : await api.POST('/abuse-reports', { body }));
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    if (postError) {
      const mapped = issuesToFieldErrors(t, postError);
      const onFields = Object.fromEntries(
        Object.entries(mapped).filter(([field]) => field === 'category' || field === 'description'),
      );
      if (Object.keys(onFields).length > 0) setFieldErrors(onFields);
      else setFormError(apiErrorMessage(t, postError));
      return;
    }
    setSent(true);
    toast({ title: t('abuse.sent'), variant: 'success' });
  });

  const length = description.trim().length;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {controlled ? null : (
        <Dialog.Trigger asChild>
          <Button variant="secondary">{t('abuse.report')}</Button>
        </Dialog.Trigger>
      )}
      <Dialog.Content title={t('abuse.title')} closeLabel={t('common.close')}>
        {sent ? (
          <>
            <Alert variant="success">{t('abuse.sent')}</Alert>
            <Dialog.Footer>
              <Dialog.Close asChild>
                <Button variant="secondary">{t('common.close')}</Button>
              </Dialog.Close>
            </Dialog.Footer>
          </>
        ) : (
          <form
            method="post"
            ref={formRef}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void report.submit();
            }}
            className="flex flex-col gap-4"
          >
            {formError ? (
              <Alert ref={alertRef} tabIndex={-1} variant="danger">
                {formError}
              </Alert>
            ) : null}
            <Field
              htmlFor="abuse-category"
              label={t('abuse.category')}
              error={fieldErrors.category}
            >
              <Select
                id="abuse-category"
                name="category"
                value={category}
                onChange={(e) => setCategory(e.target.value as AbuseCategory)}
              >
                {ABUSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`abuse.category_${c}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              htmlFor="abuse-description"
              label={t('abuse.description')}
              description={t('abuse.descriptionCounter', {
                count: length,
                min: ABUSE_DESCRIPTION_MIN,
              })}
              error={fieldErrors.description}
            >
              <Textarea
                id="abuse-description"
                name="description"
                rows={4}
                autoResize
                maxLength={ABUSE_DESCRIPTION_MAX}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
            </Field>
            <Dialog.Footer>
              <Dialog.Close asChild>
                <Button variant="secondary">{t('common.cancel')}</Button>
              </Dialog.Close>
              <Button
                type="submit"
                variant="primary"
                loading={report.busy}
                disabled={length < ABUSE_DESCRIPTION_MIN}
              >
                {t('abuse.submit')}
              </Button>
            </Dialog.Footer>
          </form>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
