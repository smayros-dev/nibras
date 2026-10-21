'use client';

import { grantFor } from '@nibras/contracts/web';
import type {
  GrantContext,
  GuardianLinkStatus,
  MembershipStatus,
  StudentCourse,
  StudentProfile,
  StudentSummary,
} from '@nibras/contracts';
import { formatDate } from '@nibras/i18n';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  useSubmit,
  useToast,
  type BadgeVariant,
} from '@nibras/ui';
import { Activity, FileText, Pencil, Plus, Send, UserMinus, Video } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useRouter } from '../i18n/navigation';
import { api, asApiResult } from '../lib/api';
import { apiErrorMessage, issuesToFieldErrors } from '../lib/api-error';
import { membershipStatusBadge } from '../lib/membership-status';
import { useErrorFocus } from '../lib/use-error-focus';
import { AssignCourseDialog } from './courses/assign-course-dialog';
import { CourseStatusBadge } from './courses/course-status-badge';
import { ENROLLMENT_STATUS_LABEL } from './courses/enrollment-status';
import { ProgressBar } from './courses/progress-bar';
import { retryAfterMinutes } from './invitations-list';

/** Memberships a course can be assigned to (the API's rule; consent statuses are pre-assigned). */
const ASSIGNABLE_STATUSES: readonly MembershipStatus[] = [
  'ACTIVE',
  'PENDING_GUARDIAN_CONSENT',
  'SUSPENDED_NO_CONSENT',
];

/** Membership statuses waiting on the guardian: the staff may send the request again (AC-INV-12). */
const CONSENT_STATUSES: readonly MembershipStatus[] = [
  'PENDING_GUARDIAN_CONSENT',
  'SUSPENDED_NO_CONSENT',
  'SUSPENDED_CONSENT_REVOKED',
];

/** A membership that ended: its profile is history, nothing to act on. */
const ENDED_STATUSES: readonly MembershipStatus[] = ['REMOVED', 'REJECTED'];

const GUARDIAN_BADGE: Record<GuardianLinkStatus, BadgeVariant> = {
  PENDING: 'warning',
  ACTIVE: 'success',
  REFUSED: 'danger',
  REVOKED: 'danger',
};

/** The sections later sub-projects fill (sessions, reports, activity), empty for now. */
const LATER_SECTIONS = [
  {
    title: 'students.profile.sessions',
    soon: 'students.profile.sessionsSoon',
    icon: <Video />,
  },
  {
    title: 'students.profile.reports',
    soon: 'students.profile.reportsSoon',
    icon: <FileText />,
  },
  {
    title: 'students.profile.activity',
    soon: 'students.profile.activitySoon',
    icon: <Activity />,
  },
] as const;

/** `fr` → « français » in the viewer's locale (falls back to the code). */
function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** One `dt` / `dd` pair of a profile card. */
function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="text-fg-muted sm:w-44 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

/** A card with an `h3` title, exposed as a named region. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card role="region" aria-labelledby={id}>
      <Card.Header>
        <Card.Title as="h3" id={id}>
          {title}
        </Card.Title>
      </Card.Header>
      <Card.Content className="mt-4 text-sm">{children}</Card.Content>
    </Card>
  );
}

/**
 * A student's profile skeleton (PRD §8.3.1, SP2 design §4.6): the name and membership status, then
 * the Identité card (email when the caller may see it, language, time zone, « Mineur »), the
 * Adhésion card (status, joined, invited by, removed), for a minor the Tuteur card (email — masked
 * for an organisation TEACHER who did not invite him, Q7 —, name, relationship, consent status and
 * dates) with **Renvoyer la demande** (membership waiting on the consent) and **Modifier l'email**
 * (`PATCH …/students/{uid}`, refused once the guardian consented), the assigned teachers in an
 * organisation, the « Cours » card (SP3, `CoursesCard`) and the empty sections the later
 * sub-projects fill. Guardian actions need `student.update`
 * on a writable workspace; the page re-renders from the server after each change.
 */
