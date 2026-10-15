'use client';

import {
  LOCALES,
  type MemberSummary,
  type WorkspaceDetail,
  type WorkspaceSettings,
  type WorkspaceStorage,
} from '@tt/contracts';
import { Button, Checkbox, Field, Select, TextInput } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { TimezoneSelect } from './timezone-select';
import { apiErrorMessage, issuesToFieldErrors } from '../lib/api-error';
import { api, asApiResult } from '../lib/api';

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
 * Workspace settings (PRD §9.2/§8.2.1): identity (name, country, default locale/time zone),
 * allowPersonalWorkspaces (ORGANIZATION only), session settings form, storage bar, transfer of
 * ownership (owner, ORGANIZATION only) and deletion (owner, type-the-name confirm).
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
  const isOrg = detail.type === 'ORGANIZATION';
  const isOwner = detail.myRole === 'OWNER';

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
  const [deleteName, setDeleteName] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setFieldErrors({});
    setFormError(null);
    setSaved(false);
    setBusy(true);
    const offsets = reminders
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v));
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
      setBusy(false);
      const mapped = issuesToFieldErrors(error as unknown);
      if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
      else setFormError(apiErrorMessage(t, error as unknown));
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
    setBusy(false);
    if (settingsError) {
      const mapped = issuesToFieldErrors(settingsError as unknown);
      if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
      else setFormError(apiErrorMessage(t, settingsError as unknown));
      return;
    }
    setSaved(true);
  }

  async function transfer() {
    setFormError(null);
    setBusy(true);
    const { error } = asApiResult<unknown>(
      await api.POST('/workspaces/{wid}/transfer-ownership', {
        params: { path: { wid } },
        body: { toUserId: transferTo },
      }),
    );
    setBusy(false);
    if (error) setFormError(apiErrorMessage(t, error as unknown));
    else setSaved(true);
  }

  async function remove() {
    setFormError(null);
    setBusy(true);
    const { error } = asApiResult<unknown>(
      await api.DELETE('/workspaces/{wid}', { params: { path: { wid } } }),
    );
    setBusy(false);
    if (error) setFormError(apiErrorMessage(t, error as unknown));
    else setSaved(true);
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex flex-col gap-4"
      >
        <h2 className="text-xl font-bold">{t('workspace.settingsTitle')}</h2>
        {formError ? (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm text-success">
            {t('workspace.saved')}
          </p>
        ) : null}
        <Field htmlFor="ws-name" label={t('workspace.name')} error={fieldErrors.name}>
          <TextInput
            id="ws-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field htmlFor="ws-country" label={t('workspace.country')} error={fieldErrors.country}>
          <TextInput
            id="ws-country"
            name="country"
            value={country}
            maxLength={2}
            onChange={(e) => setCountry(e.target.value)}
          />
        </Field>
        <Field htmlFor="ws-locale" label={t('workspace.defaultLocale')}>
          <Select
            id="ws-locale"
            value={defaultLocale}
            onChange={(e) => setDefaultLocale(e.target.value as typeof defaultLocale)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l === 'fr' ? 'Français' : l === 'ar' ? 'العربية' : 'English'}
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
        {isOrg ? (
          <>
            <Checkbox
              label={t('workspace.allowPersonal')}
              checked={allowPersonal}
              onChange={(e) => setAllowPersonal(e.target.checked)}
            />
            <p className="text-sm text-gray-500">{t('workspace.allowPersonalNote')}</p>
          </>
        ) : null}

        <h3 className="text-lg font-semibold">{t('workspace.sessionSettings')}</h3>
        <Field
          htmlFor="ws-teacher-join"
          label={t('workspace.teacherJoin')}
          error={fieldErrors.teacher_join_window_min}
        >
          <TextInput
            id="ws-teacher-join"
            type="number"
            value={teacherJoin}
            onChange={(e) => setTeacherJoin(e.target.value)}
          />
        </Field>
        <Field
          htmlFor="ws-student-join"
          label={t('workspace.studentJoin')}
          error={fieldErrors.student_join_window_min}
        >
          <TextInput
            id="ws-student-join"
            type="number"
            value={studentJoin}
            onChange={(e) => setStudentJoin(e.target.value)}
          />
        </Field>
        <Field
          htmlFor="ws-empty-grace"
          label={t('workspace.emptyGrace')}
          error={fieldErrors.empty_room_grace_min}
        >
          <TextInput
            id="ws-empty-grace"
            type="number"
            value={emptyGrace}
            onChange={(e) => setEmptyGrace(e.target.value)}
          />
        </Field>
        <Field
          htmlFor="ws-late"
          label={t('workspace.lateThreshold')}
          error={fieldErrors.late_threshold_min}
        >
          <TextInput
            id="ws-late"
            type="number"
            value={lateThreshold}
            onChange={(e) => setLateThreshold(e.target.value)}
          />
        </Field>
        <Field
          htmlFor="ws-present"
          label={t('workspace.presentRatio')}
          error={fieldErrors.present_ratio}
        >
          <TextInput
            id="ws-present"
            type="number"
            step="0.01"
            value={presentRatio}
            onChange={(e) => setPresentRatio(e.target.value)}
          />
        </Field>
        <Field
          htmlFor="ws-partial"
          label={t('workspace.partialRatio')}
          error={fieldErrors.partial_ratio}
        >
          <TextInput
            id="ws-partial"
            type="number"
            step="0.01"
            value={partialRatio}
            onChange={(e) => setPartialRatio(e.target.value)}
          />
        </Field>
        <Checkbox
          label={t('workspace.sequential')}
          checked={sequential}
          onChange={(e) => setSequential(e.target.checked)}
        />
        <Checkbox
          label={t('workspace.pdfDownload')}
          checked={pdfDownload}
          onChange={(e) => setPdfDownload(e.target.checked)}
        />
        <Field
          htmlFor="ws-reminders"
          label={t('workspace.reminders')}
          error={fieldErrors.default_reminder_offsets_min}
        >
          <TextInput
            id="ws-reminders"
            value={reminders}
            onChange={(e) => setReminders(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>
          {t('workspace.save')}
        </Button>
      </form>

      {storage ? (
        <section aria-label={t('workspace.storage')} className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold">{t('workspace.storage')}</h3>
          <p data-testid="storage-usage">
            {t('workspace.storageUsed', {
              used: formatBytes(storage.usedBytes),
              quota: formatBytes(storage.quotaBytes),
            })}
          </p>
        </section>
      ) : null}

      {isOwner && isOrg ? (
        <section aria-label={t('workspace.transfer')} className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold">{t('workspace.transfer')}</h3>
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
          <Button
            variant="secondary"
            disabled={!transferTo || busy}
            onClick={() => {
              if (window.confirm(t('workspace.transferConfirm', { name: transferTo })))
                void transfer();
            }}
          >
            {t('workspace.transfer')}
          </Button>
        </section>
      ) : null}

      {isOwner ? (
        <section aria-label={t('workspace.delete')} className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold">{t('workspace.delete')}</h3>
          <Field htmlFor="ws-delete" label={t('workspace.deleteConfirm')}>
            <TextInput
              id="ws-delete"
              value={deleteName}
              onChange={(e) => setDeleteName(e.target.value)}
            />
          </Field>
          <Button
            variant="danger"
            disabled={deleteName !== detail.name || busy}
            onClick={() => void remove()}
          >
            {t('workspace.delete')}
          </Button>
        </section>
      ) : null}
    </div>
  );
}
