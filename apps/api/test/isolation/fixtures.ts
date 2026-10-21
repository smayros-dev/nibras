import {
  systemPrisma,
  type AbuseReport,
  type Course,
  type Enrollment,
  type GuardianLink,
  type Invitation,
  type InviteLink,
  type Lesson,
  type MediaAsset,
  type Module,
  type TeacherStudentAssignment,
  type User,
  type Workspace,
} from '@nibras/db';
import { createS3StorageProviderFromEnv, storageKeyFor } from '@nibras/providers';
import { expect } from 'vitest';
import type { RouteInfo } from '../../src/openapi/export';
import {
  assign,
  createAbuseReport,
  createCourse,
  createEnrollment,
  createInvitation,
  createInviteLink,
  createLesson,
  createMediaAsset,
  createModule,
  createOrganization,
  createStudent,
  createUser,
} from '../helpers/factories';

/**
 * Fixtures of the generic isolation suite (`tenant-routes.e2e-spec.ts`, SP1.6 F8). Two
 * organisations A and B with **disjoint** users and one row of every tenant resource each, so an
 * id of B exists only in B (Review Focus 4: a foreign-id probe must never hit an id that is also
 * valid in A). The tables below map route params, cursors and bodies to those rows; a new route
 * whose param or id-bearing body has no entry makes the suite fail with "add a … fixture".
 *
 * Routes are spelled as `listRoutes` prints them: `/api/v1/workspaces/:wid/…`.
 */

/** Base32 TOTP seed: organisation OWNER/ADMIN and super-admins clear the 2FA gate with it. */
export const TOTP_SEED = 'JBSWY3DPEHPK3PXP';

export interface Tenant {
  workspace: Workspace;
  /**
   * ACTIVE OWNER, 2FA on, verified teacher (phone + CODE_OF_CONDUCT, SP2): the
   * `@RequireVerifiedTeacher()` routes reach their service, so the path / body is what is probed.
   * SP3: `canTeach`, so `course.create` (an ADMIN-column cell that needs it) reaches the service.
   */
  owner: User;
  /** ACTIVE ADMIN, 2FA on. */
  admin: User;
  /** ACTIVE TEACHER, assigned `student`, the reported user of `report`. */
  teacher: User;
  /** ACTIVE STUDENT, the reporter of `report`. */
  student: User;
  report: AbuseReport;
  assignment: TeacherStudentAssignment;
  /** One `audit_log` row of this workspace (a cursor of its audit log). */
  auditEntryId: string;
  /** SP2: a PENDING email invitation of this workspace, sent by the OWNER. */
  invitation: Invitation;
  /** SP2: an ACTIVE group invite link of this workspace. */
  inviteLink: InviteLink;
  /** SP2: an adult STUDENT in `PENDING_APPROVAL` (joined by a code with approval). */
  pendingStudent: User;
  /** SP2: a minor STUDENT in `PENDING_GUARDIAN_CONSENT`, his guardian link sent (`PENDING`). */
  consentStudent: User;
  consentLink: GuardianLink;
  /** SP3: a DRAFT course (version 1) owned by `teacher`, without cover. */
  course: Course;
  /** SP3: a READY IMAGE uploaded by `owner` (a valid cover inside this workspace only). */
  coverImage: MediaAsset;
  /** SP3 T6: the first module of `course`. */
  module: Module;
  /** SP3 T6: a TEXT lesson (no image) of `module`. */
  lesson: Lesson;
  /** SP3 T6: a READY VIDEO uploaded by `owner` (a valid lesson media inside this workspace only). */
  video: MediaAsset;
  /** SP3 T7: a READY PDF uploaded by `owner` (playback and download). */
  pdf: MediaAsset;
  /** SP3 T7: an UPLOADING PDF of `owner` with a real multipart upload open in the test bucket. */
  upload: MediaAsset;
  /** SP3 T9: `student`'s ACTIVE enrollment in `course`. */
  enrollment: Enrollment;
}

export interface TenantPair {
  a: Tenant;
  b: Tenant;
}

