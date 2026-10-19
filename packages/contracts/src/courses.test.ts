import { describe, expect, it } from 'vitest';
import {
  CourseDetailSchema,
  CoursesQuerySchema,
  CreateCourseSchema,
  ReassignCourseSchema,
  UpdateCourseSchema,
} from './courses';
import { ERROR_CODES } from './error-codes';

const UUID = '0192f2a0-0000-7000-8000-000000000001';

const SP3_ERROR_CODES = [
  'VERSION_REQUIRED',
  'VERSION_CONFLICT',
  'COURSE_NOT_PUBLISHABLE',
  'COURSE_STATUS_INVALID',
  'COURSE_HAS_ACTIVE_ENROLLMENTS',
  'COURSE_NOT_AVAILABLE',
  'ENROLLMENT_REVOKED',
  'MODULE_LOCKED',
  'LESSON_LOCKED',
  'LESSON_NOT_OPENED',
  'MEDIA_NOT_READY',
  'MEDIA_IN_USE',
  'MEDIA_KIND_MISMATCH',
  'INVALID_FILE_SIGNATURE',
  'QUOTA_EXCEEDED',
  'UPLOAD_EXPIRED',
  'UPLOAD_NOT_PENDING',
  'DOWNLOAD_NOT_ALLOWED',
  'WEBHOOK_SIGNATURE_INVALID',
];

it('ERROR_CODES carries the 19 SP3 codes of spec §7, in order, without duplicates', () => {
  const start = ERROR_CODES.indexOf('VERSION_REQUIRED');
  expect(start).toBeGreaterThan(0);
  expect(ERROR_CODES.slice(start, start + SP3_ERROR_CODES.length)).toEqual(SP3_ERROR_CODES);
  expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
});

describe('course inputs', () => {
  it('CreateCourseSchema trims, defaults language to fr and refuses unknown keys', () => {
    expect(CreateCourseSchema.parse({ title: '  Algèbre  ' })).toEqual({
      title: 'Algèbre',
      language: 'fr',
    });
    expect(CreateCourseSchema.safeParse({ title: 'A', status: 'PUBLISHED' }).success).toBe(false);
    expect(CreateCourseSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(CreateCourseSchema.safeParse({ title: 'a'.repeat(201) }).success).toBe(false);
    expect(CreateCourseSchema.safeParse({ title: 'A', level: 'EXPERT' }).success).toBe(false);
    expect(CreateCourseSchema.safeParse({ title: 'A', estimatedMinutes: 100001 }).success).toBe(
      false,
    );
    expect(
      CreateCourseSchema.parse({
        title: 'A',
        level: 'LYCEE',
        language: 'ar',
        estimatedMinutes: null,
        coverMediaId: UUID,
        sequentialLessons: true,
        category: ' Maths ',
        description: { type: 'doc', content: [{ type: 'paragraph' }] },
      }),
    ).toMatchObject({ language: 'ar', category: 'Maths', estimatedMinutes: null });
  });

  it('the course description refuses images (description schema)', () => {
    expect(
      CreateCourseSchema.safeParse({
        title: 'A',
        description: { type: 'doc', content: [{ type: 'image', attrs: { mediaId: UUID } }] },
      }).success,
    ).toBe(false);
  });

  it('UpdateCourseSchema refuses {} and does not default the language', () => {
    expect(UpdateCourseSchema.safeParse({}).success).toBe(false);
    expect(UpdateCourseSchema.parse({ title: 'B' })).toEqual({ title: 'B' });
    expect(UpdateCourseSchema.safeParse({ ownerUserId: UUID }).success).toBe(false);
  });

  it('CoursesQuerySchema coerces limit (1–100, default 50) and checks status', () => {
    expect(CoursesQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(CoursesQuerySchema.parse({ limit: '20', status: 'DRAFT', q: ' alg ' })).toEqual({
      limit: 20,
      status: 'DRAFT',
      q: 'alg',
    });
    expect(CoursesQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(CoursesQuerySchema.safeParse({ status: 'DELETED' }).success).toBe(false);
    expect(CoursesQuerySchema.safeParse({ cursor: 'nope' }).success).toBe(false);
  });

  it('ReassignCourseSchema needs a uuid', () => {
    expect(ReassignCourseSchema.parse({ ownerUserId: UUID })).toEqual({ ownerUserId: UUID });
    expect(ReassignCourseSchema.safeParse({ ownerUserId: 'x' }).success).toBe(false);
  });

  it('CourseDetailSchema carries the publish blockers', () => {
    const shape = CourseDetailSchema.shape;
    expect(Object.keys(shape)).toEqual(
      expect.arrayContaining(['canPublish', 'publishBlockers', 'sequentialLessons', 'version']),
    );
    expect(shape.publishBlockers.safeParse(['NO_MODULE', 'NO_READY_LESSON']).success).toBe(true);
    expect(shape.publishBlockers.safeParse(['OTHER']).success).toBe(false);
  });
});
