import { sanitizeNext } from '../../../../../lib/sanitize-next';
import { ResumeClient } from './resume-client';

/**
 * Landing spot of a server navigation whose access cookie expired: only the browser holds the
 * refresh cookie (path `/api/v1/auth`), so the refresh happens here, then the user goes back.
 */
export default async function ResumePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return <ResumeClient next={sanitizeNext(typeof next === 'string' ? next : null) ?? '/app'} />;
}