async function createTenant(tag: 'A' | 'B'): Promise<Tenant> {
  const owner = await createUser({
    totpSecret: TOTP_SEED,
    firstName: `Owner${tag}`,
    phoneVerified: true,
    consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'],
  });
  const admin = await createUser({ totpSecret: TOTP_SEED, firstName: `Admin${tag}` });
  const teacher = await createUser({ firstName: `Teacher${tag}` });
  // The reporter: distinctive names so a response leaking them is caught by `expectNoReporter`.
  const student = await createUser({
    firstName: `Reporter${tag}Prenom`,
    lastName: `Reporter${tag}Nom`,
  });
  const { workspace } = await createOrganization({
    owner,
    admins: [admin],
    teachers: [teacher],
    students: [student],
    name: `Organisation ${tag}`,
  });
  // SP3: the organisation OWNER also teaches (course.create needs canTeach).
  await systemPrisma().membership.updateMany({
    where: { workspaceId: workspace.id, userId: owner.id },
    data: { canTeach: true },
  });
  const assignment = await assign(workspace, teacher, student, owner);
  const report = await createAbuseReport(workspace, student, teacher);
  const audit = await systemAudit(workspace, owner);
  const { invitation } = await createInvitation({ workspace, invitedBy: owner });
  const { link: inviteLink } = await createInviteLink({ workspace, createdBy: owner });
  const { user: pendingStudent } = await createStudent({
    workspace,
    status: 'PENDING_APPROVAL',
    user: { firstName: `Pending${tag}` },
  });
  const consent = await createStudent({
    workspace,
    status: 'PENDING_GUARDIAN_CONSENT',
    minor: true,
    invitedBy: owner,
    user: { firstName: `Minor${tag}` },
  });
  const course = await createCourse(workspace, teacher, { title: `Cours ${tag}` });
  const coverImage = await createMediaAsset(workspace, owner, { kind: 'IMAGE' });
  const module = await createModule(course);
  const lesson = await createLesson(module, { type: 'TEXT' });
  const video = await createMediaAsset(workspace, owner, { kind: 'VIDEO' });
  const pdf = await createMediaAsset(workspace, owner, { kind: 'PDF' });
  const upload = await createPendingUpload(workspace, owner);
  const enrollment = await createEnrollment(course, student);
  return {
    workspace,
    owner,
    admin,
    teacher,
    student,
    report,
    assignment,
    auditEntryId: audit,
    invitation,
    inviteLink,
    pendingStudent,
    consentStudent: consent.user,
    consentLink: consent.guardianLink!,
    course,
    coverImage,
    module,
    lesson,
    video,
    pdf,
    upload,
    enrollment,
  };
}

/**
 * An UPLOADING PDF whose multipart upload exists in this package's test bucket (MinIO, spec
 * D10), so `GET …/media/{mediaId}/upload` lists its parts like a real resume.
 */
async function createPendingUpload(workspace: Workspace, owner: User): Promise<MediaAsset> {
  const asset = await createMediaAsset(workspace, owner, { kind: 'PDF', status: 'UPLOADING' });
  const storageKey = storageKeyFor({
    workspaceId: workspace.id,
    kind: 'PDF',
    mediaId: asset.id,
    filename: 'cours.pdf',
  });
  const { uploadId } = await createS3StorageProviderFromEnv(process.env).createMultipartUpload(
    storageKey,
    'application/pdf',
  );
  return systemPrisma().mediaAsset.update({
    where: { id: asset.id },
    data: { storageKey, uploadId, uploadUrlExpiresAt: new Date(Date.now() + 3600_000) },
  });
}

async function systemAudit(workspace: Workspace, actor: User): Promise<string> {
  const row = await systemPrisma().auditLog.create({
    data: {
      workspaceId: workspace.id,
      actorUserId: actor.id,
      actorRole: 'OWNER',
      action: 'workspace.updated',
      entityType: 'Workspace',
      entityId: workspace.id,
      requestId: 'isolation-fixture',
    },
  });
  return row.id;
}

/** Organisations A (the caller's) and B (the foreign one), built in that order. */
export async function createTenantPair(): Promise<TenantPair> {
  const a = await createTenant('A');
  const b = await createTenant('B');
  return { a, b };
}

