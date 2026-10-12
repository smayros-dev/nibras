/**
 * PRD §7 permission matrix (owner-locked, PRD §22: transcribed, never reinterpreted). Every
 * permission is evaluated in one workspace, from the caller's `Membership` there; `SUPER_ADMIN`
 * is outside the matrix (platform console only).
 *
 * Symbols: ✅ and 👁 → `all`, 🔒 → `own` (own resources only: courses he owns, students assigned
 * to him, sessions he hosts, children linked to him), ❌ → `none`; a cell tagged (P1)/(P2) → `none`
 * (not available at MVP). Qualifiers on a ✅/👁 cell ("le sien", "ses enfants", "si inscrit",
 * "si `allow_download`", "si participant") are business conditions the owning service still
 * enforces on the rows: the matrix only says the capability exists for the role.
 *
 * Rows outside §7's literal capability list: `workspace.members.read` (member directory, used by
 * `GET /workspaces/{wid}/members`) follows the staff and student-profile rows: ADMIN `all`,
 * TEACHER/ASSISTANT `own` (their assigned students), STUDENT/GUARDIAN `none`.
 */

export const MEMBERSHIP_ROLES = [
  'OWNER',
  'ADMIN',
  'TEACHER',
  'ASSISTANT',
  'STUDENT',
  'GUARDIAN',
] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const WORKSPACE_TYPES = ['PERSONAL', 'ORGANIZATION'] as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

/** The five §7 columns; `OWNER / ADMIN (org)` is `ADMIN`, `TEACHER (ou OWNER personnel)` is `TEACHER`. */
export const MATRIX_ROLES = ['ADMIN', 'TEACHER', 'ASSISTANT', 'STUDENT', 'GUARDIAN'] as const;
export type MatrixRole = (typeof MATRIX_ROLES)[number];

