'use client';

import type { CreateInviteLinkInput, InviteLink, InviteLinkStatus } from '@nibras/contracts';
import { INVITE_LINK_DEFAULT_MAX_USES } from '@nibras/contracts/web';
import { formatDate } from '@nibras/i18n';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  useSubmit,
  useToast,
  type BadgeVariant,
} from '@nibras/ui';
import { Ban, Copy } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { api, asApiResult } from '../lib/api';
import { apiErrorMessage, issuesToFieldErrors } from '../lib/api-error';
import { useAbortableQuery } from '../lib/paged-fetch';
import { useErrorFocus } from '../lib/use-error-focus';
import { useReturnFocus } from '../lib/use-return-focus';

const STATUS_BADGE: Record<InviteLinkStatus, BadgeVariant> = {
  ACTIVE: 'success',
  DISABLED: 'neutral',
  EXHAUSTED: 'warning',
  EXPIRED: 'warning',
};

const FIELDS = ['label', 'maxUses', 'expiresAt', 'requiresApproval'];

/**
 * « Lien de groupe » on the students page (AC-INV-08, D-P18): the workspace's group codes with
 * their public join URL (**Copier**, `navigator.clipboard`), uses `{usesCount}/{maxUses}`, expiry,
 * status and approval; **Désactiver** behind an `AlertDialog` (`DELETE` keeps the row, status
 * `DISABLED`); the **Créer un lien** form (libellé, nombre d'utilisations, expiration — the
 * server's 30-day default when empty —, approbation requise, on by default in an organisation).
 * `canManage` false (no `student.invite`, read-only workspace) lists only.
 */
