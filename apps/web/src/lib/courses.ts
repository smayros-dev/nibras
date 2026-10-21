'use client';

import type { CourseDetail } from '@nibras/contracts';
import type { Locale } from '@nibras/contracts/web';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, asApiResult } from './api';

/** Language names in their own script (the course's teaching language, not the UI's). */
export const LANGUAGE_NAMES: Record<Locale, string> = {
  fr: 'Français',
  ar: 'العربية',
  en: 'English',
};

/**
 * The `If-Match` header of a course write (D-P14): the version the page holds, quoted like the
 * `ETag` the API sends. `params: { path, header: withIfMatch(version) }`.
 */
export function withIfMatch(version: number): { 'If-Match': string } {
  return { 'If-Match': `"${version}"` };
}

/** `currentVersion` of a `409 VERSION_CONFLICT` body, or `null` for any other error. */
export function conflictVersion(error: unknown): number | null {
  const body = error as { code?: string; details?: { currentVersion?: unknown } } | null;
  if (body?.code !== 'VERSION_CONFLICT') return null;
  const v = body.details?.currentVersion;
  return typeof v === 'number' ? v : null;
}

export interface CourseState {
  wid: string;
  /** False on a SUSPENDED/DELETING workspace (read-only, 423 on writes). */
  writable: boolean;
  /** The course as last answered by the API; `course.version` is the `If-Match` of the next write. */
  course: CourseDetail;
  /** Replaces the held course with a write's answer (its version follows the `ETag`). */
  setCourse: (course: CourseDetail) => void;
  /** Fetches the course again; `null` when it is gone or the request failed. */
  reload: () => Promise<CourseDetail | null>;
}

const CourseContext = createContext<CourseState | null>(null);

/**
 * The course page's store (spec: `useCourseVersion`): the course layout fetches it server-side and
 * every tab reads and updates it here, so each write sends the version of the latest answer.
 */
export function CourseProvider({
  wid,
  writable,
  initial,
  children,
}: {
  wid: string;
  writable: boolean;
  initial: CourseDetail;
  children: ReactNode;
}) {
  const [course, setCourse] = useState(initial);
  const cid = initial.id;
  const reload = useCallback(async () => {
    try {
      const { data } = asApiResult<CourseDetail>(
        await api.GET('/workspaces/{wid}/courses/{cid}', { params: { path: { wid, cid } } }),
      );
      if (data) setCourse(data);
      return data ?? null;
    } catch {
      return null;
    }
  }, [wid, cid]);
  const value = useMemo(
    () => ({ wid, writable, course, setCourse, reload }),
    [wid, writable, course, reload],
  );
  return createElement(CourseContext.Provider, { value }, children);
}

export function useCourse(): CourseState {
  const state = useContext(CourseContext);
  if (!state) throw new Error('useCourse outside CourseProvider');
  return state;
}

/** A structure write sent with the given course version (`If-Match`). */
export type CourseWrite = (version: number) => Promise<{ data?: unknown; error?: unknown }>;

/**
 * The outcome of a structure write run by the editor: done (the structure was reloaded), or the
 * API error — `conflict` when it was a `409 VERSION_CONFLICT`, which the editor's conflict dialog
 * now handles (the form closes and lets it).
 */
export type WriteOutcome = { ok: true } | { ok: false; conflict: boolean; error: unknown };
