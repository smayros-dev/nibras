'use client';

import {
  LOCALES,
  type MemberSummary,
  type MembershipRole,
  type WorkspaceDetail,
  type WorkspaceSettings,
  type WorkspaceStorage,
} from '@tt/contracts';
import {
  Alert,
  AlertDialog,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Select,
  useSubmit,
  useToast,
} from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CountrySelect } from './country-select';
import { TimezoneSelect } from './timezone-select';
import { useRouter } from '../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../lib/api-error';
import { api, asApiResult } from '../lib/api';

const LANGUAGE_NAMES: Record<(typeof LOCALES)[number], string> = {
  fr: 'Français',
  ar: 'العربية',
  en: 'English',
};

/** Roles that may edit the workspace (`workspace.settings.manage`); the API stays the authority. */
const EDITOR_ROLES: readonly MembershipRole[] = ['OWNER', 'ADMIN'];

function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return value;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n.toFixed(n < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

/**
 * Workspace settings (PRD §9.2/§8.2.1): identity (name, country, default locale/time zone,
 * allowPersonalWorkspaces for an ORGANIZATION) and session defaults in one form, the storage
 * card, transfer of ownership (owner, ORGANIZATION only, confirmed in an `AlertDialog`) and
 * deletion (owner, type-the-name confirm). Members other than OWNER/ADMIN see the form read-only.
 */
export function WorkspaceSettingsPanel({
  wid,
  detail,
  settings,
  storage,
  admins,
}: {
  wid: string;
  detail: WorkspaceDetail;
  settings: WorkspaceSettings;
  storage: WorkspaceStorage | null;
  admins: MemberSummary[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const { toast } = useToast();
  const isOrg = detail.type === 'ORGANIZATION';
  const isOwner = detail.myRole === 'OWNER';
  const canEdit = EDITOR_ROLES.includes(detail.myRole);

  const [name, setName] = useState(detail.name);
  const [country, setCountry] = useState(detail.country ?? '');
  const [defaultLocale, setDefaultLocale] = useState(detail.defaultLocale);
  const [defaultTimezone, setDefaultTimezone] = useState(detail.defaultTimezone);
  const [allowPersonal, setAllowPersonal] = useState(detail.allowPersonalWorkspaces);

  const [teacherJoin, setTeacherJoin] = useState(String(settings.teacher_join_window_min));
  const [studentJoin, setStudentJoin] = useState(String(settings.student_join_window_min));
  const [emptyGrace, setEmptyGrace] = useState(String(settings.empty_room_grace_min));
  const [lateThreshold, setLateThreshold] = useState(String(settings.late_threshold_min));
  const [presentRatio, setPresentRatio] = useState(String(settings.present_ratio));
  const [partialRatio, setPartialRatio] = useState(String(settings.partial_ratio));
  const [sequential, setSequential] = useState(settings.default_sequential_lessons);
  const [pdfDownload, setPdfDownload] = useState(settings.default_pdf_download);
  const [reminders, setReminders] = useState(settings.default_reminder_offsets_min.join(', '));

  const [transferTo, setTransferTo] = useState('');
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteName, setDeleteName] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /** Field errors inline when the API names fields, else one form-level message. */
  function showError(error: unknown) {
    const mapped = issuesToFieldErrors(t, error);
    if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
    else setFormError(apiErrorMessage(t, error));
  }

  const save = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    const offsets = reminders
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v));
    try {
      const { error } = asApiResult<WorkspaceDetail>(
        await api.PATCH('/workspaces/{wid}', {
          params: { path: { wid } },
          body: {
            name,
            country: country ? country.toUpperCase() : null,
            defaultLocale,
            defaultTimezone,
            ...(isOrg ? { allowPersonalWorkspaces: allowPersonal } : {}),
          },
        }),
      );
      if (error) {
        showError(error);
        return;
      }
      const { error: settingsError } = asApiResult<WorkspaceSettings>(
        await api.PATCH('/workspaces/{wid}/settings', {
          params: { path: { wid } },
          body: {
            default_timezone: defaultTimezone,
            teacher_join_window_min: Number(teacherJoin),
            student_join_window_min: Number(studentJoin),
            empty_room_grace_min: Number(emptyGrace),
            late_threshold_min: Number(lateThreshold),
            present_ratio: Number(presentRatio),
            partial_ratio: Number(partialRatio),
            default_sequential_lessons: sequential,
            default_pdf_download: pdfDownload,
            default_reminder_offsets_min: offsets,
          },
        }),
      );
      if (settingsError) {
        showError(settingsError);
        return;
      }
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    toast({ title: t('workspace.saved'), variant: 'success' });
    // The header, switcher and sidebar show the name.
    router.refresh();
  });

  const transfer = useSubmit(async () => {
    setActionError(null);
    try {
      const { error } = asApiResult<unknown>(
        await api.POST('/workspaces/{wid}/transfer-ownership', {
          params: { path: { wid } },
          body: { toUserId: transferTo },
        }),
      );
      if (error) {
        setActionError(apiErrorMessage(t, error));
        return;
      }
    } catch {
      setActionError(t('errors.INTERNAL_ERROR'));
      return;
    } finally {
      setTransferOpen(false);
    }
    toast({ title: t('workspace.transferDone'), variant: 'success' });
    router.refresh();
  });

  const remove = useSubmit(async () => {
    setActionError(null);
    try {
      const { error } = asApiResult<unknown>(
        await api.DELETE('/workspaces/{wid}', { params: { path: { wid } } }),
      );
      if (error) {
        setActionError(apiErrorMessage(t, error));
        return;
      }
    } catch {
      setActionError(t('errors.INTERNAL_ERROR'));
      return;
    }
    toast({ title: t('workspace.deleteDone'), variant: 'success' });
    router.refresh();
  });

  const transferTarget = admins.find((member) => member.userId === transferTo);
  const usedRatio = storage
    ? Math.min(1, Number(storage.usedBytes) / Math.max(1, Number(storage.quotaBytes)))
    : 0;

  const numberField = (
    id: string,
    field: keyof WorkspaceSettings,
    label: string,
    value: string,
    onChange: (value: string) => void,
    step?: string,
  ) => (
    <Field htmlFor={id} label={label} error={fieldErrors[field]}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h2 className="text-xl font-semibold text-fg">{t('workspace.settingsTitle')}</h2>
      {canEdit ? null : <Alert variant="info">{t('workspace.readOnly')}</Alert>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save.submit();
        }}
        className="flex flex-col gap-6"
      >
        {formError ? <Alert variant="danger">{formError}</Alert> : null}
        <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-6">
          <Card>
            <Card.Header>
              <Card.Title as="h3">{t('workspace.identity')}</Card.Title>
            </Card.Header>
            <Field htmlFor="ws-name" label={t('workspace.name')} error={fieldErrors.name}>
              <Input
                id="ws-name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>
            <Field htmlFor="ws-country" label={t('workspace.country')} error={fieldErrors.country}>
              <CountrySelect id="ws-country" value={country} onChange={setCountry} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                htmlFor="ws-locale"
                label={t('workspace.defaultLocale')}
                error={fieldErrors.defaultLocale}
              >
                <Select
                  id="ws-locale"
                  value={defaultLocale}
                  onChange={(e) => setDefaultLocale(e.target.value as typeof defaultLocale)}
                >
                  {LOCALES.map((l) => (
                    <option key={l} value={l} lang={l}>
                      {LANGUAGE_NAMES[l]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                htmlFor="ws-timezone"
                label={t('workspace.defaultTimezone')}
                error={fieldErrors.defaultTimezone}
              >
                <TimezoneSelect
                  id="ws-timezone"
                  value={defaultTimezone}
                  onChange={(e) => setDefaultTimezone(e.target.value)}
                />
              </Field>
            </div>
            {isOrg ? (
              <Checkbox
                label={t('workspace.allowPersonal')}
                description={t('workspace.allowPersonalNote')}
                checked={allowPersonal}
                onCheckedChange={(checked) => setAllowPersonal(checked === true)}
              />
            ) : null}
          </Card>

          <Card>
            <Card.Header>
              <Card.Title as="h3">{t('workspace.sessionSettings')}</Card.Title>
            </Card.Header>
            <div className="grid gap-4 sm:grid-cols-2">
              {numberField(
                'ws-teacher-join',
                'teacher_join_window_min',
                t('workspace.teacherJoin'),
                teacherJoin,
                setTeacherJoin,
              )}
              {numberField(
                'ws-student-join',
                'student_join_window_min',
                t('workspace.studentJoin'),
                studentJoin,
                setStudentJoin,
              )}
              {numberField(
                'ws-empty-grace',
                'empty_room_grace_min',
                t('workspace.emptyGrace'),
                emptyGrace,
                setEmptyGrace,
              )}
              {numberField(
                'ws-late',
                'late_threshold_min',
                t('workspace.lateThreshold'),
                lateThreshold,
                setLateThreshold,
              )}
              {numberField(
                'ws-present',
                'present_ratio',
                t('workspace.presentRatio'),
                presentRatio,
                setPresentRatio,
                '0.01',
              )}
              {numberField(
                'ws-partial',
                'partial_ratio',
                t('workspace.partialRatio'),
                partialRatio,
                setPartialRatio,
                '0.01',
              )}
            </div>
            <Checkbox
              label={t('workspace.sequential')}
              checked={sequential}
              onCheckedChange={(checked) => setSequential(checked === true)}
            />
            <Checkbox
              label={t('workspace.pdfDownload')}
              checked={pdfDownload}
              onCheckedChange={(checked) => setPdfDownload(checked === true)}
            />
            <Field
              htmlFor="ws-reminders"
              label={t('workspace.reminders')}
              error={fieldErrors.default_reminder_offsets_min}
            >
              <Input
                id="ws-reminders"
                inputMode="numeric"
                value={reminders}
                onChange={(e) => setReminders(e.target.value)}
              />
            </Field>
          </Card>
        </fieldset>
        {canEdit ? (
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={save.busy}>
              {t('workspace.save')}
            </Button>
          </div>
        ) : null}
      </form>

      {storage ? (
        <Card aria-labelledby="ws-storage-title">
          <Card.Header>
            <Card.Title as="h3" id="ws-storage-title">
              {t('workspace.storage')}
            </Card.Title>
          </Card.Header>
          <p data-testid="storage-usage" className="tabular-nums">
            {t('workspace.storageUsed', {
              used: formatBytes(storage.usedBytes),
              quota: formatBytes(storage.quotaBytes),
            })}
          </p>
          <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-bg-subtle">
            <div
              className="h-full rounded-full bg-primary"
              style={{ inlineSize: `${Math.round(usedRatio * 100)}%` }}
            />
          </div>
        </Card>
      ) : null}

      {actionError ? <Alert variant="danger">{actionError}</Alert> : null}

      {isOwner && isOrg ? (
        <Card aria-labelledby="ws-transfer-title">
          <Card.Header>
            <Card.Title as="h3" id="ws-transfer-title">
              {t('workspace.transfer')}
            </Card.Title>
          </Card.Header>
          <Field htmlFor="ws-transfer" label={t('workspace.transferTo')}>
            <Select
              id="ws-transfer"
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
            >
              <option value="">—</option>
              {admins.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.firstName} {member.lastName}
                </option>
              ))}
            </Select>
          </Field>
          <AlertDialog.Root open={transferOpen} onOpenChange={setTransferOpen}>
            <Card.Footer>
              <AlertDialog.Trigger asChild>
                <Button variant="secondary" disabled={!transferTarget}>
                  {t('workspace.transfer')}
                </Button>
              </AlertDialog.Trigger>
            </Card.Footer>
            <AlertDialog.Content
              title={t('workspace.transferConfirm', {
                name: transferTarget
                  ? `${transferTarget.firstName} ${transferTarget.lastName}`
                  : '',
              })}
            >
              <AlertDialog.Footer>
                <AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
                <AlertDialog.Action
                  destructive
                  loading={transfer.busy}
                  onClick={(event) => {
                    event.preventDefault();
                    void transfer.submit();
                  }}
                >
                  {t('workspace.transfer')}
                </AlertDialog.Action>
              </AlertDialog.Footer>
            </AlertDialog.Content>
          </AlertDialog.Root>
        </Card>
      ) : null}

      {isOwner ? (
        <Card aria-labelledby="ws-delete-title" className="border-danger">
          <Card.Header>
            <Card.Title as="h3" id="ws-delete-title">
              {t('workspace.dangerZone')}
            </Card.Title>
          </Card.Header>
          <Field htmlFor="ws-delete" label={t('workspace.deleteConfirm')}>
            <Input
              id="ws-delete"
              autoComplete="off"
              value={deleteName}
              onChange={(e) => setDeleteName(e.target.value)}
            />
          </Field>
          <Card.Footer>
            <Button
              variant="danger"
              disabled={deleteName !== detail.name}
              loading={remove.busy}
              onClick={() => void remove.submit()}
            >
              {t('workspace.delete')}
            </Button>
          </Card.Footer>
        </Card>
      ) : null}
    </div>
  );
}
