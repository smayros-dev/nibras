'use client';

import { WORKSPACE_STATUSES, WORKSPACE_TYPES } from '@tt/contracts/web';
import type { AdminWorkspace, AdminWorkspacesPage, WorkspaceType } from '@tt/contracts';
import { formatDate } from '@tt/i18n';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Card,
  Dialog,
  DropdownMenu,
  EmptyState,
  Field,
  Input,
  Select,
  SkeletonTable,
  Table,
  useSubmit,
  useToast,
  type BadgeVariant,
} from '@tt/ui';
import { Ban, Building2, HardDrive, MoreHorizontal, RotateCcw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { AdminReasonDialog } from './admin-reason-dialog';
import { apiErrorMessage, issuesToFieldErrors } from '../lib/api-error';
import { api, asApiResult } from '../lib/api';
import { formatBytes } from '../lib/format-bytes';
import { useAbortableQuery } from '../lib/paged-fetch';
import { useErrorFocus } from '../lib/use-error-focus';

type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

const GIB = 1024 ** 3;

const STATUS_BADGE: Record<WorkspaceStatus, BadgeVariant> = {
  ACTIVE: 'success',
  SUSPENDED: 'danger',
  DELETING: 'warning',
};

type Pending = { kind: 'suspend' | 'reactivate' | 'quota'; ws: AdminWorkspace } | null;

/** Quota in GiB, asked in a dialog; a value below the used storage comes back as a field error. */
function QuotaDialog({
  target,
  onClose,
  onSaved,
  onCloseAutoFocus,
}: {
  target: AdminWorkspace | null;
  onClose(): void;
  onSaved(): void;
  onCloseAutoFocus(event: Event): void;
}) {
  const t = useTranslations();
  const [quotaGiB, setQuotaGiB] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);

  useEffect(() => {
    if (target) setQuotaGiB(String(Math.round(Number(target.storageQuotaBytes) / GIB)));
    setFieldErrors(undefined);
    setFormError(null);
  }, [target]);

  // A fresh object per failure, so `useErrorFocus` refocuses on a repeated error.
  const fail = (message: string) => setFieldErrors({ quota: message });

  const save = useSubmit(async () => {
    if (!target) return;
    setFieldErrors(undefined);
    setFormError(null);
    const gib = Number(quotaGiB);
    if (quotaGiB.trim() === '' || !Number.isFinite(gib) || gib < 0) {
      fail(t('validation.invalid'));
      return;
    }
    try {
      const { error } = asApiResult<unknown>(
        await api.PATCH('/admin/workspaces/{wid}/quota', {
          params: { path: { wid: target.id } },
          body: { storageQuotaBytes: BigInt(Math.round(gib * GIB)).toString() },
        }),
      );
      if (error) {
        const mapped = issuesToFieldErrors(t, error);
        if (mapped.storageQuotaBytes) fail(mapped.storageQuotaBytes);
        else setFormError(apiErrorMessage(t, error));
        return;
      }
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    onSaved();
  });

  return (
    <Dialog.Root
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {target ? (
        <Dialog.Content
          title={t('admin.workspaces.quotaTitle')}
          description={t('admin.workspaces.quotaDescription', {
            name: target.name,
            used: formatBytes(target.storageUsedBytes),
          })}
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
              void save.submit();
            }}
            className="flex flex-col gap-4"
          >
            {formError ? (
              <Alert ref={alertRef} tabIndex={-1} variant="danger">
                {formError}
              </Alert>
            ) : null}
            <Field
              htmlFor="admin-ws-quota"
              label={t('admin.workspaces.quotaGiB')}
              error={fieldErrors?.quota}
            >
              <Input
                id="admin-ws-quota"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                dir="ltr"
                value={quotaGiB}
                onChange={(e) => setQuotaGiB(e.target.value)}
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
                loading={save.busy}
                disabled={quotaGiB.trim() === ''}
              >
                {t('admin.workspaces.saveQuota')}
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      ) : null}
    </Dialog.Root>
  );
}

/**
 * Super-admin workspaces (US-X01): filters (name, type, status) debounced and abortable, one row
 * menu per workspace: suspend (reason in a dialog) / reactivate (confirmed) and the storage quota
 * in GiB (dialog). Outcomes are toasts; the table reloads after each change.
 */
