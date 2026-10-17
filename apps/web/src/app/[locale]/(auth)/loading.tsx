import { PageSkeleton } from '../../../components/page-skeleton';

/**
 * Auth screen transitions. Scoped to `(auth)`, never at the `[locale]` level: a Suspense boundary
 * above a layout that calls `notFound()` (admin) or above the `[...rest]` catch-all starts the
 * stream first and turns every 404 into an HTTP 200.
 */
export default function AuthLoading() {
  return <PageSkeleton />;
}
