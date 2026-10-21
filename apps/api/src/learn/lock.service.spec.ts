import { describe, expect, it } from 'vitest';
import {
  coursePercentOf,
  evaluateLocks,
  type LockInput,
  type LockModuleInput,
} from './lock.service';

type Status = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

/** A module `m{n}` whose lessons are given as statuses (`?` suffix = optional lesson). */
function mod(
  n: number,
  lessons: string[],
  o: { optional?: boolean; gated?: boolean } = {},
): LockModuleInput {
  return {
    id: `m${n}`,
    title: `Module ${n}`,
    isOptional: o.optional ?? false,
    unlockRule: { type: o.gated ? 'PREVIOUS_MODULE_COMPLETED' : 'NONE' },
    lessons: lessons.map((s, i) => ({
      id: `m${n}l${i + 1}`,
      title: `Leçon ${n}.${i + 1}`,
      isRequired: !s.endsWith('?'),
      status: s.replace('?', '') as Status,
    })),
  };
}

const C = 'COMPLETED';
const N = 'NOT_STARTED';
const P = 'IN_PROGRESS';

describe('evaluateLocks (SP3 T10, PRD §8.5.2, Review Focus 4)', () => {
  it.each<{
    name: string;
    input: LockInput;
    modules: { locked: boolean; percent: number; previous?: string; previousPercent?: number }[];
    lessonsLocked?: Record<string, string | null>;
  }>([
    {
      name: 'NONE rule: nothing is locked whatever the progress',
      input: { sequentialLessons: false, modules: [mod(1, [N, N]), mod(2, [N])] },
      modules: [
        { locked: false, percent: 0 },
        { locked: false, percent: 0 },
      ],
    },
    {
      name: 'PREVIOUS_MODULE_COMPLETED: module 1 at 80 % locks module 2 (AC-ENR-03)',
      input: {
        sequentialLessons: false,
        modules: [mod(1, [C, C, C, C, P]), mod(2, [N], { gated: true })],
      },
      modules: [
        { locked: false, percent: 80 },
        { locked: true, percent: 0, previous: 'm1', previousPercent: 80 },
      ],
      lessonsLocked: { m2l1: 'PREVIOUS_MODULE_INCOMPLETE' },
    },
    {
      name: 'an optional module 2 between a complete module 1 and gated module 3 does not gate',
      input: {
        sequentialLessons: false,
        modules: [mod(1, [C, C]), mod(2, [N], { optional: true }), mod(3, [N], { gated: true })],
      },
      modules: [
        { locked: false, percent: 100 },
        { locked: false, percent: 0 },
        { locked: false, percent: 0 },
      ],
    },
    {
      name: 'an incomplete non-optional module 1 locks gated module 3 even when optional module 2 is complete',
      input: {
        sequentialLessons: false,
        modules: [mod(1, [C, N]), mod(2, [C], { optional: true }), mod(3, [N], { gated: true })],
      },
      modules: [
        { locked: false, percent: 50 },
        { locked: false, percent: 100 },
        { locked: true, percent: 0, previous: 'm1', previousPercent: 50 },
      ],
    },
    {
      name: 'sequential: lesson 2 locked until lesson 1 is COMPLETED; an optional lesson never blocks',
      input: { sequentialLessons: true, modules: [mod(1, [P, `${N}?`, N, N])] },
      modules: [{ locked: false, percent: 0 }],
      lessonsLocked: {
        m1l1: null,
        m1l2: 'PREVIOUS_LESSON_INCOMPLETE',
        m1l3: 'PREVIOUS_LESSON_INCOMPLETE',
        m1l4: 'PREVIOUS_LESSON_INCOMPLETE',
      },
    },
    {
      name: 'sequential: completing required lessons unlocks past an unfinished optional one; percent ignores optional lessons',
      input: { sequentialLessons: true, modules: [mod(1, [C, `${N}?`, N, N])] },
      modules: [{ locked: false, percent: 33 }],
      lessonsLocked: { m1l1: null, m1l2: null, m1l3: null, m1l4: 'PREVIOUS_LESSON_INCOMPLETE' },
    },
  ])('$name', ({ input, modules, lessonsLocked }) => {
    const out = evaluateLocks(input);
    expect(out).toHaveLength(modules.length);
    modules.forEach((m, i) => {
      expect(out[i]!.locked).toBe(m.locked);
      expect(out[i]!.percent).toBe(m.percent);
      if (m.previous) {
        expect(out[i]!.lock).toEqual({
          reason: 'PREVIOUS_MODULE_INCOMPLETE',
          previousModule: {
            id: m.previous,
            title: `Module ${m.previous.slice(1)}`,
            percent: m.previousPercent,
          },
        });
      } else {
        expect(out[i]!.lock).toBeNull();
      }
    });
    for (const [id, reason] of Object.entries(lessonsLocked ?? {})) {
      const lesson = out.flatMap((m) => m.lessons).find((l) => l.id === id)!;
      expect(lesson.lock?.reason ?? null).toBe(reason);
      expect(lesson.locked).toBe(reason !== null);
    }
    // The sequential lock names the first unfinished required lesson.
    const l4 = out[0]!.lessons[3];
    if (input.sequentialLessons && l4?.lock?.reason === 'PREVIOUS_LESSON_INCOMPLETE') {
      expect(l4.lock.previousLesson.id).toBe(
        input.modules[0]!.lessons.find((l) => l.isRequired && l.status !== C)!.id,
      );
    }
  });

  it('coursePercentOf: completed required lessons of non-optional modules (D-P8)', () => {
    expect(
      coursePercentOf({
        sequentialLessons: false,
        modules: [mod(1, [C, `${N}?`]), mod(2, [N]), mod(3, [C], { optional: true })],
      }),
    ).toBe(50);
    expect(coursePercentOf({ sequentialLessons: false, modules: [] })).toBe(0);
  });
});
