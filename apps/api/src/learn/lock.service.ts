import { Injectable } from '@nestjs/common';
import { courseProgressPercent, type Lock } from '@nibras/contracts';
import type { LessonProgressStatus } from '@nibras/db';

export interface LockLessonInput {
  id: string;
  title: string;
  isRequired: boolean;
  /** The student's progress on the lesson (`NOT_STARTED` without a row). */
  status: LessonProgressStatus;
}

export interface LockModuleInput {
  id: string;
  title: string;
  isOptional: boolean;
  unlockRule: { type: string };
  /** In position order. */
  lessons: LockLessonInput[];
}

export interface LockInput {
  sequentialLessons: boolean;
  /** In position order. */
  modules: LockModuleInput[];
}

export interface LessonLockState {
  id: string;
  locked: boolean;
  /** The module's lock when the module is locked, else the sequential lock. */
  lock: Lock | null;
  /** Only the sequential lock (`LESSON_LOCKED`); the module's lock is on the module. */
  lessonLock: Lock | null;
}

export interface ModuleLockState {
  id: string;
  /** `courseProgressPercent(completed required, required)` of the module's own lessons. */
  percent: number;
  locked: boolean;
  lock: Lock | null;
  lessons: LessonLockState[];
}

const completedRequired = (m: LockModuleInput) =>
  m.lessons.filter((l) => l.isRequired && l.status === 'COMPLETED').length;
const requiredCount = (m: LockModuleInput) => m.lessons.filter((l) => l.isRequired).length;

/**
 * The locks of PRD §8.5.2 (spec §4.6), on pure data:
 * - a module whose `unlockRule` is `PREVIOUS_MODULE_COMPLETED` is locked while the nearest
 *   previous non-optional module has an unfinished required lesson (`PREVIOUS_MODULE_INCOMPLETE`
 *   with that module's percent). Optional modules show their own percent but never gate; a
 *   module with no required lesson counts as finished;
 * - with `sequentialLessons`, a lesson is locked while a required lesson before it in its module
 *   is not COMPLETED (`PREVIOUS_LESSON_INCOMPLETE`, naming the first such lesson). Optional
 *   lessons never block.
 * Every lesson of a locked module is locked with the module's lock.
 */
export function evaluateLocks(input: LockInput): ModuleLockState[] {
  let gate: LockModuleInput | undefined;
  return input.modules.map((m) => {
    const percent = courseProgressPercent(completedRequired(m), requiredCount(m));
    let lock: Lock | null = null;
    if (
      m.unlockRule.type === 'PREVIOUS_MODULE_COMPLETED' &&
      gate &&
      completedRequired(gate) < requiredCount(gate)
    ) {
      lock = {
        reason: 'PREVIOUS_MODULE_INCOMPLETE',
        previousModule: {
          id: gate.id,
          title: gate.title,
          percent: courseProgressPercent(completedRequired(gate), requiredCount(gate)),
        },
      };
    }
    if (!m.isOptional) gate = m;

    let blocker: LockLessonInput | undefined;
    const lessons = m.lessons.map((l): LessonLockState => {
      const lessonLock: Lock | null =
        input.sequentialLessons && blocker
          ? {
              reason: 'PREVIOUS_LESSON_INCOMPLETE',
              previousLesson: { id: blocker.id, title: blocker.title },
            }
          : null;
      if (!blocker && l.isRequired && l.status !== 'COMPLETED') blocker = l;
      const effective = lock ?? lessonLock;
      return { id: l.id, locked: effective !== null, lock: effective, lessonLock };
    });
    return { id: m.id, percent, locked: lock !== null, lock, lessons };
  });
}

/**
 * `Enrollment.progressPercent` (D-P8, SP3 subset): completed required lessons of non-optional
 * modules over the required lessons of non-optional modules, floored (0 without any).
 */
export function coursePercentOf(input: LockInput): number {
  const counted = input.modules.filter((m) => !m.isOptional);
  return courseProgressPercent(
    counted.reduce((n, m) => n + completedRequired(m), 0),
    counted.reduce((n, m) => n + requiredCount(m), 0),
  );
}

/** Injectable face of {@link evaluateLocks} and {@link coursePercentOf}. */
@Injectable()
export class LockService {
  evaluate(input: LockInput): ModuleLockState[] {
    return evaluateLocks(input);
  }

  coursePercent(input: LockInput): number {
    return coursePercentOf(input);
  }
}