/** Every id that belongs to B only: none may appear in a response to A's members. */
export function foreignIds(p: TenantPair): string[] {
  const { b } = p;
  return [
    b.workspace.id,
    b.owner.id,
    b.admin.id,
    b.teacher.id,
    b.student.id,
    b.report.id,
    b.assignment.id,
    b.auditEntryId,
    b.invitation.id,
    b.inviteLink.id,
    b.pendingStudent.id,
    b.consentStudent.id,
    b.consentLink.id,
    b.course.id,
    b.coverImage.id,
    b.module.id,
    b.lesson.id,
    b.video.id,
    b.pdf.id,
    b.upload.id,
    b.enrollment.id,
  ];
}

/**
 * Path param → the row of a tenant it names. Keyed by the param as it appears in
 * `RouteInfo.path` (`':uid'`), or by `'<resource>/:param'` when the bare param is ambiguous
 * (`':id'`); the longest key matching the end of the path up to the param wins. A key may also
 * name the segments after the param (`'members/:uid/approve'`) when one action needs another row
 * than its siblings. `:wid` is the route's workspace and never looked up here.
 */
const PARAMS: Record<string, (t: Tenant) => string> = {
  // A member that is neither the OWNER nor the caller: GET/PATCH/DELETE reach a real row of A.
  ':uid': (t) => t.student.id,
  'abuse-reports/:id': (t) => t.report.id,
  'assignments/:id': (t) => t.assignment.id,
  // SP2.
  'invitations/:id': (t) => t.invitation.id,
  'invite-links/:id': (t) => t.inviteLink.id,
  // The approval queue decides a PENDING_APPROVAL STUDENT: B's one is decidable inside B.
  'members/:uid/approve': (t) => t.pendingStudent.id,
  'members/:uid/reject': (t) => t.pendingStudent.id,
  // A consent-waiting minor whose guardian link was sent: B's one could be re-sent inside B.
  'students/:uid/guardian': (t) => t.consentStudent.id,
  // SP3: a course (DRAFT, version 1) of the tenant.
  ':cid': (t) => t.course.id,
  // SP3 T6: the course's module and its TEXT lesson.
  ':mid': (t) => t.module.id,
  ':lid': (t) => t.lesson.id,
  // SP3 T7: a READY image of the tenant; the actions that need another state name their own row.
  ':mediaId': (t) => t.coverImage.id,
  'media/:mediaId/upload': (t) => t.upload.id,
  'media/:mediaId/complete': (t) => t.upload.id,
  'media/:mediaId/playback': (t) => t.pdf.id,
  'media/:mediaId/download': (t) => t.pdf.id,
  // SP3 T9: the enrolled student of the tenant's course.
  'enrollments/:uid': (t) => t.enrollment.studentUserId,
};

/** B's id for each path param: an ACTIVE OWNER of A calling with it gets `404 NOT_FOUND`. */
export const FOREIGN_PARAMS: Record<string, (p: TenantPair) => string> = Object.fromEntries(
  Object.entries(PARAMS).map(([key, get]) => [key, (p: TenantPair) => get(p.b)]),
);

/** A's own id for each path param (scenarios that must reach a real row of A). */
export const LOCAL_PARAMS: Record<string, (p: TenantPair) => string> = Object.fromEntries(
  Object.entries(PARAMS).map(([key, get]) => [key, (p: TenantPair) => get(p.a)]),
);

/**
 * The table key for the param at `index` of `segments` (longest match), or `undefined`: a key
 * matches when its segments line up with the route's, its own param at `index`.
 */
function paramKey(
  table: Record<string, unknown>,
  segments: string[],
  index: number,
): string | undefined {
  return Object.keys(table)
    .filter((key) => {
      const ks = key.split('/');
      const start = index - ks.indexOf(segments[index]!);
      return start >= 0 && start <= index && ks.every((k, j) => segments[start + j] === k);
    })
    .sort((x, y) => y.length - x.length)[0];
}

/** Params of `route` other than `:wid` (`[':uid']`). */
export function extraParams(route: RouteInfo): string[] {
  return route.path.split('/').filter((seg) => seg.startsWith(':') && seg !== ':wid');
}

/**
 * The URL of `route` in workspace `wid` with every other param taken from `table`. Throws
 * `missing fixture` (as an assertion failure naming the route) when a param has no entry.
 */
