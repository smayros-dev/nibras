import { describe, expect, it } from 'vitest';
import {
  COURSE_LEVELS,
  COURSE_PURGE_AFTER_DAYS,
  COURSE_STATUSES,
  ENROLL_BATCH_MAX,
  LESSON_TYPES,
  MEDIA_STATUS_POLL_MS,
  MVP_LESSON_TYPES,
  MVP_UNLOCK_RULES,
  UNLOCK_RULE_TYPES,
  WATERMARK_MOVE_MS,
  WATERMARK_POSITIONS,
  courseEditorLink,
  courseProgressPercent,
  etagOf,
  lessonLink,
  myCoursesLink,
  parseIfMatch,
} from './course-constants';

describe('course constants', () => {
  it('spells the enums and limits as the plan does', () => {
    expect(COURSE_STATUSES).toEqual(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
    expect(COURSE_LEVELS).toEqual(['PRIMAIRE', 'COLLEGE', 'LYCEE', 'SUPERIEUR', 'ADULTE', 'AUTRE']);
    expect(LESSON_TYPES).toHaveLength(7);
    expect(MVP_LESSON_TYPES).toEqual(['VIDEO', 'PDF', 'TEXT']);
    expect(MVP_UNLOCK_RULES).toEqual(['NONE', 'PREVIOUS_MODULE_COMPLETED']);
    for (const t of MVP_UNLOCK_RULES) expect(UNLOCK_RULE_TYPES).toContain(t);
    expect(ENROLL_BATCH_MAX).toBe(200);
    expect(COURSE_PURGE_AFTER_DAYS).toBe(30);
    expect(MEDIA_STATUS_POLL_MS).toBe(5000);
    expect(WATERMARK_MOVE_MS).toBe(30_000);
    expect(WATERMARK_POSITIONS).toBe(6);
  });

  it('courseProgressPercent floors and clamps', () => {
    expect(courseProgressPercent(7, 10)).toBe(70);
    expect(courseProgressPercent(0, 0)).toBe(0);
    expect(courseProgressPercent(2, 3)).toBe(66);
    expect(courseProgressPercent(5, 3)).toBe(100);
    expect(courseProgressPercent(-1, 3)).toBe(0);
  });

  it('parseIfMatch accepts "7", 7 and W/"7", refuses the rest', () => {
    expect(parseIfMatch('"7"')).toBe(7);
    expect(parseIfMatch('7')).toBe(7);
    expect(parseIfMatch('W/"7"')).toBe(7);
    expect(parseIfMatch(' "12" ')).toBe(12);
    expect(parseIfMatch('*')).toBeNull();
    expect(parseIfMatch(undefined)).toBeNull();
    expect(parseIfMatch('')).toBeNull();
    expect(parseIfMatch('"7", "8"')).toBeNull();
    expect(parseIfMatch('"0"')).toBeNull();
    expect(parseIfMatch('"-1"')).toBeNull();
    expect(parseIfMatch('"7.5"')).toBeNull();
    expect(parseIfMatch('"99999999999999999999"')).toBeNull();
  });

  it('etagOf quotes the version and round-trips through parseIfMatch', () => {
    expect(etagOf(7)).toBe('"7"');
    expect(parseIfMatch(etagOf(42))).toBe(42);
  });

  it('builds the course, lesson and my-courses links', () => {
    expect(courseEditorLink('https://app.test/', 'fr', 'w1', 'c1')).toBe(
      'https://app.test/fr/app/w/w1/courses/c1',
    );
    expect(lessonLink('https://app.test', 'ar', 'c1', 'l1')).toBe(
      'https://app.test/ar/app/courses/c1/lessons/l1',
    );
    expect(myCoursesLink('https://app.test', 'en')).toBe('https://app.test/en/app/courses');
  });
});
