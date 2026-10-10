import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/** Locale-aware `Link` / `usePathname`, kept apart from `routing.ts` so the proxy does not bundle React. */
export const { Link, usePathname } = createNavigation(routing);