export function urlFor(
  route: RouteInfo,
  wid: string,
  table: Record<string, (p: TenantPair) => string>,
  p: TenantPair,
): string {
  const segments = route.path.split('/');
  return segments
    .map((seg, i) => {
      if (!seg.startsWith(':')) return seg;
      if (seg === ':wid') return wid;
      const key = paramKey(table, segments, i);
      if (key === undefined) {
        expect.fail(
          `${route.method} ${route.path}: add a FOREIGN_PARAMS fixture for ${seg} (PARAMS)`,
        );
      }
      return table[key]!(p);
    })
    .join('/');
}

/** Whether every param of `route` other than `:wid` has an entry in `table`. */
export function hasParamFixtures(
  route: RouteInfo,
  table: Record<string, (p: TenantPair) => string>,
): boolean {
  const segments = route.path.split('/');
  return segments.every(
    (seg, i) =>
      !seg.startsWith(':') || seg === ':wid' || paramKey(table, segments, i) !== undefined,
  );
}

/**
 * List routes whose `cursor` names a row: B's row as A's cursor → `422 VALIDATION_FAILED` on
 * `cursor`. Keyed by `'GET <path>'`.
 */
export const FOREIGN_QUERIES: Record<string, (p: TenantPair) => Record<string, string>> = {
  'GET /api/v1/workspaces/:wid/audit-log': (p) => ({ cursor: p.b.auditEntryId }),
  'GET /api/v1/workspaces/:wid/abuse-reports': (p) => ({ cursor: p.b.report.id }),
  'GET /api/v1/workspaces/:wid/members': (p) => ({ cursor: membersCursor(p.b.student) }),
  // SP2: an invitation id of this workspace (`invitations.service.ts`).
  'GET /api/v1/workspaces/:wid/invitations': (p) => ({ cursor: p.b.invitation.id }),
  // SP3: a course id of this workspace (`courses.service.ts`, Prisma cursor).
  'GET /api/v1/workspaces/:wid/courses': (p) => ({ cursor: p.b.course.id }),
  // SP3 T7: a media id of this workspace (`media.service.ts`, Prisma cursor).
  'GET /api/v1/workspaces/:wid/media': (p) => ({ cursor: p.b.coverImage.id }),
  // SP3 T9: an enrollment id of this workspace (`enrollments.service.ts`, Prisma cursor).
  'GET /api/v1/workspaces/:wid/courses/:cid/enrollments': (p) => ({ cursor: p.b.enrollment.id }),
  'GET /api/v1/workspaces/:wid/courses/:cid/progress': (p) => ({ cursor: p.b.enrollment.id }),
  // Not here: `GET …/assignments` pages with `id > cursor` inside `tenantDb(wid)`; a foreign id
  // only positions the scan over A's rows (nothing of B is read or revealed), so it stays `200`.
};

/** The `GET …/members` cursor of a member row (`members.service.ts`: last, first name, id). */
function membersCursor(user: Pick<User, 'id' | 'firstName' | 'lastName'>): string {
  return Buffer.from(JSON.stringify([user.lastName, user.firstName, user.id])).toString(
    'base64url',
  );
}

/**
 * Write routes whose body carries ids, with a body naming B's rows. `params` says which tenant's
 * ids fill the path: `'local'` when the route must reach A's own row so the **body** is what is
 * probed, `'foreign'` when the path itself is the foreign id. `headers` are sent with the probe
 * (SP3: `If-Match` with the fixture's version, so a versioned route reaches its body check). The
 * call must never be `2xx` and must leave no row referencing B's ids.
 */
export const FOREIGN_BODIES: Record<
  string,
  {
    params: 'local' | 'foreign';
    body: (p: TenantPair) => unknown;
    /** Further bodies probed on the same route, one id-bearing field at a time (SP3 T9). */
    more?: ((p: TenantPair) => unknown)[];
    headers?: Record<string, string>;
  }
