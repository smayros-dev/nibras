'use client';

import type {
  InvitationStatus,
  InvitationSummary,
  InvitationsPage,
  UpdateInvitationInput,
} from '@nibras/contracts';
import { formatDate } from '@nibras/i18n';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Dialog,
  DropdownMenu,
  Field,
  Input,
  Table,
  useSubmit,
  useToast,
  type BadgeVariant,
} from '@nibras/ui';
import { Ban, MoreHorizontal, Pencil, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, asApiResult } from '../lib/api';
import { apiErrorMessage, issuesToFieldErrors } from '../lib/api-error';
import { useAbortableQuery, type AbortableQuery } from '../lib/paged-fetch';
import { useErrorFocus } from '../lib/use-error-focus';
import { useReturnFocus } from '../lib/use-return-focus';

/** Invitations still open on the staff side: waiting for an answer, or expired (resendable). */
const OPEN_STATUSES = ['PENDING', 'EXPIRED'] as const satisfies readonly InvitationStatus[];

const STATUS_BADGE: Record<(typeof OPEN_STATUSES)[number], BadgeVariant> = {
  PENDING: 'warning',
  EXPIRED: 'danger',
};

/** `STUDENT`: the students page; `STAFF`: teacher/admin invitations of the members page (T14). */
export type InvitationsScope = 'STUDENT' | 'STAFF';

/**
 * The open (`PENDING` + `EXPIRED`) invitations of `wid` for `scope`, newest first, abortable and
 * debounced on `q` (`useAbortableQuery`). Throws translated messages.
 */
