import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  INLINE_URL_TTL_S,
  collectImageIds,
  type Download,
  type Lock,
  type MyCourse,
  type MyCourseDetail,
  type MyCourses,
  type MyLesson,
  type MyLessonDetail,
  type MyModule,
  type Playback,
  type RichTextDoc,
} from '@nibras/contracts';
import { crossTenantDb, db, tenantDb, type Course } from '@nibras/db';
import type { StorageProvider } from '@nibras/providers';
import { ApiError } from '../common/api-error';
import { lessonMinutes } from '../courses/courses.service';
import { PlaybackService } from '../media/playback.service';
import { STORAGE_PROVIDER } from '../media/tokens';
import { RichTextService } from '../structure/rich-text.service';
import {
  loadOutline,
  resolveCourseAccess,
  resolveLessonAccess,
  unlockRuleOf,
  type CourseAccess,
  type LessonAccess,
  type Outline,
  type OutlineLesson,
} from './access';
import { LockService, type LessonLockState, type ModuleLockState } from './lock.service';

const OPEN_STATUSES: Course['status'][] = ['PUBLISHED', 'ARCHIVED'];

/** `403 MODULE_LOCKED` / `403 LESSON_LOCKED` with the lock as `details` (spec §4.6). */
export function lockedError(state: LessonLockState, module: ModuleLockState): ApiError {
  if (module.lock) {
    return new ApiError(HttpStatus.FORBIDDEN, 'MODULE_LOCKED', 'This module is locked', {
      ...module.lock,
    });
  }
  return new ApiError(HttpStatus.FORBIDDEN, 'LESSON_LOCKED', 'This lesson is locked', {
    ...(state.lessonLock as Lock),
  });
}

/** A lesson located in an evaluated outline. */
export interface LocatedLesson {
  lesson: OutlineLesson;
  module: Outline['modules'][number];
  state: LessonLockState;
  moduleState: ModuleLockState;
}

/** The lesson `lid` in `outline` with its lock state (`404` when absent: a concurrent delete). */
export function locate(outline: Outline, states: ModuleLockState[], lid: string): LocatedLesson {
  for (const [i, module] of outline.modules.entries()) {
    const j = module.lessons.findIndex((l) => l.id === lid);
    if (j >= 0) {
      return {
        lesson: module.lessons[j]!,
        module,
        state: states[i]!.lessons[j]!,
        moduleState: states[i]!,
      };
    }
  }
  throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}

/**
 * The student side of courses (PRD §8.5–8.6, spec §4.6): his courses across workspaces, a
 * course's outline with locks and progress, a lesson's content and playback grant, the silent
 * playback refresh and the PDF download. Every route resolves access first (`access.ts`:
 * enrollment through `crossTenantDb()`, then `tenantDb(wid)`); teachers preview through the
 * workspace routes, never these.
 */
