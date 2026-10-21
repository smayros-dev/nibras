import { Writable } from 'node:stream';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  GUARDIAN_CONSENT_EXPIRE_JOB,
  INVITATION_EXPIRE_JOB,
  QUEUES,
  defaultWorkspaceSettings,
  hashOpaqueToken,
} from '@nibras/contracts';
import {
  resetDatabase,
  systemPrisma,
  type GuardianLink,
  type MembershipStatus,
  type User,
  type Workspace,
} from '@nibras/db';
import { InMemoryEmailProvider } from '@nibras/providers';
import type { Job } from 'bullmq';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/env';
import { EMAIL_PROVIDER } from '../src/providers';
import { ProcessorRegistry } from '../src/queues';
import { WorkerModule } from '../src/worker.module';
import { obliterateAllQueues } from './redis';

const db = systemPrisma();
const DAY = 24 * 60 * 60 * 1000;
const CONSENT_TTL_DAYS = 14;

let n = 0;
function user(o: Partial<Pick<User, 'locale' | 'firstName'>> = {}): Promise<User> {
  n += 1;
  return db.user.create({
    data: {
      email: `expiry-${n}-${Date.now()}@example.com`,
      firstName: o.firstName ?? `U${n}`,
      lastName: 'Expiry',
      locale: o.locale ?? 'fr',
    },
  });
}

/** A personal workspace whose owner has an ACTIVE OWNER membership. */
async function workspace(owner: User): Promise<Workspace> {
  n += 1;
  const ws = await db.workspace.create({
    data: {
      type: 'PERSONAL',
      name: `Expiry ws ${n}`,
      slug: `expiry-ws-${n}-${Date.now()}`,
      ownerUserId: owner.id,
      defaultTimezone: 'Africa/Tunis',
      defaultLocale: 'fr',
      storageQuotaBytes: 1024n,
      settings: { ...defaultWorkspaceSettings('Africa/Tunis') },
    },
  });
  await db.membership.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
  });
  return ws;
}

/**
 * A student membership in `ws` and its guardian link `PENDING`, sent `daysOld` days ago (the
 * 14-day consent link). `daysOld: null` → a link recorded before an approval (T6): no token, no
 * expiry, never sent.
 */
async function minorLink(
  ws: Workspace,
  student: User,
  daysOld: number | null,
  status: MembershipStatus = 'PENDING_GUARDIAN_CONSENT',
  invitedBy: User | null = null,
): Promise<GuardianLink> {
  await db.membership.create({
    data: {
      workspaceId: ws.id,
      userId: student.id,
      role: 'STUDENT',
      status,
      invitedByUserId: invitedBy?.id ?? null,
    },
  });
  n += 1;
  const sentAt = daysOld === null ? null : new Date(Date.now() - daysOld * DAY);
  return db.guardianLink.create({
    data: {
      workspaceId: ws.id,
      studentUserId: student.id,
      guardianEmail: `guardian-${n}@example.com`,
      status: 'PENDING',
      consentTokenHash: sentAt ? hashOpaqueToken(`raw-${n}-${Date.now()}`) : null,
      consentSentAt: sentAt,
      consentExpiresAt: sentAt ? new Date(sentAt.getTime() + CONSENT_TTL_DAYS * DAY) : null,
    },
  });
}

/** A BullMQ-like job whose `progress` survives between runs (stored as a copy), as on a retry. */
function fakeJob(name: string) {
  const job = {
    name,
    id: `${name}:${Date.now()}`,
    data: {},
    attemptsMade: 0,
    progress: 0 as unknown,
    updateProgress(p: unknown) {
      job.progress = structuredClone(p);
      return Promise.resolve();
    },
  };
  return job;
}

