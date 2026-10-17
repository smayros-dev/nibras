'use client';

import type { AbuseCategory } from '@tt/contracts';
import { ABUSE_CATEGORIES } from '@tt/contracts';
import { Button, Field, Select, TextInput } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiErrorMessage } from '../lib/api-error';
import { api } from '../lib/api';

/**
 * *Signaler* a member (PRD §11.7): dialog with category + description, POSTed to the workspace
 * abuse queue (or the account-level route when there is no workspace). Later plans mount the
 * same button in rooms, messages and courses. Controlled (`open`/`onOpenChange`), it renders no
 * trigger of its own: a row menu item opens it (members page).
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
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : ownOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [category, setCategory] = useState<AbuseCategory>('HARASSMENT');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const body = { category, description, entityType, entityId };
    const { error: postError } = workspaceId
      ? await api.POST('/workspaces/{wid}/abuse-reports', {
          params: { path: { wid: workspaceId } },
          body,
        })
      : await api.POST('/abuse-reports', { body });
    setBusy(false);
    if (postError) {
      setError(apiErrorMessage(t, postError as unknown));
      return;
    }
    setSent(true);
  }

  return (
    <>
      {controlled ? null : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {t('abuse.report')}
        </Button>
      )}
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="abuse-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h2 id="abuse-dialog-title" className="mb-3 text-lg font-bold">
              {t('abuse.title')}
            </h2>
            {sent ? (
              <p role="status" className="text-sm text-success">
                {t('abuse.sent')}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {error ? (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                ) : null}
                <Field htmlFor="abuse-category" label={t('abuse.category')}>
                  <Select
                    id="abuse-category"
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
                <Field htmlFor="abuse-description" label={t('abuse.description')}>
                  <TextInput
                    id="abuse-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    onClick={() => void submit()}
                    disabled={busy || description.trim().length < 10}
                  >
                    {t('abuse.submit')}
                  </Button>
                  <Button variant="secondary" onClick={() => setOpen(false)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            )}
            {sent ? (
              <div className="mt-3">
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  {t('common.close')}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
