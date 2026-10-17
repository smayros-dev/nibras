import { PageSkeleton } from '../../components/page-skeleton';

/** Page transitions outside the app frame (landing, auth screens). */
export default function LocaleLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <PageSkeleton />
    </div>
  );
}
