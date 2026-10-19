import { isMinor } from '@nibras/contracts';
import type { PrismaClient } from '@nibras/db';
import { expect } from 'vitest';

/**
 * The ownership invariant (spec SP1.6 F7): exactly one `OWNER` membership in `wid`, `ACTIVE`,
 * and `workspace.ownerUserId` is its user. Returns the owner's user id.
 */
export async function expectOneOwner(db: PrismaClient, wid: string): Promise<string> {
  const owners = await db.membership.findMany({
    where: { workspaceId: wid, role: 'OWNER' },
    select: { userId: true, status: true },
  });
  expect(owners, `workspace ${wid} must have exactly one OWNER membership`).toHaveLength(1);
  const [owner] = owners;
  expect(owner!.status, `the OWNER of ${wid} must be ACTIVE`).toBe('ACTIVE');
  const { ownerUserId } = await db.workspace.findUniqueOrThrow({
    where: { id: wid },
    select: { ownerUserId: true },
  });
  expect(ownerUserId, `workspace ${wid}: ownerUserId must be the OWNER membership's user`).toBe(
    owner!.userId,
  );
  return owner!.userId;
}

/**
 * The minor invariant (SP2, D-O5 / D-P3): every `ACTIVE` STUDENT membership of `wid` whose user is
 * a minor today (`isMinor(birthDate)`) has an unrevoked `GUARDIAN_PARENTAL` consent for
 * (student, `wid`) and an `ACTIVE` guardian link. A student without a birth date is not a known
 * minor (SP1 accounts). Call it in every spec that activates a student.
 */
export async function expectMinorInvariant(db: PrismaClient, wid: string): Promise<void> {
  const active = await db.membership.findMany({
    where: { workspaceId: wid, role: 'STUDENT', status: 'ACTIVE' },
    select: { userId: true, user: { select: { birthDate: true } } },
  });
  const now = new Date();
  for (const { userId, user } of active) {
    if (!user.birthDate || !isMinor(user.birthDate.toISOString().slice(0, 10), now)) continue;
    const consents = await db.consent.count({
      where: {
        userId,
        workspaceId: wid,
        type: 'GUARDIAN_PARENTAL',
        granted: true,
        revokedAt: null,
      },
    });
    expect(
      consents,
      `ACTIVE minor ${userId} in ${wid} must hold an unrevoked GUARDIAN_PARENTAL consent`,
    ).toBe(1);
    const link = await db.guardianLink.findUnique({
      where: { studentUserId_workspaceId: { studentUserId: userId, workspaceId: wid } },
      select: { status: true },
    });
    expect(link?.status, `ACTIVE minor ${userId} in ${wid} must have an ACTIVE guardian link`).toBe(
      'ACTIVE',
    );
  }
}

const contiguous = (positions: number[]): number[] => positions.map((_, i) => i + 1);

/**
 * The structure invariant (SP3): the modules of `courseId` sit at positions 1..n, the lessons of
 * each module at 1..n, every version is ≥ 1, and every module, lesson and referenced media asset
 * (lesson media, course cover) belongs to the course's workspace (Review Focus 5).
 */
export async function expectStructureInvariant(db: PrismaClient, courseId: string): Promise<void> {
  const course = await db.course.findUniqueOrThrow({
    where: { id: courseId },
    select: { workspaceId: true, version: true, cover: { select: { workspaceId: true } } },
  });
  const wid = course.workspaceId;
  expect(course.version, `course ${courseId}: version ≥ 1`).toBeGreaterThanOrEqual(1);
  if (course.cover) {
    expect(course.cover.workspaceId, `course ${courseId}: cover of another workspace`).toBe(wid);
  }
  const modules = await db.module.findMany({
    where: { courseId },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      workspaceId: true,
      position: true,
      version: true,
      lessons: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          workspaceId: true,
          position: true,
          version: true,
          mediaAsset: { select: { workspaceId: true } },
        },
      },
    },
  });
  const modulePositions = modules.map((m) => m.position);
  expect(modulePositions, `course ${courseId}: module positions`).toEqual(
    contiguous(modulePositions),
  );
  for (const m of modules) {
    expect(m.workspaceId, `module ${m.id}: workspace`).toBe(wid);
    expect(m.version, `module ${m.id}: version ≥ 1`).toBeGreaterThanOrEqual(1);
    const lessonPositions = m.lessons.map((l) => l.position);
    expect(lessonPositions, `module ${m.id}: lesson positions`).toEqual(
      contiguous(lessonPositions),
    );
    for (const l of m.lessons) {
      expect(l.workspaceId, `lesson ${l.id}: workspace`).toBe(wid);
      expect(l.version, `lesson ${l.id}: version ≥ 1`).toBeGreaterThanOrEqual(1);
      if (l.mediaAsset) {
        expect(l.mediaAsset.workspaceId, `lesson ${l.id}: media of another workspace`).toBe(wid);
      }
    }
  }
}
