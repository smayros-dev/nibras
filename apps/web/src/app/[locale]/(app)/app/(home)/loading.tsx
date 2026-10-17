import { PageSkeleton } from '../../../../../components/page-skeleton';

/**
 * Dashboard only: the `(home)` group keeps this Suspense boundary off `w/[wid]/layout.tsx`, whose
 * `notFound()` must run before streaming starts (or the 404 goes out as HTTP 200).
 */
export default function AppLoading() {
  return <PageSkeleton />;
}
