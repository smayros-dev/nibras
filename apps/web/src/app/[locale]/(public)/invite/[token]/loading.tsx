import { PageSkeleton } from '../../../../../components/page-skeleton';

/** While the invitation preview loads (scoped to the page, never above a `notFound()` layout). */
export default function InviteLoading() {
  return <PageSkeleton />;
}