> = {
  'POST /api/v1/workspaces/:wid/assignments': {
    params: 'local',
    body: (p) => ({ teacherUserId: p.b.teacher.id, studentUserId: p.b.student.id }),
  },
  'POST /api/v1/workspaces/:wid/abuse-reports': {
    params: 'local',
    body: (p) => ({
      category: 'HARASSMENT',
      description: 'Comportement inapproprié pendant la session.',
      entityType: 'USER',
      entityId: p.b.teacher.id,
    }),
  },
  // A's own report, assigned to B's admin.
  'PATCH /api/v1/workspaces/:wid/abuse-reports/:id': {
    params: 'local',
    body: (p) => ({ assignedToUserId: p.b.admin.id }),
  },
  'POST /api/v1/workspaces/:wid/transfer-ownership': {
    params: 'local',
    body: (p) => ({ toUserId: p.b.admin.id }),
  },
  // The id is in the path (B's member): also covered by `FOREIGN_PARAMS`, listed for the body.
  'PATCH /api/v1/workspaces/:wid/members/:uid': {
    params: 'foreign',
    body: () => ({ role: 'ADMIN' }),
  },
  // SP2: an invitation of A whose student would be assigned to B's teacher at acceptance.
  'POST /api/v1/workspaces/:wid/invitations': {
    params: 'local',
    body: (p) => ({ email: 'probe@example.com', teacherUserId: p.b.teacher.id }),
    // SP3 T9: an invitation of A that would enroll the student in B's course.
    more: [(p) => ({ email: 'probe-course@example.com', courseIds: [p.b.course.id] })],
  },
  // No id in the body (names, guardian email, message): the id is the path's (B's invitation).
  'PATCH /api/v1/workspaces/:wid/invitations/:id': {
    params: 'foreign',
    body: () => ({ firstName: 'X' }),
  },
  // A group code of A whose students would be assigned to B's teacher.
  'POST /api/v1/workspaces/:wid/invite-links': {
    params: 'local',
    body: (p) => ({ teacherUserId: p.b.teacher.id }),
    // SP3 T9: a group code of A whose students would be enrolled in B's course.
    more: [(p) => ({ courseIds: [p.b.course.id] })],
  },
  // No id in the body (label, status, limits); a non-empty body passes validation, so the path
  // (B's link) is what refuses the call.
  'PATCH /api/v1/workspaces/:wid/invite-links/:id': {
    params: 'foreign',
    body: () => ({ label: 'X' }),
  },
  // SP3: a course of A with B's image as its cover (Review Focus 5).
  'POST /api/v1/workspaces/:wid/courses': {
    params: 'local',
    body: (p) => ({ title: 'Sonde', coverMediaId: p.b.coverImage.id }),
  },
  // A's course (version 1, so the If-Match passes) given B's image as its cover.
  'PATCH /api/v1/workspaces/:wid/courses/:cid': {
    params: 'local',
    body: (p) => ({ coverMediaId: p.b.coverImage.id }),
    headers: { 'If-Match': '"1"' },
  },
  // A's course handed to B's teacher.
  'POST /api/v1/workspaces/:wid/courses/:cid/reassign': {
    params: 'local',
    body: (p) => ({ ownerUserId: p.b.teacher.id }),
  },
  // SP3 T6. No id in the body (title, flags, unlock rule): the path (B's course) refuses it.
  'POST /api/v1/workspaces/:wid/courses/:cid/modules': {
    params: 'foreign',
    body: () => ({ title: 'Sonde' }),
  },
  // A's modules reordered with B's module id (version 1, so the If-Match passes).
  'POST /api/v1/workspaces/:wid/courses/:cid/modules/reorder': {
    params: 'local',
    body: (p) => ({ ids: [p.b.module.id] }),
    headers: { 'If-Match': '"1"' },
  },
  // No id in the body: the path (B's module) refuses it.
  'PATCH /api/v1/workspaces/:wid/modules/:mid': {
    params: 'foreign',
    body: () => ({ title: 'Sonde' }),
    headers: { 'If-Match': '"1"' },
  },
  // A VIDEO lesson of A's module on B's video (Review Focus 5).
  'POST /api/v1/workspaces/:wid/modules/:mid/lessons': {
    params: 'local',
    body: (p) => ({ type: 'VIDEO', title: 'Sonde', mediaAssetId: p.b.video.id }),
    headers: { 'If-Match': '"1"' },
  },
  // A's lessons reordered with B's lesson id.
  'POST /api/v1/workspaces/:wid/modules/:mid/lessons/reorder': {
    params: 'local',
    body: (p) => ({ ids: [p.b.lesson.id] }),
    headers: { 'If-Match': '"1"' },
  },
  // A's TEXT lesson given B's image inline (Review Focus 5).
  'PATCH /api/v1/workspaces/:wid/lessons/:lid': {
    params: 'local',
    body: (p) => ({
      content: { type: 'doc', content: [{ type: 'image', attrs: { mediaId: p.b.coverImage.id } }] },
    }),
    headers: { 'If-Match': '"1"' },
  },
  // SP3 T9: B's student enrolled in A's course.
  'POST /api/v1/workspaces/:wid/courses/:cid/enrollments': {
    params: 'local',
    body: (p) => ({ studentUserIds: [p.b.student.id] }),
  },
};