export function useOpenInvitations(
  wid: string,
  scope: InvitationsScope,
  q: string,
  translate: (key: string) => string,
): AbortableQuery<InvitationSummary[]> {
  return useAbortableQuery([wid, scope, q], async (signal) => {
    const pages = await Promise.all(
      OPEN_STATUSES.map(async (status) => {
        let result;
        try {
          result = asApiResult<InvitationsPage>(
            await api.GET('/workspaces/{wid}/invitations', {
              params: {
                path: { wid },
                query: {
                  status,
                  ...(scope === 'STUDENT' ? { role: 'STUDENT' as const } : {}),
                  ...(q ? { q } : {}),
                  limit: 100,
                },
              },
              signal,
            }),
          );
        } catch {
          throw new Error(translate('errors.INTERNAL_ERROR'));
        }
        if (result.error) throw new Error(apiErrorMessage(translate, result.error));
        return result.data?.items ?? [];
      }),
    );
    return pages
      .flat()
      .filter((i) => (scope === 'STUDENT' ? i.role === 'STUDENT' : i.role !== 'STUDENT'))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

/** Minutes left from a `429 RATE_LIMITED` body (`details.retryAfterS`), else `null`. */
export function retryAfterMinutes(error: unknown): number | null {
  const body = error as { code?: string; details?: { retryAfterS?: unknown } } | null;
  const seconds = body?.details?.retryAfterS;
  if (body?.code !== 'RATE_LIMITED' || typeof seconds !== 'number') return null;
  return Math.max(1, Math.ceil(seconds / 60));
}

const displayName = (i: Pick<InvitationSummary, 'firstName' | 'lastName'>) =>
  [i.firstName, i.lastName].filter(Boolean).join(' ');

/**
 * Open invitations as a table (students page « En attente » tab; members page staff invitations,
 * T14): invitee, status badge (« Invitation en attente » / « expirée »), sent and expiry dates,
 * and one menu per row named after the address: **Renvoyer** (`429` → toast with the minutes
 * left), **Modifier** (names and guardian email of a `PENDING` row, in a `Dialog`), **Révoquer**
 * (`AlertDialog`). `canManage` false (no `student.invite`, read-only workspace) shows no menu.
 * The caller owns the data (`useOpenInvitations`) and reloads it in `onChanged`.
 */
export function InvitationsList({
  wid,
  items,
  canManage,
  onChanged,
  caption,
}: {
  wid: string;
  items: InvitationSummary[];
  canManage: boolean;
  onChanged: () => void;
  caption: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { toast } = useToast();
  const returnFocus = useReturnFocus();
  const [editTarget, setEditTarget] = useState<InvitationSummary | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<InvitationSummary | null>(null);

  // Resolved after mount: the server has no viewer time zone (no hydration mismatch).
  const [viewerTimezone, setViewerTimezone] = useState('UTC');
  useEffect(() => {
    setViewerTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  const date = (iso: string) =>
    formatDate(new Date(iso), locale, viewerTimezone, { dateStyle: 'medium' });

  const mutate = useSubmit(
    async (
      call: () => Promise<Parameters<typeof asApiResult>[0]>,
      success: string,
    ): Promise<boolean> => {
      try {
        const { error } = asApiResult<unknown>(await call());
        if (error) {
          const min = retryAfterMinutes(error);
          toast({
            title: min !== null ? t('invitations.retryIn', { min }) : apiErrorMessage(t, error),
            variant: 'danger',
          });
          return false;
        }
      } catch {
        toast({ title: t('errors.INTERNAL_ERROR'), variant: 'danger' });
        return false;
      }
      toast({ title: success, variant: 'success' });
      onChanged();
      return true;
    },
  );

  const columns = {
    invitee: t('invitations.invitee'),
    status: t('students.status'),
    sent: t('invitations.sentOn'),
    expires: t('invitations.expiresOn'),
  };

  return (
    <>
      <Table caption={caption} hideCaption>
        <Table.Head>
          <Table.Row>
            <Table.Th>{columns.invitee}</Table.Th>
            <Table.Th>{columns.status}</Table.Th>
            <Table.Th>{columns.sent}</Table.Th>
            <Table.Th>{columns.expires}</Table.Th>
            <Table.Th>
              <span className="sr-only">{t('students.actions')}</span>
            </Table.Th>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {items.map((i) => {
            const name = displayName(i);
            const status = i.status === 'EXPIRED' ? 'EXPIRED' : 'PENDING';
            return (
              <Table.Row key={i.id} data-testid={`invitation-${i.id}`}>
                <Table.Td label={columns.invitee}>
                  <span className="block font-medium break-all">{i.email}</span>
                  {name ? <span className="block text-xs text-fg-muted">{name}</span> : null}
                </Table.Td>
                <Table.Td label={columns.status}>
                  <Badge variant={STATUS_BADGE[status]}>{t(`invitations.status_${status}`)}</Badge>
                </Table.Td>
                <Table.Td label={columns.sent}>{date(i.lastSentAt)}</Table.Td>
                <Table.Td label={columns.expires}>{date(i.expiresAt)}</Table.Td>
                <Table.Actions>
                  {canManage ? (
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('invitations.rowActions', { email: i.email })}
                          ref={returnFocus.register(i.id)}
                        >
                          <MoreHorizontal aria-hidden="true" className="size-5" />
                        </Button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content align="end">
                        <DropdownMenu.Item
                          icon={<Send />}
                          disabled={mutate.busy}
                          onSelect={() =>
                            void mutate.submit(
                              () =>
                                api.POST('/workspaces/{wid}/invitations/{id}/resend', {
                                  params: { path: { wid, id: i.id } },
                                }),
                              t('invitations.resent', { email: i.email }),
                            )
                          }
                        >
                          {t('invitations.resend')}
                        </DropdownMenu.Item>
                        {i.status === 'PENDING' ? (
                          <DropdownMenu.Item
                            icon={<Pencil />}
                            onSelect={() => {
                              returnFocus.remember(i.id);
                              setEditTarget(i);
                            }}
                          >
                            {t('invitations.edit')}
                          </DropdownMenu.Item>
                        ) : null}
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item
                          destructive
                          icon={<Ban />}
                          onSelect={() => {
                            returnFocus.remember(i.id);
                            setRevokeTarget(i);
                          }}
                        >
                          {t('invitations.revoke')}
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                  ) : null}
                </Table.Actions>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>

      <AlertDialog.Root
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        {revokeTarget ? (
          <AlertDialog.Content
            title={t('invitations.revokeTitle', { email: revokeTarget.email })}
            description={t('invitations.revokeDescription')}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          >
            <AlertDialog.Footer>
              <AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
              <AlertDialog.Action
                destructive
                loading={mutate.busy}
                onClick={(event) => {
                  // Stay open while the request runs; close on the outcome (error → toast).
                  event.preventDefault();
                  const target = revokeTarget;
                  void mutate
                    .submit(
                      () =>
                        api.DELETE('/workspaces/{wid}/invitations/{id}', {
                          params: { path: { wid, id: target.id } },
                        }),
                      t('invitations.revoked'),
                    )
                    .finally(() => setRevokeTarget(null));
                }}
              >
                {t('invitations.revokeConfirm')}
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        ) : null}
      </AlertDialog.Root>

      <Dialog.Root
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        {editTarget ? (
          <Dialog.Content
            title={t('invitations.editTitle', { email: editTarget.email })}
            closeLabel={t('common.close')}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          >
            <EditInvitationForm
              key={editTarget.id}
              wid={wid}
              invitation={editTarget}
              onSaved={() => {
                setEditTarget(null);
                toast({ title: t('invitations.updated'), variant: 'success' });
                onChanged();
              }}
            />
          </Dialog.Content>
        ) : null}
      </Dialog.Root>
    </>
  );
}

/** Names (and, for a student, guardian email) of a `PENDING` invitation (`PATCH …/invitations/{id}`). */
function EditInvitationForm({
  wid,
  invitation,
  onSaved,
}: {
  wid: string;
  invitation: InvitationSummary;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const [firstName, setFirstName] = useState(invitation.firstName ?? '');
  const [lastName, setLastName] = useState(invitation.lastName ?? '');
  const [guardianEmail, setGuardianEmail] = useState(invitation.guardianEmail ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);
  const id = `invitation-${invitation.id}`;
  /** A guardian belongs to a student invitation only (staff rows edit the names). */
  const isStudent = invitation.role === 'STUDENT';

  const save = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    const guardian = guardianEmail.trim();
    // Empty names are left as they are (the API takes 1–80 characters); an emptied guardian
    // email clears the stored one.
    const body: UpdateInvitationInput = {
      ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
      ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
      ...(!isStudent
        ? {}
        : guardian
          ? { guardianEmail: guardian }
          : invitation.guardianEmail
            ? { guardianEmail: null }
            : {}),
    };
    let error: unknown;
    try {
      ({ error } = asApiResult<InvitationSummary>(
        await api.PATCH('/workspaces/{wid}/invitations/{id}', {
          params: { path: { wid, id: invitation.id } },
          body,
        }),
      ));
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    if (error) {
      const mapped = issuesToFieldErrors(t, error);
      if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
      else setFormError(apiErrorMessage(t, error));
      return;
    }
    onSaved();
  });

  return (
    <form
      method="post"
      ref={formRef}
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save.submit();
      }}
    >
      {formError ? (
        <Alert ref={alertRef} tabIndex={-1} variant="danger">
          {formError}
        </Alert>
      ) : null}
      <Field
        htmlFor={`${id}-first`}
        label={t('invitations.firstName')}
        error={fieldErrors.firstName}
      >
        <Input
          id={`${id}-first`}
          name="firstName"
          autoComplete="off"
          maxLength={80}
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
      </Field>
      <Field htmlFor={`${id}-last`} label={t('invitations.lastName')} error={fieldErrors.lastName}>
        <Input
          id={`${id}-last`}
          name="lastName"
          autoComplete="off"
          maxLength={80}
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
        />
      </Field>
      {isStudent ? (
        <Field
          htmlFor={`${id}-guardian`}
          label={t('invitations.guardianEmail')}
          description={t('invitations.guardianHint')}
          error={fieldErrors.guardianEmail}
        >
          <Input
            id={`${id}-guardian`}
            name="guardianEmail"
            type="email"
            autoComplete="off"
            value={guardianEmail}
            onChange={(e) => setGuardianEmail(e.target.value)}
          />
        </Field>
      ) : null}
      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="secondary">{t('common.cancel')}</Button>
        </Dialog.Close>
        <Button type="submit" variant="primary" loading={save.busy}>
          {t('invitations.save')}
        </Button>
      </Dialog.Footer>
    </form>
  );
}