function memorySink(): { sink: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return {
    sink,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe('compliance expiry jobs (AC-INV-12)', () => {
  let moduleRef: TestingModule;
  let registry: ProcessorRegistry;
  const email = new InMemoryEmailProvider();
  const logs = memorySink();
  const origin = loadEnv().WEB_ORIGIN.replace(/\/+$/, '');

  const run = (job: ReturnType<typeof fakeJob>) =>
    registry.dispatch(QUEUES.compliance, job as unknown as Job);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [WorkerModule.register(loadEnv(), pino({ level: 'info' }, logs.sink))],
    })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(email)
      .compile();
    await moduleRef.init();
    registry = moduleRef.get(ProcessorRegistry);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await obliterateAllQueues();
  });

  beforeEach(async () => {
    await obliterateAllQueues();
    await resetDatabase(db);
    email.clear();
  });

  describe('guardian_consent.expire', () => {
    it("AC-INV-12: a PENDING link 15 days old → membership SUSPENDED_NO_CONSENT, token cleared, status PENDING kept, audit guardian.consent_expired (SYSTEM, workspace_id), student + teacher emailed; the student's other ACTIVE membership, user row and consent rows are untouched; a second run expires nothing", async () => {
      const owner = await user();
      const teacher = await user({ firstName: 'Mohamed' });
      const student = await user({ locale: 'ar', firstName: 'Amira' });
      const wsA = await workspace(owner);
      await db.membership.create({
        data: { workspaceId: wsA.id, userId: teacher.id, role: 'TEACHER', status: 'ACTIVE' },
      });
      const link = await minorLink(wsA, student, 15, 'PENDING_GUARDIAN_CONSENT', teacher);
      // The same student, ACTIVE elsewhere with a granted parental consent and his own consents.
      const wsB = await workspace(await user());
      await db.membership.create({
        data: { workspaceId: wsB.id, userId: student.id, role: 'STUDENT', status: 'ACTIVE' },
      });
      for (const [type, workspaceId] of [
        ['TERMS', null],
        ['GUARDIAN_PARENTAL', wsB.id],
      ] as const) {
        await db.consent.create({
          data: {
            userId: student.id,
            type,
            version: 'v1',
            granted: true,
            grantedAt: new Date(),
            ip: '127.0.0.1',
            userAgent: 'test',
            workspaceId,
          },
        });
      }
      const userBefore = await db.user.findUniqueOrThrow({ where: { id: student.id } });
      const consentsBefore = await db.consent.findMany({ orderBy: { id: 'asc' } });
      const membershipB = await db.membership.findFirstOrThrow({
        where: { workspaceId: wsB.id, userId: student.id },
      });

      const job = fakeJob(GUARDIAN_CONSENT_EXPIRE_JOB);
      await expect(run(job)).resolves.toEqual({ expired: 1, notified: 2 });

      const after = await db.guardianLink.findUniqueOrThrow({ where: { id: link.id } });
      expect(after.status).toBe('PENDING');
      expect(after.consentTokenHash).toBeNull();
      expect(after.consentExpiresAt).toEqual(link.consentExpiresAt);
      expect(after.guardianEmail).toBe(link.guardianEmail);
      const membershipA = await db.membership.findFirstOrThrow({
        where: { workspaceId: wsA.id, userId: student.id },
      });
      expect(membershipA.status).toBe('SUSPENDED_NO_CONSENT');

      // No purge, no user-level change (D-O5).
      expect(await db.user.findUniqueOrThrow({ where: { id: student.id } })).toEqual(userBefore);
      expect(await db.consent.findMany({ orderBy: { id: 'asc' } })).toEqual(consentsBefore);
      expect(
        await db.membership.findFirstOrThrow({
          where: { workspaceId: wsB.id, userId: student.id },
        }),
      ).toEqual(membershipB);

      const audit = await db.auditLog.findMany({ where: { action: 'guardian.consent_expired' } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        workspaceId: wsA.id,
        actorUserId: null,
        actorRole: 'SYSTEM',
        entityType: 'GuardianLink',
        entityId: link.id,
        requestId: `job:${job.id}`,
      });
      expect(JSON.stringify(audit[0]!.after)).not.toMatch(/hash|token/i);

      const sent = email.findByTemplate('guardian.consent_expired');
      expect(sent.map((m) => m.to).sort()).toEqual([student.email, teacher.email].sort());
      const toStudent = sent.find((m) => m.to === student.email)!;
      expect(toStudent.locale).toBe('ar');
      expect(toStudent.params).toMatchObject({
        firstName: 'Amira',
        recipientRole: 'STUDENT',
        workspaceName: wsA.name,
        teacherName: 'Mohamed Expiry',
        studentName: 'Amira Expiry',
        link: `${origin}/ar/app`,
      });
      expect(sent.find((m) => m.to === teacher.email)!.params).toMatchObject({
        firstName: 'Mohamed',
        recipientRole: 'TEACHER',
        link: `${origin}/fr/app/w/${wsA.id}/students`,
      });

      // PRD §13.3: the workspace of every row is logged; never an address.
      const expiredLines = logs.lines().filter((l) => l.msg === 'guardian consent expired');
      expect(expiredLines).toEqual([
        expect.objectContaining({ workspace_id: wsA.id, guardianLinkId: link.id }),
      ]);
      expect(JSON.stringify(logs.lines())).not.toContain(student.email);

      // A second run finds nothing.
      email.clear();
      await expect(run(fakeJob(GUARDIAN_CONSENT_EXPIRE_JOB))).resolves.toEqual({
        expired: 0,
        notified: 0,
      });
      expect(email.sent).toHaveLength(0);
      expect(await db.auditLog.count({ where: { action: 'guardian.consent_expired' } })).toBe(1);
    });

    it('a link whose membership is already SUSPENDED_CONSENT_REVOKED or REMOVED is not changed; a PENDING link 13 days old and a never-sent link are left alone', async () => {
      const owner = await user();
      const ws = await workspace(owner);
      const [revoked, removed, young, notSent] = [
        await user(),
        await user(),
        await user(),
        await user(),
      ];
      await minorLink(ws, revoked, 15, 'SUSPENDED_CONSENT_REVOKED');
      await minorLink(ws, removed, 15, 'REMOVED');
      const youngLink = await minorLink(ws, young, 13);
      const notSentLink = await minorLink(ws, notSent, null, 'PENDING_APPROVAL');
      const before = await db.membership.findMany({ orderBy: { id: 'asc' } });

      await run(fakeJob(GUARDIAN_CONSENT_EXPIRE_JOB));

      expect(await db.membership.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
      expect(email.sent).toHaveLength(0);
      expect(await db.guardianLink.findUniqueOrThrow({ where: { id: youngLink.id } })).toEqual(
        youngLink,
      );
      expect(await db.guardianLink.findUniqueOrThrow({ where: { id: notSentLink.id } })).toEqual(
        notSentLink,
      );
    });

    it('retry after a failed email resumes after lastId and never emails the first batch twice (failFor)', async () => {
      const rows: { teacher: User; student: User; ws: Workspace }[] = [];
      for (let i = 0; i < 3; i += 1) {
        const teacher = await user();
        const student = await user();
        const ws = await workspace(teacher);
        await minorLink(ws, student, 20);
        rows.push({ teacher, student, ws });
      }
      const down = rows[1]!.teacher.email;
      email.failFor(down);

      const job = fakeJob(GUARDIAN_CONSENT_EXPIRE_JOB);
      await expect(run(job)).rejects.toThrow(/not sent/);
      // Every row was suspended; the one failed email is kept for the retry.
      const statuses = await db.membership.findMany({
        where: { role: 'STUDENT' },
        select: { status: true },
      });
      expect(statuses.map((s) => s.status)).toEqual(Array(3).fill('SUSPENDED_NO_CONSENT'));
      const firstRun = email.sent.map((m) => m.to).sort();
      expect(firstRun).toHaveLength(5);
      expect(firstRun).not.toContain(down);
      const lastLink = await db.guardianLink.findFirstOrThrow({ orderBy: { id: 'desc' } });
      expect(job.progress).toMatchObject({ lastId: lastLink.id, processed: 3 });

      email.clear(); // also lifts failFor
      await expect(run(job)).resolves.toEqual({ expired: 3, notified: 6 });
      expect(email.sent.map((m) => m.to)).toEqual([down]);
      expect(await db.auditLog.count({ where: { action: 'guardian.consent_expired' } })).toBe(3);
    });
  });

  describe('invitation.expire', () => {
    it('flips PENDING past expiresAt to EXPIRED with an audit row each; ACCEPTED/REVOKED untouched; the address can then be invited again', async () => {
      const owner = await user();
      const wsA = await workspace(owner);
      const wsB = await workspace(await user());
      const invite = (
        ws: Workspace,
        to: string,
        status: 'PENDING' | 'ACCEPTED' | 'REVOKED',
        expiresInDays: number,
      ) => {
        n += 1;
        return db.invitation.create({
          data: {
            workspaceId: ws.id,
            email: to,
            role: 'STUDENT',
            tokenHash: hashOpaqueToken(`inv-${n}-${Date.now()}`),
            expiresAt: new Date(Date.now() + expiresInDays * DAY),
            status,
            invitedByUserId: ws.ownerUserId,
            lastSentAt: new Date(),
          },
        });
      };
      const stale = await invite(wsA, 'stale@example.com', 'PENDING', -1);
      const staleB = await invite(wsB, 'other@example.com', 'PENDING', -3);
      const fresh = await invite(wsA, 'fresh@example.com', 'PENDING', 2);
      const accepted = await invite(wsA, 'accepted@example.com', 'ACCEPTED', -5);
      const revoked = await invite(wsA, 'revoked@example.com', 'REVOKED', -5);

      const job = fakeJob(INVITATION_EXPIRE_JOB);
      await expect(run(job)).resolves.toEqual({ expired: 2 });

      const status = async (id: string) =>
        (await db.invitation.findUniqueOrThrow({ where: { id } })).status;
      expect(await status(stale.id)).toBe('EXPIRED');
      expect(await status(staleB.id)).toBe('EXPIRED');
      expect(await status(fresh.id)).toBe('PENDING');
      expect(await status(accepted.id)).toBe('ACCEPTED');
      expect(await status(revoked.id)).toBe('REVOKED');

      const audit = await db.auditLog.findMany({
        where: { action: 'invitation.expired' },
        orderBy: { entityId: 'asc' },
      });
      expect(audit.map((a) => [a.entityId, a.workspaceId])).toEqual([
        [stale.id, wsA.id],
        [staleB.id, wsB.id],
      ]);
      for (const row of audit) {
        expect(row).toMatchObject({
          actorUserId: null,
          actorRole: 'SYSTEM',
          entityType: 'Invitation',
          requestId: `job:${job.id}`,
        });
      }
      expect(audit[0]!.after).toMatchObject({ email: 'stale@example.com' });
      expect(email.sent).toHaveLength(0);

      // The pending-invitation partial unique no longer blocks a new invitation for that address.
      await expect(invite(wsA, 'stale@example.com', 'PENDING', 7)).resolves.toBeTruthy();
      // A second run expires nothing.
      await expect(run(fakeJob(INVITATION_EXPIRE_JOB))).resolves.toEqual({ expired: 0 });
    });
  });
});