/**
 * Write routes reviewed as carrying no id in their body (nothing to probe with B's ids). Their
 * path params are covered by `FOREIGN_PARAMS`. Each entry says why.
 */
export const BODYLESS_WRITE_ROUTES: Set<string> = new Set<string>([
  // No body: soft-deletes the route's own workspace.
  'DELETE /api/v1/workspaces/:wid',
  // Name, country, time zone, locale, `allowPersonalWorkspaces`: no id.
  'PATCH /api/v1/workspaces/:wid',
  // PRD §8.2.1 settings (ratios, durations, flags): no id.
  'PATCH /api/v1/workspaces/:wid/settings',
  // Optional `reason` (free text); the member is the path's `:uid`.
  'DELETE /api/v1/workspaces/:wid/members/:uid',
  // No body; the assignment is the path's `:id`.
  'DELETE /api/v1/workspaces/:wid/assignments/:id',
  // SP2. No body; the invitation is the path's `:id` (resend rotates its token, DELETE revokes).
  'POST /api/v1/workspaces/:wid/invitations/:id/resend',
  'DELETE /api/v1/workspaces/:wid/invitations/:id',
  // No body; disables the path's invite link.
  'DELETE /api/v1/workspaces/:wid/invite-links/:id',
  // No body; the PENDING_APPROVAL student is the path's `:uid`.
  'POST /api/v1/workspaces/:wid/members/:uid/approve',
  'POST /api/v1/workspaces/:wid/members/:uid/reject',
  // No body; the consent-waiting minor is the path's `:uid` (his guardian gets a new link).
  'POST /api/v1/workspaces/:wid/students/:uid/guardian/resend-consent',
  // SP3. No body; status transitions and the soft delete of the path's course (`:cid`).
  'POST /api/v1/workspaces/:wid/courses/:cid/publish',
  'POST /api/v1/workspaces/:wid/courses/:cid/unpublish',
  'POST /api/v1/workspaces/:wid/courses/:cid/archive',
  'POST /api/v1/workspaces/:wid/courses/:cid/restore',
  'DELETE /api/v1/workspaces/:wid/courses/:cid',
  // SP3 T6. No body; deletes the path's module (`:mid`) or lesson (`:lid`).
  'DELETE /api/v1/workspaces/:wid/modules/:mid',
  'DELETE /api/v1/workspaces/:wid/lessons/:lid',
  // SP3 T7. `kind`, `filename`, `mimeType`, `sizeBytes`: no id (the asset is created in `:wid`).
  'POST /api/v1/workspaces/:wid/media/uploads',
  // Part numbers and ETags only: the asset is the path's `:mediaId` (B's id → 404).
  'POST /api/v1/workspaces/:wid/media/:mediaId/complete',
  // No body; deletes the path's asset.
  'DELETE /api/v1/workspaces/:wid/media/:mediaId',
  // SP3 T9. Optional `reason` (free text); the course and the student are the path's.
  'DELETE /api/v1/workspaces/:wid/courses/:cid/enrollments/:uid',
]);

/** A key that never appears, at any depth, in an organisation-facing abuse-report response. */
const REPORTER_KEYS = ['reporter', 'reporterUserId'];

/**
 * AC-SAFE-02, owner Q1: an organisation-facing abuse-report response names no reporter — no
 * `reporter`/`reporterUserId` key at any depth and, given the reporter, none of his id, first
 * or last name anywhere in its JSON.
 */
export function expectNoReporter(body: unknown, label: string, reporter?: User): void {
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        expect(REPORTER_KEYS, `${label}: response carries "${key}"`).not.toContain(key);
        walk(inner);
      }
    }
  };
  walk(body);
  if (reporter) {
    const json = JSON.stringify(body ?? null);
    for (const needle of [reporter.id, reporter.firstName, reporter.lastName]) {
      expect(json, `${label}: response names the reporter`).not.toContain(needle);
    }
  }
}