export function StudentProfilePanel({
  wid,
  uid,
  profile,
  grant,
  writable,
}: {
  wid: string;
  uid: string;
  profile: StudentProfile;
  grant: GrantContext;
  /** `false` on a SUSPENDED / DELETING workspace (the API answers 423). */
  writable: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const { user, membership, guardian } = profile;
  const name = `${user.firstName} ${user.lastName}`;
  const badge = membershipStatusBadge(membership.status);

  const canUpdate =
    writable &&
    grantFor(grant, 'student.update') !== 'none' &&
    !ENDED_STATUSES.includes(membership.status);
  const canResend = canUpdate && guardian !== null && CONSENT_STATUSES.includes(membership.status);
  // A given consent cannot be moved to another address (`409 CONSENT_ALREADY_DECIDED`).
  const canEditEmail = canUpdate && user.isMinor && guardian?.status !== 'ACTIVE';
  const [editOpen, setEditOpen] = useState(false);

  // Resolved after mount: the server has no viewer time zone (no hydration mismatch).
  const [viewerTimezone, setViewerTimezone] = useState('UTC');
  useEffect(() => {
    setViewerTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  const date = (iso: string | null) =>
    iso ? formatDate(new Date(iso), locale, viewerTimezone, { dateStyle: 'medium' }) : '—';

  const resend = useSubmit(async () => {
    let error: unknown;
    try {
      ({ error } = asApiResult<unknown>(
        await api.POST('/workspaces/{wid}/students/{uid}/guardian/resend-consent', {
          params: { path: { wid, uid } },
        }),
      ));
    } catch {
      toast({ title: t('errors.INTERNAL_ERROR'), variant: 'danger' });
      return;
    }
    if (error) {
      const min = retryAfterMinutes(error);
      toast({
        title: min !== null ? t('students.retryIn', { min }) : apiErrorMessage(t, error),
        variant: 'danger',
      });
      return;
    }
    toast({ title: t('students.consentResent'), variant: 'success' });
    router.refresh();
  });

  const teachers = profile.assignedTeachers;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        as="h2"
        title={name}
        description={<Badge variant={badge.variant}>{t(badge.labelKey)}</Badge>}
        breadcrumbs={{
          label: t('students.profile.breadcrumbs'),
          items: [
            <Link key="students" href={`/app/w/${wid}/students`} className="hover:underline">
              {t('workspace.navStudents')}
            </Link>,
            name,
          ],
        }}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section id="profile-identity" title={t('students.profile.identity')}>
          <dl className="flex flex-col gap-2">
            {user.email ? (
              <Item label={t('students.profile.email')}>
                <span className="break-all">{user.email}</span>
              </Item>
            ) : null}
            <Item label={t('students.profile.language')}>{languageName(user.locale, locale)}</Item>
            <Item label={t('students.profile.timezone')}>
              <span dir="ltr">{user.timezone}</span>
            </Item>
          </dl>
          {user.isMinor ? (
            <div>
              <Badge variant="info">{t('students.profile.minor')}</Badge>
            </div>
          ) : null}
        </Section>

        <Section id="profile-membership" title={t('students.profile.membership')}>
          <dl className="flex flex-col gap-2">
            <Item label={t('students.profile.status')}>
              <Badge variant={badge.variant}>{t(badge.labelKey)}</Badge>
            </Item>
            <Item label={t('students.profile.joinedAt')}>{date(membership.joinedAt)}</Item>
            <Item label={t('students.profile.invitedBy')}>
              {membership.invitedBy
                ? `${membership.invitedBy.firstName} ${membership.invitedBy.lastName}`
                : '—'}
            </Item>
            {membership.removedAt ? (
              <Item label={t('students.profile.removedAt')}>{date(membership.removedAt)}</Item>
            ) : null}
          </dl>
        </Section>

        {user.isMinor ? (
          <Section id="profile-guardian" title={t('students.profile.guardian')}>
            {guardian ? (
              <dl className="flex flex-col gap-2">
                <Item label={t('students.profile.guardianEmail')}>
                  <span className="break-all">{guardian.email ?? guardian.emailMasked}</span>
                </Item>
                {guardian.firstName || guardian.lastName ? (
                  <Item label={t('students.profile.guardianName')}>
                    {[guardian.firstName, guardian.lastName].filter(Boolean).join(' ')}
                  </Item>
                ) : null}
                {guardian.relationship ? (
                  <Item label={t('students.profile.relationship')}>
                    {t(`guardian.relationship_${guardian.relationship}`)}
                  </Item>
                ) : null}
                <Item label={t('students.profile.guardianStatus')}>
                  <Badge variant={GUARDIAN_BADGE[guardian.status]}>
                    {t(`guardian.status_${guardian.status}`)}
                  </Badge>
                </Item>
                {guardian.grantedAt ? (
                  <Item label={t('students.profile.grantedAt')}>{date(guardian.grantedAt)}</Item>
                ) : null}
                {guardian.status === 'PENDING' && guardian.consentExpiresAt ? (
                  <Item label={t('students.profile.consentExpiresAt')}>
                    {date(guardian.consentExpiresAt)}
                  </Item>
                ) : null}
                {guardian.revokedAt ? (
                  <Item label={t('students.profile.revokedAt')}>{date(guardian.revokedAt)}</Item>
                ) : null}
              </dl>
            ) : (
              <p className="text-fg-muted">{t('students.profile.noGuardian')}</p>
            )}
            {canResend || canEditEmail ? (
              <div className="flex flex-wrap gap-2">
                {canResend ? (
                  <Button
                    variant="secondary"
                    loading={resend.busy}
                    onClick={() => void resend.submit()}
                  >
                    <Send aria-hidden="true" className="size-4" />
                    {t('students.profile.resendConsent')}
                  </Button>
                ) : null}
                {canEditEmail ? (
                  <Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
                    <Dialog.Trigger asChild>
                      <Button variant="secondary">
                        <Pencil aria-hidden="true" className="size-4" />
                        {t('students.profile.editGuardianEmail')}
                      </Button>
                    </Dialog.Trigger>
                    <Dialog.Content
                      title={t('students.profile.editGuardianTitle', { name })}
                      closeLabel={t('common.close')}
                    >
                      <GuardianEmailForm
                        wid={wid}
                        uid={uid}
                        initial={guardian?.email ?? ''}
                        onSaved={() => {
                          setEditOpen(false);
                          toast({
                            title: t('students.profile.guardianEmailSaved'),
                            variant: 'success',
                          });
                          router.refresh();
                        }}
                      />
                    </Dialog.Content>
                  </Dialog.Root>
                ) : null}
              </div>
            ) : null}
          </Section>
        ) : null}

        {grant.workspaceType === 'ORGANIZATION' ? (
          <Section id="profile-teachers" title={t('students.profile.teachers')}>
            {teachers.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {teachers.map((teacher) => (
                  <li key={teacher.userId}>{`${teacher.firstName} ${teacher.lastName}`}</li>
                ))}
              </ul>
            ) : (
              <p className="text-fg-muted">{t('students.profile.noTeachers')}</p>
            )}
          </Section>
        ) : null}
      </div>

      <CoursesCard
        wid={wid}
        uid={uid}
        name={name}
        courses={profile.courses}
        canManage={
          writable &&
          grantFor(grant, 'enrollment.manage') !== 'none' &&
          !ENDED_STATUSES.includes(membership.status)
        }
        canAssign={ASSIGNABLE_STATUSES.includes(membership.status)}
      />

      <div className="grid gap-6 md:grid-cols-2">
        {LATER_SECTIONS.map((section) => (
          <Card key={section.title} padding="none">
            <EmptyState
              as="h3"
              icon={section.icon}
              title={t(section.title)}
              description={t(section.soon)}
            />
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * The profile's « Cours » card (SP3): the student's courses in this workspace (ACTIVE and REVOKED
 * enrollments, scoped by the API), each with its status and progress, linked to the course's
 * Étudiants tab. With `enrollment.manage` on a writable workspace: **Attribuer un cours**
 * (`AssignCourseDialog`, imported statically: a React.lazy split here re-partitions Turbopack's
 * shared chunks and adds ≈ 12 kB to every workspace route) and **Retirer** on an ACTIVE enrollment (`AlertDialog`,
 * `DELETE …/enrollments/{uid}`); the page re-renders from the server after each change.
 */
function CoursesCard({
  wid,
  uid,
  name,
  courses,
  canManage,
  canAssign,
}: {
  wid: string;
  uid: string;
  name: string;
  courses: StudentCourse[];
  canManage: boolean;
  canAssign: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { toast } = useToast();
  /** `null` until first opened: the dialog (and its course query) mounts then. */
  const [assignOpen, setAssignOpen] = useState<boolean | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<StudentCourse | null>(null);

  const revoke = useSubmit(async (course: StudentCourse) => {
    try {
      const { error } = asApiResult<unknown>(
        await api.DELETE('/workspaces/{wid}/courses/{cid}/enrollments/{uid}', {
          params: { path: { wid, cid: course.courseId, uid } },
          body: {},
        }),
      );
      if (error) {
        toast({ title: apiErrorMessage(t, error), variant: 'danger' });
        return;
      }
    } catch {
      toast({ title: t('errors.INTERNAL_ERROR'), variant: 'danger' });
      return;
    }
    toast({ title: t('enrollments.revoked'), variant: 'success' });
    router.refresh();
  });

  return (
    <Section id="profile-courses" title={t('students.profile.courses')}>
      {courses.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {courses.map((c) => (
            <li
              key={c.courseId}
              className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link
                  href={`/app/w/${wid}/courses/${c.courseId}/students`}
                  className="font-medium break-words hover:underline"
                >
                  {c.title}
                </Link>
                <span className="flex flex-wrap gap-1">
                  <CourseStatusBadge status={c.status} />
                  {c.enrollmentStatus === 'REVOKED' ? (
                    <Badge variant="neutral">{t(ENROLLMENT_STATUS_LABEL.REVOKED)}</Badge>
                  ) : null}
                </span>
              </div>
              <ProgressBar
                percent={c.progressPercent}
                label={t('enrollments.progressOf', { name: c.title })}
              />
              {canManage && c.enrollmentStatus === 'ACTIVE' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('enrollments.revokeCourse', { title: c.title })}
                  onClick={() => setRevokeTarget(c)}
                >
                  <UserMinus aria-hidden="true" className="size-4" />
                  {t('students.remove')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-muted">{t('enrollments.noCourses')}</p>
      )}
      {canManage && canAssign ? (
        <div>
          <Button variant="secondary" onClick={() => setAssignOpen(true)}>
            <Plus aria-hidden="true" className="size-4" />
            {t('enrollments.assignCourse')}
          </Button>
        </div>
      ) : null}

      {canManage && canAssign && assignOpen !== null ? (
        <AssignCourseDialog
          wid={wid}
          uid={uid}
          name={name}
          enrolledCourseIds={courses
            .filter((c) => c.enrollmentStatus === 'ACTIVE')
            .map((c) => c.courseId)}
          open={assignOpen}
          onOpenChange={setAssignOpen}
          onAssigned={() => router.refresh()}
        />
      ) : null}

      <AlertDialog.Root
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        {revokeTarget ? (
          <AlertDialog.Content
            title={t('enrollments.revokeTitle', { name, title: revokeTarget.title })}
            description={t('enrollments.revokeDescription')}
          >
            <AlertDialog.Footer>
              <AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
              <AlertDialog.Action
                destructive
                loading={revoke.busy}
                onClick={(event) => {
                  // Stay open while the request runs; close on the outcome (error → toast).
                  event.preventDefault();
                  const target = revokeTarget;
                  void revoke.submit(target).finally(() => setRevokeTarget(null));
                }}
              >
                {t('enrollments.revokeConfirm', { name })}
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        ) : null}
      </AlertDialog.Root>
    </Section>
  );
}

/** The guardian email of a minor (`PATCH …/students/{uid}`); the previous links stop working. */
function GuardianEmailForm({
  wid,
  uid,
  initial,
  onSaved,
}: {
  wid: string;
  uid: string;
  initial: string;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const [email, setEmail] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);

  const save = useSubmit(async () => {
    setFieldErrors({});
    setFormError(null);
    let error: unknown;
    try {
      ({ error } = asApiResult<StudentSummary>(
        await api.PATCH('/workspaces/{wid}/students/{uid}', {
          params: { path: { wid, uid } },
          body: { guardianEmail: email.trim().toLowerCase() },
        }),
      ));
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    if (error) {
      const code = (error as { code?: string }).code;
      const mapped = issuesToFieldErrors(t, error);
      if (mapped.guardianEmail) setFieldErrors({ guardianEmail: mapped.guardianEmail });
      else if (code === 'GUARDIAN_EMAIL_INVALID')
        setFieldErrors({ guardianEmail: apiErrorMessage(t, error) });
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
        htmlFor="profile-guardian-email"
        label={t('students.profile.guardianEmail')}
        description={t('students.profile.guardianEmailHint')}
        error={fieldErrors.guardianEmail}
        required
      >
        <Input
          id="profile-guardian-email"
          name="guardianEmail"
          type="email"
          autoComplete="off"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>
      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="secondary">{t('common.cancel')}</Button>
        </Dialog.Close>
        <Button type="submit" variant="primary" loading={save.busy} disabled={email.trim() === ''}>
          {t('invitations.save')}
        </Button>
      </Dialog.Footer>
    </form>
  );
}
