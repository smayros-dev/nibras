import type { CourseDetail, WorkspaceDetail } from '@nibras/contracts';
import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { routing } from '../../../../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../../../../lib/api';
import { CourseProvider } from '../../../../../../../../lib/courses';
import { getSession } from '../../../../../../../../lib/session';
import { CourseFrame } from '../../../../../../../../components/courses/course-frame';

/**
 * A course page (PRD §8.4.1; SP3): the course is fetched here once (`GET …/courses/{cid}`, scoped
 * by the API: an organisation TEACHER reaches his own courses only, anything else is a 404) and
 * held by `CourseProvider` for the header and the Structure · Étudiants · Paramètres tabs, so
 * every write sends the version of the latest answer (`If-Match`).
 */
export default async function CourseLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; wid: string; cid: string }>;
}) {
  const { locale, wid, cid } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const client = await serverApi();
  const [{ data: detail }, { data: course }, me] = await Promise.all([
    client
      .GET('/workspaces/{wid}', { params: { path: { wid } } })
      .then((result) => asApiResult<WorkspaceDetail>(result)),
    client
      .GET('/workspaces/{wid}/courses/{cid}', { params: { path: { wid, cid } } })
      .then((result) => asApiResult<CourseDetail>(result)),
    getSession(),
  ]);
  if (!detail || !course || !me || !['OWNER', 'ADMIN', 'TEACHER'].includes(detail.myRole)) {
    notFound();
  }
  return (
    <CourseProvider key={cid} wid={wid} writable={detail.status === 'ACTIVE'} initial={course}>
      <CourseFrame
        meId={me.id}
        grant={{ role: detail.myRole, canTeach: detail.myCanTeach, workspaceType: detail.type }}
      >
        {children}
      </CourseFrame>
    </CourseProvider>
  );
}
