import { Injectable } from '@nestjs/common';
import type { StudentCourse } from '@nibras/contracts';
import { tenantDb } from '@nibras/db';

/** The `courses` and `progressPercent` of one student in SP2's students list and profile. */
export interface StudentCourses {
  /** His enrollments (ACTIVE and REVOKED) in the live courses of the workspace, by title. */
  courses: StudentCourse[];
  /**
   * `floor(mean(progressPercent))` over his ACTIVE enrollments of PUBLISHED / ARCHIVED courses
   * (a DRAFT course is not open to him); `null` when there is none.
   */
  progressPercent: number | null;
}

export interface StudentCoursesOptions {
  /**
   * Scope `own` (a TEACHER reading his students): only the courses he owns, the mean over them.
   * Omitted for scope `all`.
   */
  ownerUserId?: string;
}

const OPEN_TO_STUDENTS = new Set(['PUBLISHED', 'ARCHIVED']);

/**
 * Fills SP2's `StudentSummary.courses` / `progressPercent` and `StudentProfile.courses` (PRD
 * §8.3.1; plan T9) from the enrollments: one query for a whole page, under `tenantDb(wid)` (a
 * student who also belongs to another workspace never shows its courses). Self-contained so the
 * SP2 students service can call it after the merge; it never decides who may read whom (the
 * caller has already scoped the student ids).
 */
@Injectable()
export class StudentCoursesService {
  async forStudents(
    workspaceId: string,
    studentUserIds: readonly string[],
    opts: StudentCoursesOptions = {},
  ): Promise<Map<string, StudentCourses>> {
    const out = new Map<string, StudentCourses>();
    if (studentUserIds.length === 0) return out;
    const rows = await tenantDb(workspaceId).enrollment.findMany({
      where: {
        studentUserId: { in: [...studentUserIds] },
        course: {
          deletedAt: null,
          ...(opts.ownerUserId !== undefined && { ownerUserId: opts.ownerUserId }),
        },
      },
      include: { course: { select: { id: true, title: true, status: true } } },
    });
    for (const uid of studentUserIds) out.set(uid, { courses: [], progressPercent: null });
    const sums = new Map<string, { total: number; count: number }>();
    for (const row of rows) {
      out.get(row.studentUserId)?.courses.push({
        courseId: row.course.id,
        title: row.course.title,
        status: row.course.status,
        enrollmentStatus: row.status,
        progressPercent: row.progressPercent,
        completedAt: row.completedAt?.toISOString() ?? null,
      });
      if (row.status === 'ACTIVE' && OPEN_TO_STUDENTS.has(row.course.status)) {
        const s = sums.get(row.studentUserId) ?? { total: 0, count: 0 };
        s.total += row.progressPercent;
        s.count += 1;
        sums.set(row.studentUserId, s);
      }
    }
    for (const [uid, entry] of out) {
      entry.courses.sort(
        (a, b) => a.title.localeCompare(b.title, 'fr') || a.courseId.localeCompare(b.courseId),
      );
      const s = sums.get(uid);
      entry.progressPercent = s ? Math.floor(s.total / s.count) : null;
    }
    return out;
  }

  /** One student's (the profile's `courses`; `progressPercent` for a summary row). */
  async forStudent(
    workspaceId: string,
    studentUserId: string,
    opts: StudentCoursesOptions = {},
  ): Promise<StudentCourses> {
    const map = await this.forStudents(workspaceId, [studentUserId], opts);
    return map.get(studentUserId)!;
  }
}
