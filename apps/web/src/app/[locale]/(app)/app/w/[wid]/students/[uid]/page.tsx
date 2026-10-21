import type { StudentProfile, WorkspaceDetail } from '@nibras/contracts';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../../../../lib/api';
import { StudentProfilePanel } from '../../../../../../../../components/student-profile-panel';

/**
 * A student's profile (PRD §8.3.1; SP2 design §4.6, skeleton the later sub-projects fill). Same
 * 404 as the students page for a role without it; an unknown student, or one outside the caller's
 * scope (organisation TEACHER: his assigned or invited students), is the API's 404.
 */
export default async function StudentProfilePage({
  params,
}: {
  params: Promise<{ locale: string; wid: string; uid: string }>;
}) {
  const { locale, wid, uid } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const client = await serverApi();
  const [{ data: detail }, { data: profile }] = await Promise.all([
    client
      .GET('/workspaces/{wid}', { params: { path: { wid } } })
      .then((result) => asApiResult<WorkspaceDetail>(result)),
    client
      .GET('/workspaces/{wid}/students/{uid}/profile', { params: { path: { wid, uid } } })
      .then((result) => asApiResult<StudentProfile>(result)),
  ]);
  if (!detail || !profile || !['OWNER', 'ADMIN', 'TEACHER'].includes(detail.myRole)) notFound();
  return (
    <StudentProfilePanel
      wid={wid}
      uid={uid}
      profile={profile}
      grant={{ role: detail.myRole, canTeach: detail.myCanTeach, workspaceType: detail.type }}
      writable={detail.status === 'ACTIVE'}
    />
  );
}