@Injectable()
export class LearnService {
  constructor(
    private readonly locks: LockService,
    private readonly playbacks: PlaybackService,
    private readonly richText: RichTextService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /**
   * His ACTIVE enrollments in PUBLISHED / ARCHIVED live courses of the workspaces where his
   * membership is ACTIVE, most recent activity first (never-touched courses last), then by title.
   */
  async myCourses(userId: string): Promise<MyCourses> {
    const enrollments = await crossTenantDb().enrollment.findMany({
      where: { studentUserId: userId, status: 'ACTIVE' },
    });
    const byWorkspace = new Map<string, typeof enrollments>();
    for (const e of enrollments) {
      byWorkspace.set(e.workspaceId, [...(byWorkspace.get(e.workspaceId) ?? []), e]);
    }
    const items: MyCourse[] = [];
    for (const [wid, rows] of byWorkspace) {
      const scoped = tenantDb(wid);
      const membership = await scoped.membership.findFirst({
        where: { userId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!membership) continue;
      const workspace = await db.workspace.findUnique({
        where: { id: wid },
        select: { id: true, name: true },
      });
      if (!workspace) continue;
      const courses = await scoped.course.findMany({
        where: {
          id: { in: rows.map((r) => r.courseId) },
          deletedAt: null,
          status: { in: OPEN_STATUSES },
        },
        include: {
          owner: { select: { firstName: true, lastName: true } },
          cover: { select: { kind: true, status: true, storageKey: true, deletedAt: true } },
        },
      });
      const minutes = await this.derivedMinutes(
        wid,
        courses.map((c) => c.id),
      );
      const byCourse = new Map(rows.map((r) => [r.courseId, r]));
      for (const course of courses) {
        const e = byCourse.get(course.id)!;
        items.push({
          course: await this.courseInfo(course, workspace, minutes.get(course.id) ?? null),
          progressPercent: e.progressPercent,
          completedAt: e.completedAt?.toISOString() ?? null,
          lastActivityAt: e.lastActivityAt?.toISOString() ?? null,
        });
      }
    }
    items.sort(
      (a, b) =>
        (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '') ||
        a.course.title.localeCompare(b.course.title, 'fr') ||
        a.course.id.localeCompare(b.course.id),
    );
    return { items };
  }

  /** The outline: modules and lessons with locks, percents, progress; `next` = where to resume. */
  async course(userId: string, cid: string): Promise<MyCourseDetail> {
    const access = await resolveCourseAccess(userId, cid);
    const scoped = tenantDb(access.wid);
    const outline = await loadOutline(scoped, access.course, userId);
    const states = this.locks.evaluate(outline.lockInput);
    const full = await scoped.course.findFirstOrThrow({
      where: { id: cid },
      include: {
        owner: { select: { firstName: true, lastName: true } },
        cover: { select: { kind: true, status: true, storageKey: true, deletedAt: true } },
      },
    });
    const derived = outline.modules.flatMap((m) => m.lessons);
    const info = await this.courseInfo(
      full,
      access.workspace,
      derived.length > 0 ? derived.reduce((n, l) => n + lessonMinutes(l), 0) : null,
    );
    const modules: MyModule[] = outline.modules.map((m, i) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      position: m.position,
      isOptional: m.isOptional,
      unlockRule: unlockRuleOf(m.unlockRule),
      percent: states[i]!.percent,
      locked: states[i]!.locked,
      lock: states[i]!.lock,
      lessons: m.lessons.map((l, j) => toMyLesson(l, outline, states[i]!.lessons[j]!)),
    }));
    let next: MyCourseDetail['next'] = null;
    for (const m of modules) {
      const found = m.lessons.find((l) => !l.locked && l.progress.status !== 'COMPLETED');
      if (found) {
        next = { lessonId: found.id };
        break;
      }
    }
    return {
      course: {
        ...info,
        description: (full.description ?? null) as MyCourseDetail['course']['description'],
        sequentialLessons: full.sequentialLessons,
      },
      progressPercent: access.enrollment.progressPercent,
      completedAt: access.enrollment.completedAt?.toISOString() ?? null,
      modules,
      next,
    };
  }

  /**
   * One lesson: locked → `403 MODULE_LOCKED` / `LESSON_LOCKED`; TEXT → `content` and its images'
   * 5-minute URLs; VIDEO / PDF → a playback grant when the media is READY, `null` otherwise.
   */
  async lesson(userId: string, lid: string): Promise<MyLessonDetail> {
    const { access, outline, located } = await this.openLesson(userId, lid);
    const { lesson, module, state } = located;
    const scoped = tenantDb(access.wid);
    const content =
      lesson.type === 'TEXT' ? ((lesson.content ?? null) as RichTextDoc | null) : null;
    const images = content ? await this.richText.signImages(scoped, collectImageIds(content)) : {};
    const playback =
      (lesson.type === 'VIDEO' || lesson.type === 'PDF') && lesson.mediaAsset?.status === 'READY'
        ? await this.playbacks.playback(userId, access.wid, lesson.mediaAsset, {
            allowDownload: lesson.allowDownload,
          })
        : null;
    const order = outline.modules.flatMap((m) => m.lessons.map((l) => l.id));
    const at = order.indexOf(lid);
    return {
      lesson: toMyLesson(lesson, outline, state),
      course: { id: access.course.id, title: access.course.title },
      module: { id: module.id, title: module.title },
      content,
      images,
      playback,
      previous: at > 0 ? { lessonId: order[at - 1]! } : null,
      next: at < order.length - 1 ? { lessonId: order[at + 1]! } : null,
    };
  }

  /** A fresh grant (the player's silent renewal); TEXT → `422 MEDIA_KIND_MISMATCH`. */
  async playback(userId: string, lid: string): Promise<Playback> {
    const { access, located } = await this.openLesson(userId, lid);
    const { lesson } = located;
    if (!lesson.mediaAsset) throw noMedia(lesson.type);
    return this.playbacks.playback(userId, access.wid, lesson.mediaAsset, {
      allowDownload: lesson.allowDownload,
    });
  }

  /** PDF only; `403 DOWNLOAD_NOT_ALLOWED` unless the teacher allowed it (AC-MED-06). */
  async download(userId: string, lid: string): Promise<Download> {
    const { access, located } = await this.openLesson(userId, lid);
    const { lesson } = located;
    if (lesson.type !== 'PDF' || !lesson.mediaAsset) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'MEDIA_KIND_MISMATCH',
        'This action does not apply to this media',
        { kind: lesson.mediaAsset?.kind ?? lesson.type, expected: ['PDF'] },
      );
    }
    if (!lesson.allowDownload) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'DOWNLOAD_NOT_ALLOWED',
        'The teacher has not allowed downloading this document',
      );
    }
    return this.playbacks.download(userId, access.wid, lesson.mediaAsset);
  }

  /** Access, outline and lock check shared by the lesson routes. */
  private async openLesson(
    userId: string,
    lid: string,
  ): Promise<{ access: LessonAccess; outline: Outline; located: LocatedLesson }> {
    const access = await resolveLessonAccess(userId, lid);
    const outline = await loadOutline(tenantDb(access.wid), access.course, userId);
    const located = locate(outline, this.locks.evaluate(outline.lockInput), lid);
    if (located.state.locked) throw lockedError(located.state, located.moduleState);
    return { access, outline, located };
  }

  /** `courseId → derived minutes` of the courses that have lessons. */
  private async derivedMinutes(wid: string, courseIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (courseIds.length === 0) return out;
    const lessons = await tenantDb(wid).lesson.findMany({
      where: { module: { courseId: { in: courseIds } } },
      select: {
        estimatedMinutes: true,
        module: { select: { courseId: true } },
        mediaAsset: { select: { durationS: true } },
      },
    });
    for (const l of lessons) {
      out.set(l.module.courseId, (out.get(l.module.courseId) ?? 0) + lessonMinutes(l));
    }
    return out;
  }

  private async courseInfo(
    course: Course & {
      owner: { firstName: string; lastName: string };
      cover: {
        kind: string;
        status: string;
        storageKey: string | null;
        deletedAt: Date | null;
      } | null;
    },
    workspace: CourseAccess['workspace'] | { id: string; name: string },
    derivedMinutes: number | null,
  ): Promise<MyCourse['course']> {
    const cover = course.cover;
    const coverUrl =
      cover &&
      cover.kind === 'IMAGE' &&
      cover.status === 'READY' &&
      !cover.deletedAt &&
      cover.storageKey
        ? await this.storage.signGetUrl(cover.storageKey, INLINE_URL_TTL_S, {
            disposition: 'inline',
          })
        : null;
    return {
      id: course.id,
      title: course.title,
      coverUrl,
      level: course.level,
      language: course.language,
      estimatedMinutes: course.estimatedMinutes ?? derivedMinutes,
      status: course.status,
      workspace: { id: workspace.id, name: workspace.name },
      teacher: { firstName: course.owner.firstName, lastName: course.owner.lastName },
    };
  }
}

function noMedia(type: string): ApiError {
  return new ApiError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'MEDIA_KIND_MISMATCH',
    'This action does not apply to this lesson',
    { kind: type, expected: ['VIDEO', 'PDF'] },
  );
}

function toMyLesson(l: OutlineLesson, outline: Outline, state: LessonLockState): MyLesson {
  const progress = outline.progressByLesson.get(l.id);
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    type: l.type as MyLesson['type'],
    position: l.position,
    isRequired: l.isRequired,
    estimatedMinutes: l.estimatedMinutes,
    allowDownload: l.allowDownload,
    media: l.mediaAsset
      ? {
          status: l.mediaAsset.status,
          durationS: l.mediaAsset.durationS,
          pageCount: l.mediaAsset.pageCount,
        }
      : null,
    progress: {
      status: progress?.status ?? 'NOT_STARTED',
      completedAt: progress?.completedAt?.toISOString() ?? null,
    },
    locked: state.locked,
    lock: state.lock,
  };
}