export function AdminWorkspacesPanel() {
  const t = useTranslations();
  const locale = useLocale();
  const { toast } = useToast();

  const [query, setQuery] = useState('');
  const [type, setType] = useState<'' | WorkspaceType>('');
  const [status, setStatus] = useState<'' | WorkspaceStatus>('');
  const q = query.trim();

  const workspaces = useAbortableQuery([q, type, status], async (signal) => {
    let result;
    try {
      result = asApiResult<AdminWorkspacesPage>(
        await api.GET('/admin/workspaces', {
          params: {
            query: {
              ...(q ? { q } : {}),
              ...(type ? { type } : {}),
              ...(status ? { status } : {}),
              limit: 50,
            },
          },
          signal,
        }),
      );
    } catch {
      throw new Error(t('errors.INTERNAL_ERROR'));
    }
    if (result.error) throw new Error(apiErrorMessage(t, result.error));
    return result.data?.items ?? [];
  });

  // Resolved after mount: the server has no viewer time zone (no hydration mismatch).
  const [viewerTimezone, setViewerTimezone] = useState('UTC');
  useEffect(() => {
    setViewerTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  const [pending, setPending] = useState<Pending>(null);
  // Dialogs opened from a row menu have no `Trigger`: focus goes back to that row's menu button.
  const menuTriggers = useRef(new Map<string, HTMLButtonElement>());
  const returnFocusTo = useRef<string | null>(null);
  const restoreFocus = (event: Event) => {
    const opener = returnFocusTo.current ? menuTriggers.current.get(returnFocusTo.current) : null;
    if (opener?.isConnected) {
      event.preventDefault();
      opener.focus();
    }
  };
  const open = (kind: NonNullable<Pending>['kind'], ws: AdminWorkspace) => {
    returnFocusTo.current = ws.id;
    setPending({ kind, ws });
  };
  const close = () => setPending(null);

  const reactivate = useSubmit(async (ws: AdminWorkspace) => {
    try {
      const { error } = asApiResult<unknown>(
        await api.POST('/admin/workspaces/{wid}/unsuspend', { params: { path: { wid: ws.id } } }),
      );
      if (error) {
        toast({ title: apiErrorMessage(t, error), variant: 'danger' });
        return;
      }
    } catch {
      toast({ title: t('errors.INTERNAL_ERROR'), variant: 'danger' });
      return;
    } finally {
      close();
    }
    toast({ title: t('admin.workspaces.reactivated'), variant: 'success' });
    workspaces.reload();
  });

  const columns = {
    name: t('admin.workspaces.name'),
    type: t('admin.workspaces.type'),
    members: t('admin.workspaces.members'),
    storage: t('admin.workspaces.storage'),
    status: t('admin.workspaces.status'),
    createdAt: t('admin.workspaces.createdAt'),
  };
  const typeLabel = (value: WorkspaceType) =>
    value === 'PERSONAL' ? t('workspace.typePersonal') : t('workspace.typeOrganization');

  const list = workspaces.data;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-fg">{t('admin.navWorkspaces')}</h2>

      <div
        role="group"
        aria-label={t('admin.workspaces.filters')}
        className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
      >
        <Field htmlFor="admin-ws-q" label={t('admin.workspaces.search')}>
          <Input
            id="admin-ws-q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Field htmlFor="admin-ws-type" label={t('admin.workspaces.type')}>
          <Select
            id="admin-ws-type"
            value={type}
            onChange={(e) => setType(e.target.value as '' | WorkspaceType)}
          >
            <option value="">{t('admin.workspaces.allTypes')}</option>
            {WORKSPACE_TYPES.map((value) => (
              <option key={value} value={value}>
                {typeLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="admin-ws-status" label={t('admin.workspaces.status')}>
          <Select
            id="admin-ws-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as '' | WorkspaceStatus)}
          >
            <option value="">{t('admin.workspaces.allStatuses')}</option>
            {WORKSPACE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`admin.workspaceStatus.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {workspaces.error ? <Alert variant="danger">{workspaces.error}</Alert> : null}

      <Card padding="none" aria-busy={workspaces.loading}>
        {list === undefined ? (
          workspaces.error ? null : (
            <SkeletonTable className="p-4" cols={6} />
          )
        ) : list.length === 0 ? (
          <EmptyState as="h3" icon={<Building2 />} title={t('admin.workspaces.empty')} />
        ) : (
          <Table caption={t('admin.navWorkspaces')} hideCaption>
            <Table.Head>
              <Table.Row>
                <Table.Th>{columns.name}</Table.Th>
                <Table.Th>{columns.type}</Table.Th>
                <Table.Th>{columns.members}</Table.Th>
                <Table.Th>{columns.storage}</Table.Th>
                <Table.Th>{columns.status}</Table.Th>
                <Table.Th>{columns.createdAt}</Table.Th>
                <Table.Th>
                  <span className="sr-only">{t('members.actions')}</span>
                </Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {list.map((ws) => (
                <Table.Row key={ws.id} data-testid={`admin-ws-${ws.id}`}>
                  <Table.Td label={columns.name}>
                    <span className="font-medium">{ws.name}</span>
                    <span dir="ltr" className="block font-mono text-xs text-fg-muted">
                      {ws.slug}
                    </span>
                  </Table.Td>
                  <Table.Td label={columns.type}>
                    <Badge variant="neutral">{typeLabel(ws.type)}</Badge>
                  </Table.Td>
                  <Table.Td label={columns.members} numeric>
                    {ws.memberCount}
                  </Table.Td>
                  <Table.Td label={columns.storage}>
                    <span dir="ltr">
                      {formatBytes(ws.storageUsedBytes)} / {formatBytes(ws.storageQuotaBytes)}
                    </span>
                  </Table.Td>
                  <Table.Td label={columns.status}>
                    <Badge variant={STATUS_BADGE[ws.status]}>
                      {t(`admin.workspaceStatus.${ws.status}`)}
                    </Badge>
                  </Table.Td>
                  <Table.Td label={columns.createdAt}>
                    {formatDate(new Date(ws.createdAt), locale, viewerTimezone, {
                      dateStyle: 'medium',
                    })}
                  </Table.Td>
                  <Table.Actions>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('admin.workspaces.rowActions', { name: ws.name })}
                          ref={(el) => {
                            if (el) menuTriggers.current.set(ws.id, el);
                            else menuTriggers.current.delete(ws.id);
                          }}
                        >
                          <MoreHorizontal aria-hidden="true" className="size-5" />
                        </Button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content align="end">
                        {ws.status === 'ACTIVE' ? (
                          <DropdownMenu.Item
                            destructive
                            icon={<Ban />}
                            onSelect={() => open('suspend', ws)}
                          >
                            {t('admin.workspaces.suspend')}
                          </DropdownMenu.Item>
                        ) : ws.status === 'SUSPENDED' ? (
                          <DropdownMenu.Item
                            icon={<RotateCcw />}
                            onSelect={() => open('reactivate', ws)}
                          >
                            {t('admin.workspaces.reactivate')}
                          </DropdownMenu.Item>
                        ) : null}
                        <DropdownMenu.Item icon={<HardDrive />} onSelect={() => open('quota', ws)}>
                          {t('admin.workspaces.quota')}
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                  </Table.Actions>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Card>

      <AdminReasonDialog
        open={pending?.kind === 'suspend'}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={t('admin.workspaces.confirmSuspend')}
        description={
          pending ? t('admin.workspaces.suspendDescription', { name: pending.ws.name }) : undefined
        }
        submitLabel={t('admin.workspaces.suspend')}
        onCloseAutoFocus={restoreFocus}
        onConfirm={async (reason) => {
          if (!pending) return null;
          const { error } = asApiResult<unknown>(
            await api.POST('/admin/workspaces/{wid}/suspend', {
              params: { path: { wid: pending.ws.id } },
              body: { reason },
            }),
          );
          if (error) return error;
          toast({ title: t('admin.workspaces.suspended'), variant: 'success' });
          workspaces.reload();
          return null;
        }}
      />

      <QuotaDialog
        target={pending?.kind === 'quota' ? pending.ws : null}
        onClose={close}
        onCloseAutoFocus={restoreFocus}
        onSaved={() => {
          close();
          toast({ title: t('admin.workspaces.quotaSaved'), variant: 'success' });
          workspaces.reload();
        }}
      />

      <AlertDialog.Root
        open={pending?.kind === 'reactivate'}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        {pending?.kind === 'reactivate' ? (
          <AlertDialog.Content
            title={t('admin.workspaces.confirmReactivate')}
            description={t('admin.workspaces.reactivateDescription', { name: pending.ws.name })}
            onCloseAutoFocus={restoreFocus}
          >
            <AlertDialog.Footer>
              <AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
              <AlertDialog.Action
                loading={reactivate.busy}
                onClick={(event) => {
                  // Stay open while the request runs; close on the outcome (error → toast).
                  event.preventDefault();
                  void reactivate.submit(pending.ws);
                }}
              >
                {t('admin.workspaces.reactivate')}
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        ) : null}
      </AlertDialog.Root>
    </div>
  );
}