export const PERMISSIONS = [
  // Espace
  'workspace.settings.update',
  'workspace.staff.manage',
  'workspace.delete',
  'workspace.transfer',
  'workspace.audit.read',
  'workspace.members.read',
  // Étudiants
  'student.invite',
  'student.assign',
  'student.read',
  'student.update',
  'student.remove',
  'abuse.report',
  'abuse.handle',
  // Cours
  'course.create',
  'course.manage',
  'course.delete',
  'course.media.manage',
  'enrollment.manage',
  'course.reassign',
  'course.read',
  'pdf.download',
  'progress.read',
  // Sessions
  'session.manage',
  'room.open',
  'room.join',
  'room.moderate',
  'calendar.read',
  'session.history.read',
  'attendance.read',
  'attendance.override',
  // Compte rendu
  'report.write',
  'report.read',
  'report.private_notes.read',
  // Messagerie
  'message.direct',
  // Analytics
  'dashboard.teacher',
  // Compte
  'account.export',
  'account.delete',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type Grant = 'all' | 'own' | 'none';

type Row = Record<MatrixRole, Grant>;

/** One row: ADMIN, TEACHER, ASSISTANT, STUDENT, GUARDIAN (the §7 column order). */
const row = (
  ADMIN: Grant,
  TEACHER: Grant,
  ASSISTANT: Grant,
  STUDENT: Grant,
  GUARDIAN: Grant,
): Row => ({
  ADMIN,
  TEACHER,
  ASSISTANT,
  STUDENT,
  GUARDIAN,
});

// prettier-ignore
export const MATRIX: Record<Permission, Row> = {
  // ── Espace ───────────────────────────────────────────────────────────────────────────────
  // ✅ | ✅ (espace personnel) / ❌ (org) | ❌ | ❌ | ❌ — personal cell via PERSONAL_OWNER_OVERRIDES
  'workspace.settings.update': row('all', 'none', 'none', 'none', 'none'),
  // Inviter / retirer un professeur, un admin: ✅ | ❌ | ❌ | ❌ | ❌
  'workspace.staff.manage':    row('all', 'none', 'none', 'none', 'none'),
  // OWNER seul | OWNER seul | ❌ | ❌ | ❌ — via OWNER_ONLY
  'workspace.delete':          row('none', 'none', 'none', 'none', 'none'),
  'workspace.transfer':        row('none', 'none', 'none', 'none', 'none'),
  // ✅ | ✅ (personnel) | ❌ | ❌ | ❌ — personal cell via PERSONAL_OWNER_OVERRIDES
  'workspace.audit.read':      row('all', 'none', 'none', 'none', 'none'),
  // Not a §7 row (see the module comment).
  'workspace.members.read':    row('all', 'own', 'own', 'none', 'none'),
  // ── Étudiants ────────────────────────────────────────────────────────────────────────────
  // Inviter un étudiant: ✅ | ✅ | ❌ | ❌ | ❌
  'student.invite':            row('all', 'all', 'none', 'none', 'none'),
  // Affecter un étudiant à un professeur (org): ✅ | ❌ | ❌ | ❌ | ❌
  'student.assign':            row('all', 'none', 'none', 'none', 'none'),
  // Voir le profil pédagogique: ✅ | 🔒 | 🔒 | 👁 (le sien) | 👁 (ses enfants)
  'student.read':              row('all', 'own', 'own', 'all', 'all'),
  // Modifier les informations: ✅ | 🔒 | ❌ | ✅ (le sien, hors email vérifié) | ❌
  'student.update':            row('all', 'own', 'none', 'all', 'none'),
  // Retirer un étudiant: ✅ (admins/owner) | ✅ (personnel, OWNER) / ❌ (org) | ❌ | ❌ | ❌
  'student.remove':            row('all', 'none', 'none', 'none', 'none'),
  // Signaler un abus: ✅ ×5
  'abuse.report':              row('all', 'all', 'all', 'all', 'all'),
  // Traiter un signalement: ✅ (de son organisation) | ❌ | ❌ | ❌ | ❌
  'abuse.handle':              row('all', 'none', 'none', 'none', 'none'),
  // ── Cours ────────────────────────────────────────────────────────────────────────────────
  // Créer un cours: ✅ (si can_teach) | ✅ | ❌ | ❌ | ❌ — can_teach rule in grantFor
  'course.create':             row('all', 'all', 'none', 'none', 'none'),
  // Modifier / publier / archiver: ✅ | 🔒 | ❌ | ❌ | ❌
  'course.manage':             row('all', 'own', 'none', 'none', 'none'),
  // Supprimer un cours: ✅ | 🔒 | ❌ | ❌ | ❌
  'course.delete':             row('all', 'own', 'none', 'none', 'none'),
  // Ajouter vidéo / PDF / texte: ✅ | 🔒 | 🔒 (P1) | ❌ | ❌
  'course.media.manage':       row('all', 'own', 'none', 'none', 'none'),
  // Attribuer / retirer un cours à un étudiant: ✅ | 🔒 | ❌ | ❌ | ❌
  'enrollment.manage':         row('all', 'own', 'none', 'none', 'none'),
  // Réaffecter un cours à un autre professeur: ✅ | ❌ | ❌ | ❌ | ❌
  'course.reassign':           row('all', 'none', 'none', 'none', 'none'),
  // Consulter un cours: 👁 | 🔒 | 🔒 | ✅ (si inscrit et publié) | ❌ (titres et progression seulement)
  'course.read':               row('all', 'own', 'own', 'all', 'none'),
  // Télécharger un PDF: ✅ | 🔒 | 🔒 | ✅ si allow_download | ❌
  'pdf.download':              row('all', 'own', 'own', 'all', 'none'),
  // Voir la progression: ✅ | 🔒 | 🔒 | ✅ (la sienne) | 👁 (ses enfants)
  'progress.read':             row('all', 'own', 'own', 'all', 'all'),
  // ── Sessions ─────────────────────────────────────────────────────────────────────────────
  // Programmer / modifier / annuler: ✅ | 🔒 | ❌ | ❌ (réserver : P1) | ❌
  'session.manage':            row('all', 'own', 'none', 'none', 'none'),
  // Ouvrir / terminer la salle: ❌ (sauf can_teach, 🔒) | 🔒 | 🔒 (co-animateur, P1) | ❌ | ❌
  'room.open':                 row('none', 'own', 'none', 'none', 'none'),
  // Rejoindre la salle: 👁 (observateur, P1) | 🔒 | 🔒 | ✅ si participant | ❌
  'room.join':                 row('none', 'own', 'own', 'all', 'none'),
  // Couper le micro / retirer un participant: ❌ | 🔒 | 🔒 | ❌ | ❌
  'room.moderate':             row('none', 'own', 'own', 'none', 'none'),
  // Voir le calendrier: ✅ (toute l'org) | 🔒 | 🔒 | ✅ (le sien) | 👁 (ses enfants)
  'calendar.read':             row('all', 'own', 'own', 'all', 'all'),
  // Voir l'historique des sessions: ✅ | 🔒 | 🔒 | ✅ (le sien) | 👁 (ses enfants)
  'session.history.read':      row('all', 'own', 'own', 'all', 'all'),
  // Voir / corriger la présence: ✅ / ✅ | 🔒 / 🔒 | 🔒 / 🔒 | 👁 (la sienne) | 👁
  'attendance.read':           row('all', 'own', 'own', 'all', 'all'),
  'attendance.override':       row('all', 'own', 'own', 'none', 'none'),
  // ── Compte rendu ─────────────────────────────────────────────────────────────────────────
  // Rédiger / modifier: ❌ | 🔒 | 🔒 (brouillon, P1) | ❌ | ❌
  'report.write':              row('none', 'own', 'none', 'none', 'none'),
  // Voir (partie visible étudiant): 👁 | 🔒 | 🔒 | ✅ (le sien) | 👁 (ses enfants)
  'report.read':               row('all', 'own', 'own', 'all', 'all'),
  // Voir la note privée du professeur: ❌ | 🔒 | ❌ | ❌ | ❌
  'report.private_notes.read': row('none', 'own', 'none', 'none', 'none'),
  // ── Messagerie ───────────────────────────────────────────────────────────────────────────
  // Message 1:1: ✅ | 🔒 | 🔒 | ✅ (ses professeurs) | ✅ (professeurs de ses enfants, P1)
  'message.direct':            row('all', 'own', 'own', 'all', 'none'),
  // ── Analytics ────────────────────────────────────────────────────────────────────────────
  // Dashboard professeur: ✅ (le sien si can_teach) | 🔒 | 🔒 | ❌ | ❌ — can_teach rule in grantFor
  'dashboard.teacher':         row('all', 'own', 'own', 'none', 'none'),
  // ── Compte ───────────────────────────────────────────────────────────────────────────────
  // Exporter ses données personnelles: ✅ ×5 (mineur : via tuteur ou lui-même)
  'account.export':            row('all', 'all', 'all', 'all', 'all'),
  // Supprimer son compte: ✅ ×5 (with the §7 preconditions, enforced by the account service)
  'account.delete':            row('all', 'all', 'all', 'all', 'all'),
};

/** §7 "OWNER seul" (both the organisation and the personal-owner columns). */
export const OWNER_ONLY: Permission[] = ['workspace.delete', 'workspace.transfer'];

/**
 * The cells where §7 says "(espace personnel)", for the OWNER of a PERSONAL workspace, and
 * `abuse.handle`: a personal owner never handles reports about himself (super-admin does).
 */
export const PERSONAL_OWNER_OVERRIDES: Partial<Record<Permission, Grant>> = {
  'workspace.settings.update': 'all',
  'workspace.audit.read': 'all',
  'student.remove': 'all',
  'abuse.handle': 'none',
};

/** ADMIN cells that need `can_teach` (AC-WS-03); `none` without it. */
const NEEDS_CAN_TEACH: ReadonlySet<Permission> = new Set<Permission>([
  'course.create',
  'dashboard.teacher',
]);

const RANK: Record<Grant, number> = { none: 0, own: 1, all: 2 };

/** `all > own > none`. */
export function maxGrant(a: Grant, b: Grant): Grant {
  return RANK[a] >= RANK[b] ? a : b;
}

export interface GrantContext {
  role: MembershipRole;
  canTeach: boolean;
  workspaceType: WorkspaceType;
}

/** The ADMIN column with the `can_teach` rules (for ADMIN and organisation OWNER). */
function adminGrant(canTeach: boolean, p: Permission): Grant {
  const admin = NEEDS_CAN_TEACH.has(p) && !canTeach ? 'none' : MATRIX[p].ADMIN;
  return canTeach ? maxGrant(admin, MATRIX[p].TEACHER) : admin;
}

/**
 * What `role` may do with `p` in a workspace of `workspaceType`:
 * - OWNER of a PERSONAL workspace: TEACHER column, `PERSONAL_OWNER_OVERRIDES` on top, plus
 *   `OWNER_ONLY` (§7 puts "OWNER seul" in that column too);
 * - OWNER of an ORGANIZATION: ADMIN column (with its `can_teach` rules) plus `OWNER_ONLY`;
 * - ADMIN: ADMIN column; `course.create`/`dashboard.teacher` need `canTeach`; with `canTeach`,
 *   the better of the ADMIN and TEACHER cells;
 * - TEACHER, ASSISTANT, STUDENT, GUARDIAN: their column.
 */
export function grantFor(ctx: GrantContext, p: Permission): Grant {
  switch (ctx.role) {
    case 'OWNER': {
      if (OWNER_ONLY.includes(p)) return 'all';
      if (ctx.workspaceType === 'PERSONAL') {
        return maxGrant(MATRIX[p].TEACHER, PERSONAL_OWNER_OVERRIDES[p] ?? 'none');
      }
      return adminGrant(ctx.canTeach, p);
    }
    case 'ADMIN':
      return adminGrant(ctx.canTeach, p);
    default:
      return MATRIX[p][ctx.role];
  }
}