export function InviteLinkCard({
  wid,
  isOrg,
  canManage,
}: {
  wid: string;
  isOrg: boolean;
  canManage: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { toast } = useToast();
  const titleId = useId();
  const returnFocus = useReturnFocus();
  const [disableTarget, setDisableTarget] = useState<InviteLink | null>(null);

  const links = useAbortableQuery([wid], async (signal) => {
    let result;
    try {
      result = asApiResult<InviteLink[]>(
        await api.GET('/workspaces/{wid}/invite-links', { params: { path: { wid } }, signal }),
      );
    } catch {
      throw new Error(t('errors.INTERNAL_ERROR'));
    }
    if (result.error) throw new Error(apiErrorMessage(t, result.error));
    return result.data ?? [];
  });

  // Resolved after mount: the server has no viewer time zone (no hydration mismatch).
  const [viewerTimezone, setViewerTimezone] = useState('UTC');
  useEffect(() => {
    setViewerTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  const copy = async (link: InviteLink) => {
    try {
      await navigator.clipboard.writeText(link.url);
      toast({ title: t('inviteLinks.copied'), variant: 'success' });
    } catch {
      toast({ title: t('inviteLinks.copyFailed'), variant: 'danger' });
    }
  };

  const disable = useSubmit(async (link: InviteLink) => {
    try {
      const { error } = asApiResult<unknown>(
        await api.DELETE('/workspaces/{wid}/invite-links/{id}', {
          params: { path: { wid, id: link.id } },
        }),
      );
      if (error) {
        toast({ title: apiErrorMessage(t, error), variant: 'danger' });
        return;
      }
    } catch {
      toast({ title: t('errors.INTERNAL_ERROR'), variant: 'danger' });
      return;
    } finally {
      links.reload();
    }
    toast({ title: t('inviteLinks.disabled'), variant: 'success' });
  });

  const list = links.data;

  return (
    <Card aria-labelledby={titleId} data-testid="invite-link-card">
      <Card.Header>
        <Card.Title as="h3" id={titleId}>
          {t('inviteLinks.title')}
        </Card.Title>
        <Card.Description>{t('inviteLinks.description')}</Card.Description>
      </Card.Header>

      {links.error ? <Alert variant="danger">{links.error}</Alert> : null}
      {list && list.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('inviteLinks.empty')}</p>
      ) : null}
      {list && list.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border" aria-busy={links.loading}>
          {list.map((link) => (
            <li
              key={link.id}
              className="flex flex-col gap-2 py-3"
              data-testid={`invite-link-${link.id}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-base font-semibold tracking-wider" dir="ltr">
                  {link.code}
                </span>
                {link.label ? <span className="text-fg">{link.label}</span> : null}
                <Badge variant={STATUS_BADGE[link.status]}>
                  {t(`inviteLinks.status_${link.status}`)}
                </Badge>
              </div>
              <span className="text-sm break-all text-fg-muted" dir="ltr">
                {link.url}
              </span>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
                <li>{t('inviteLinks.uses', { used: link.usesCount, max: link.maxUses })}</li>
                <li>
                  {link.expiresAt
                    ? t('inviteLinks.expires', {
                        date: formatDate(new Date(link.expiresAt), locale, viewerTimezone, {
                          dateStyle: 'medium',
                        }),
                      })
                    : t('inviteLinks.noExpiry')}
                </li>
                <li>
                  {link.requiresApproval ? t('inviteLinks.approval') : t('inviteLinks.noApproval')}
                </li>
              </ul>
              <div className="flex flex-wrap gap-2">
                {link.status === 'ACTIVE' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t('inviteLinks.copy', { code: link.code })}
                    onClick={() => void copy(link)}
                  >
                    <Copy aria-hidden="true" className="size-4" />
                    {t('inviteLinks.copyLabel')}
                  </Button>
                ) : null}
                {canManage && link.status === 'ACTIVE' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    ref={returnFocus.register(link.id)}
                    aria-label={t('inviteLinks.disableFor', { code: link.code })}
                    onClick={() => {
                      returnFocus.remember(link.id);
                      setDisableTarget(link);
                    }}
                  >
                    <Ban aria-hidden="true" className="size-4" />
                    {t('inviteLinks.disableConfirm')}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {canManage ? (
        <CreateInviteLinkForm wid={wid} isOrg={isOrg} onCreated={() => links.reload()} />
      ) : null}

      <AlertDialog.Root
        open={disableTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDisableTarget(null);
        }}
      >
        {disableTarget ? (
          <AlertDialog.Content
            title={t('inviteLinks.disableTitle', { code: disableTarget.code })}
            description={t('inviteLinks.disableDescription')}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          >
            <AlertDialog.Footer>
              <AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
              <AlertDialog.Action
                destructive
                loading={disable.busy}
                onClick={(event) => {
                  event.preventDefault();
                  const target = disableTarget;
                  void disable.submit(target).finally(() => setDisableTarget(null));
                }}
              >
                {t('inviteLinks.disableConfirm')}
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        ) : null}
      </AlertDialog.Root>
    </Card>
  );
}

/** **Créer un lien** (`POST /invite-links`); empty fields fall back to the server defaults. */
function CreateInviteLinkForm({
  wid,
  isOrg,
  onCreated,
}: {
  wid: string;
  isOrg: boolean;
  onCreated: () => void;
}) {
  const t = useTranslations();
  const { toast } = useToast();
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState(String(INVITE_LINK_DEFAULT_MAX_USES));
  const [expiresAt, setExpiresAt] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(isOrg);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);
  const today = new Date().toISOString().slice(0, 10);

  const create = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    const uses = maxUses.trim() === '' ? undefined : Number(maxUses);
    const body = {
      ...(label.trim() ? { label: label.trim() } : {}),
      requiresApproval,
      courseIds: [],
      ...(uses !== undefined ? { maxUses: Number.isFinite(uses) ? uses : null } : {}),
      // The chosen day, until its end (UTC).
      ...(expiresAt ? { expiresAt: `${expiresAt}T23:59:59.000Z` } : {}),
    };
    let error: unknown;
    try {
      ({ error } = asApiResult<InviteLink>(
        await api.POST('/workspaces/{wid}/invite-links', {
          params: { path: { wid } },
          // `maxUses: null` (not a number) is sent as is: the API's issue names the field.
          body: body as CreateInviteLinkInput,
        }),
      ));
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    if (error) {
      const mapped = issuesToFieldErrors(t, error);
      const onFields = Object.fromEntries(
        Object.entries(mapped).filter(([field]) => FIELDS.includes(field)),
      );
      if (Object.keys(onFields).length > 0) setFieldErrors(onFields);
      else setFormError(apiErrorMessage(t, error));
      return;
    }
    setLabel('');
    setExpiresAt('');
    toast({ title: t('inviteLinks.created'), variant: 'success' });
    onCreated();
  });

  return (
    <form
      method="post"
      ref={formRef}
      noValidate
      aria-labelledby="invite-link-new"
      className="flex flex-col gap-4 border-t border-border pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        void create.submit();
      }}
    >
      <h4 id="invite-link-new" className="font-semibold text-fg">
        {t('inviteLinks.newLink')}
      </h4>
      {formError ? (
        <Alert ref={alertRef} tabIndex={-1} variant="danger">
          {formError}
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field htmlFor="invite-link-label" label={t('inviteLinks.label')} error={fieldErrors.label}>
          <Input
            id="invite-link-label"
            name="label"
            maxLength={80}
            autoComplete="off"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field
          htmlFor="invite-link-max-uses"
          label={t('inviteLinks.maxUses')}
          error={fieldErrors.maxUses}
        >
          <Input
            id="invite-link-max-uses"
            name="maxUses"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
          />
        </Field>
        <Field
          htmlFor="invite-link-expires"
          label={t('inviteLinks.expiresAt')}
          description={t('inviteLinks.expiresHint')}
          error={fieldErrors.expiresAt}
        >
          <Input
            id="invite-link-expires"
            name="expiresAt"
            type="date"
            min={today}
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </Field>
      </div>
      <Checkbox
        id="invite-link-approval"
        label={t('inviteLinks.requiresApproval')}
        description={t('inviteLinks.requiresApprovalHint')}
        checked={requiresApproval}
        onCheckedChange={(checked) => setRequiresApproval(checked === true)}
      />
      <div>
        <Button type="submit" variant="primary" loading={create.busy}>
          {t('inviteLinks.create')}
        </Button>
      </div>
    </form>
  );
}
