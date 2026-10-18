'use client';

import { SUSPENSION_REASON_MAX } from '@nibras/contracts/web';
import { Alert, Button, Dialog, Field, Textarea, useSubmit } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { apiErrorMessage, issuesToFieldErrors } from '../lib/api-error';
import { useErrorFocus } from '../lib/use-error-focus';

/**
 * A suspension asked for in a dialog (super-admin console): the reason is required (it is stored
 * and sent to the members / the user). `onConfirm` returns the API error body, or `null` on
 * success — the dialog then closes and the caller toasts. Validation issues land on the field.
 */
export function AdminReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  onConfirm,
  onCloseAutoFocus,
  trigger,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  description?: ReactNode;
  submitLabel: string;
  onConfirm(reason: string): Promise<unknown>;
  onCloseAutoFocus?: (event: Event) => void;
  /** Optional `Dialog.Trigger` child (focus returns to it on close). */
  trigger?: ReactNode;
}) {
  const t = useTranslations();
  const [reason, setReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);

  const reset = () => {
    setReason('');
    setFieldErrors({});
    setFormError(null);
  };

  const confirm = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    let error: unknown;
    try {
      error = await onConfirm(reason.trim());
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    if (error) {
      const mapped = issuesToFieldErrors(t, error);
      if (mapped.reason) setFieldErrors({ reason: mapped.reason });
      else setFormError(apiErrorMessage(t, error));
      return;
    }
    reset();
    onOpenChange(false);
  });

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Content
        title={title}
        description={description}
        closeLabel={t('common.close')}
        size="sm"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          method="post"
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void confirm.submit();
          }}
          className="flex flex-col gap-4"
        >
          {formError ? (
            <Alert ref={alertRef} tabIndex={-1} variant="danger">
              {formError}
            </Alert>
          ) : null}
          <Field
            htmlFor="admin-suspend-reason"
            label={t('admin.workspaces.reason')}
            error={fieldErrors.reason}
          >
            <Textarea
              id="admin-suspend-reason"
              name="reason"
              rows={3}
              maxLength={SUSPENSION_REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </Field>
          <Dialog.Footer>
            <Dialog.Close asChild>
              <Button variant="secondary">{t('common.cancel')}</Button>
            </Dialog.Close>
            <Button
              type="submit"
              variant="danger"
              loading={confirm.busy}
              disabled={reason.trim().length === 0}
            >
              {submitLabel}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
