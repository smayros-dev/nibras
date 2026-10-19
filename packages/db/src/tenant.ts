import { Prisma, type PrismaClient } from '@prisma/client';
import { createPrismaClient, systemPrisma } from './client';
import { NULLABLE_TENANT_MODELS, TENANT_MODELS, type TenantModel } from './tenancy';

/**
 * Tenant isolation, Prisma half of PRD §13.3 / D-P13. The other half is the `tenant_isolation`
 * RLS policy (migrations `rls_and_audit_privileges`, `consent_rls`); each barrier holds on its own
 * (tests run the extension through a BYPASSRLS client and RLS through raw SQL). Every client here
 * runs as `app_user` (`DATABASE_URL`, no BYPASSRLS):
 *
 * - `db` — non-tenant tables. Any operation on a `TENANT_MODELS` model throws
 *   `TenantContextMissingError`; on a `NULLABLE_TENANT_MODELS` model (Consent) it is limited to
 *   account-level rows (`workspaceId = null`), exactly what RLS shows without a context.
 * - `tenantDb(wid)` — injects `workspaceId` (Consent: `null` or `wid`) into every tenant operation
 *   and runs it in a batch transaction after `set_config('app.workspace_id', wid, true)`.
 * - `withTenantTx(wid, fn)` — interactive transaction with `app.workspace_id` set for its lifetime;
 *   use it for multi-statement writes and for raw SQL on tenant tables.
 * - `crossTenantDb()` — READ-ONLY, for `/me/…`, public token routes and system paths:
 *   `app.bypass_tenant = 'on'`, every tenant-model query needs a top-level `userId`/`id` equality
 *   filter or a plain string equality on one of the model's `CROSS_TENANT_LOOKUP_KEYS` (unique
 *   secret columns), and `include`/`select` (including `_count`) may not reach a tenant relation —
 *   issue a separate filtered query.
 *   `crossTenantDb({ reason: 'super_admin', actor })` lifts the filter rule for the admin
 *   console's aggregates only: it checks the actor is a SUPER_ADMIN and writes the
 *   `admin.cross_tenant_query` audit row in the same transaction as the query. ESLint allows that
 *   form only under `apps/api/src/admin/**` and tests (`@nibras/config/eslint/base`).
 *
 * Only top-level model operations are intercepted. Tenant rows reached through a relation of a
 * non-tenant model (`db.user.findMany({ include: { memberships: true } })`), raw SQL outside
 * `withTenantTx`, and nested writes are left to RLS, which fails closed (0 rows / policy error).
 *
 * Creating a workspace with its OWNER membership atomically: pre-generate the id, then create both
 * rows in one tenant transaction (Workspace is not a tenant model, so it passes through; the
 * membership is scoped to the new id and satisfies RLS WITH CHECK):
 *
 *     const id = uuidv7();
 *     await withTenantTx(id, async (tx) => {
 *       const workspace = await tx.workspace.create({ data: { id, ...fields } });
 *       await tx.membership.create({ data: { userId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
 *       return workspace;
 *     });
 */

export class TenantContextMissingError extends Error {
  readonly code = 'TENANT_CONTEXT_MISSING' as const;
  constructor(model: string, operation: string) {
    super(
      `TenantContextMissing: ${model}.${operation} needs a tenant context (tenantDb, withTenantTx or crossTenantDb)`,
    );
    this.name = 'TenantContextMissingError';
  }
}

export class TenantMismatchError extends Error {
  readonly code = 'TENANT_MISMATCH' as const;
  constructor(model: string, operation: string, workspaceId: string) {
    super(`TenantMismatch: ${model}.${operation} targets a workspace other than ${workspaceId}`);
    this.name = 'TenantMismatchError';
  }
}

/** The filter keys every tenant model accepts in `crossTenantDb()`. */
const BASE_FILTER_KEYS = ['userId', 'id'] as const;

export class CrossTenantFilterMissingError extends Error {
  readonly code = 'CROSS_TENANT_FILTER_MISSING' as const;
  constructor(model: string, operation: string, keys: readonly string[] = BASE_FILTER_KEYS) {
    super(
      `CrossTenantFilterMissing: ${model}.${operation} via crossTenantDb needs a top-level where equality filter on one of: ${keys.join(', ')}`,
    );
    this.name = 'CrossTenantFilterMissingError';
  }
}

/**
 * Unique secret columns that may resolve a tenant row through `crossTenantDb()` on their own (PRD
 * §13.3 "always filtered", SP2 spec §3): a public token route looks the row up by the hash of the
 * token it was given (or by the invite code), learns its `workspaceId`, then does every write under
 * `withTenantTx(workspaceId)`. Only a plain, non-empty string equality counts — never an object
 * filter (`contains`, `in`, `not`…) and never a non-secret column such as `email` or `status`.
 */
export const CROSS_TENANT_LOOKUP_KEYS = {
  Invitation: ['tokenHash'],
  InviteLink: ['code'],
  GuardianLink: ['consentTokenHash', 'sessionsViewTokenHash'],
} as const satisfies Partial<Record<TenantModel, readonly string[]>>;

/**
 * Extra user-scoped filter keys per model, accepted exactly like `userId`: the column holds the
 * data subject's own id (not a secret), so a caller filtering on it reads that user's rows only.
 * `GuardianLink.studentUserId`: the student reads his guardian links across workspaces
 * (`/me/workspaces`).
 */
const USER_SCOPED_KEYS: Partial<Record<TenantModel, readonly string[]>> = {
  GuardianLink: ['studentUserId'],
};

function userKeys(model: string): readonly string[] {
  return [
    ...BASE_FILTER_KEYS,
    ...((USER_SCOPED_KEYS as Partial<Record<string, readonly string[]>>)[model] ?? []),
  ];
}

function lookupKeys(model: string): readonly string[] {
  return (CROSS_TENANT_LOOKUP_KEYS as Partial<Record<string, readonly string[]>>)[model] ?? [];
}

/** A `crossTenantDb` call shape that is never allowed (write, nested tenant relation, bad actor). */
export class CrossTenantOperationError extends Error {
  readonly code = 'CROSS_TENANT_OPERATION_REFUSED' as const;
  constructor(model: string, operation: string, why: string) {
    super(`CrossTenantOperationRefused: ${model}.${operation} via crossTenantDb: ${why}`);
    this.name = 'CrossTenantOperationError';
  }
}

export type PrismaLogHandler = (
  level: 'warn' | 'error',
  event: { message: string; target?: string; timestamp: Date },
) => void;

/** Super-admin cross-tenant mode; the actor is verified and audited on every query. */
export type SuperAdminCrossTenant = {
  reason: 'super_admin';
  actor: { userId: string; requestId: string };
};

export const CROSS_TENANT_AUDIT_ACTION = 'admin.cross_tenant_query';

const TENANT = new Set<string>(TENANT_MODELS);
const NULLABLE_TENANT = new Set<string>(NULLABLE_TENANT_MODELS);
const isScoped = (model: string) => TENANT.has(model) || NULLABLE_TENANT.has(model);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** model → relation field → related model, from the generated client's DMMF. */
const RELATIONS = new Map(
  Prisma.dmmf.datamodel.models.map((m) => [
    m.name,
    new Map(m.fields.filter((f) => f.kind === 'object').map((f) => [f.name, f.type])),
  ]),
);

type Args = Record<string, unknown>;

const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);
const WHERE_OPERATIONS = new Set([
  ...READ_OPERATIONS,
  'delete',
  'deleteMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
]);
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

function assertWorkspaceId(workspaceId: string): void {
  if (typeof workspaceId !== 'string' || !UUID.test(workspaceId)) {
    throw new TypeError(`tenant: workspaceId must be a uuid, got ${JSON.stringify(workspaceId)}`);
  }
}

function isObject(value: unknown): value is Args {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `where AND filter`. Prisma ≥ 5 accepts `AND` alongside the unique keys of a WhereUniqueInput. */
function andWhere(where: unknown, filter: Args): Args {
  const base = isObject(where) ? where : {};
  const and = base.AND === undefined ? [] : Array.isArray(base.AND) ? base.AND : [base.AND];
  return { ...base, AND: [...and, filter] };
}

/**
 * How one model is scoped for one workspace (`null` = no tenant context):
 * strict tenant models → `workspaceId = wid`, filled in on create;
 * nullable ones (Consent) → `workspaceId IS NULL OR = wid`, never filled in (NULL = account-level).
 */
type Scope = { filter: Args; allowed: (string | null)[]; fill: string | undefined };

function scopeFor(model: string, workspaceId: string | null): Scope | undefined {
  if (TENANT.has(model)) {
    if (workspaceId === null) return undefined;
    return { filter: { workspaceId }, allowed: [workspaceId], fill: workspaceId };
  }
  if (workspaceId === null)
    return { filter: { workspaceId: null }, allowed: [null], fill: undefined };
  return {
    filter: { OR: [{ workspaceId: null }, { workspaceId }] },
    allowed: [null, workspaceId],
    fill: undefined,
  };
}

/** Rejects a `data` that names a workspace outside the scope; on create, fills in `workspaceId`. */
function scopeData(data: unknown, scope: Scope, creating: boolean, fail: () => never): unknown {
  if (Array.isArray(data)) return data.map((d) => scopeData(d, scope, creating, fail));
  if (!isObject(data)) return data;
  if ('workspace' in data) {
    // Relation form: only `connect` to this very workspace is allowed.
    const rel = data.workspace;
    const keys = isObject(rel) ? Object.keys(rel) : [];
    const connect = isObject(rel) ? rel.connect : undefined;
    if (keys.length !== 1 || !isObject(connect) || connect.id !== scope.fill) fail();
    return data;
  }
  let given = data.workspaceId;
  if (isObject(given) && 'set' in given) given = given.set;
  if (given !== undefined && !scope.allowed.includes(given as string | null)) fail();
  return creating && scope.fill !== undefined ? { ...data, workspaceId: scope.fill } : data;
}

function scopeArgs(
  model: string,
  operation: string,
  args: unknown,
  workspaceId: string | null,
): Args {
  const scope = scopeFor(model, workspaceId);
  if (!scope) throw new TenantContextMissingError(model, operation);
  const a: Args = isObject(args) ? { ...args } : {};
  const fail = (): never => {
    if (workspaceId === null) throw new TenantContextMissingError(model, operation);
    throw new TenantMismatchError(model, operation, workspaceId);
  };
  if (CREATE_OPERATIONS.has(operation)) {
    a.data = scopeData(a.data, scope, true, fail);
    return a;
  }
  if (!WHERE_OPERATIONS.has(operation)) {
    throw new Error(`tenant: unsupported operation ${model}.${operation}`);
  }
  a.where = andWhere(a.where, scope.filter);
  if (operation === 'upsert') {
    a.create = scopeData(a.create, scope, true, fail);
    a.update = scopeData(a.update, scope, false, fail);
  } else if ('data' in a) {
    a.data = scopeData(a.data, scope, false, fail);
  }
  return a;
}

/**
 * The "always filtered" rule of `crossTenantDb()`: a top-level `userId`/`id` equality (or one on
 * the model's `USER_SCOPED_KEYS`; `'x'`, `{ equals: 'x' }` or a non-empty `{ in: [...] }`), or a
 * plain non-empty string on one of the model's `CROSS_TENANT_LOOKUP_KEYS`.
 */
function hasCrossTenantFilter(model: string, args: unknown): boolean {
  const where = isObject(args) ? args.where : undefined;
  if (!isObject(where)) return false;
  const byUserOrId = userKeys(model).some((key) => {
    const v = where[key];
    if (typeof v === 'string') return true;
    if (!isObject(v) || Object.keys(v).length !== 1) return false;
    if (typeof v.equals === 'string') return true;
    return Array.isArray(v.in) && v.in.length > 0 && v.in.every((x) => typeof x === 'string');
  });
  if (byUserOrId) return true;
  return lookupKeys(model).some((key) => {
    const v = where[key];
    return typeof v === 'string' && v.length > 0;
  });
}

/** The first tenant relation reachable through `include`/`select` (incl. `_count`), if any. */
function nestedTenantRelation(model: string, node: unknown): string | undefined {
  if (!isObject(node)) return undefined;
  const relations = RELATIONS.get(model) ?? new Map<string, string>();
  for (const key of ['include', 'select'] as const) {
    const tree = node[key];
    if (!isObject(tree)) continue;
    for (const [field, value] of Object.entries(tree)) {
      if (!value) continue;
      if (field === '_count') {
        const counted = isObject(value) && isObject(value.select) ? value.select : undefined;
        for (const [rel, target] of relations) {
          if (isScoped(target) && (counted ? Boolean(counted[rel]) : true)) return `_count.${rel}`;
        }
        continue;
      }
      const target = relations.get(field);
      if (target === undefined) continue;
      if (isScoped(target)) return field;
      const deeper = nestedTenantRelation(target, value);
      if (deeper) return `${field}.${deeper}`;
    }
  }
  return undefined;
}

function refuseTransaction(..._args: unknown[]): never {
  throw new Error(
    'tenant: $transaction is not available on tenantDb/crossTenantDb, use withTenantTx',
  );
}

function setWorkspace(client: PrismaClient, workspaceId: string) {
  return client.$executeRaw`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
}

function guarded(base: PrismaClient) {
  return base.$extends({
    name: 'tenant-guard',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isScoped(model)) return query(args);
          return query(scopeArgs(model, operation, args, null));
        },
      },
    },
  });
}

function scoped(base: PrismaClient, workspaceId: string) {
  return base.$extends({
    name: 'tenant-scope',
    client: { $transaction: refuseTransaction },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isScoped(model)) return query(args);
          const scopedArgs = scopeArgs(model, operation, args, workspaceId);
          // The Prisma RLS recipe: set_config(..., true) is transaction-local, so both statements
          // run in one batch transaction on one connection and nothing leaks to the pool.
          const [, result] = await base.$transaction([
            setWorkspace(base, workspaceId),
            query(scopedArgs) as Prisma.PrismaPromise<unknown>,
          ]);
          return result;
        },
      },
    },
  });
}

/** Argument scoping only; `withTenantTx` has already set `app.workspace_id` for the transaction. */
function scopedInTransaction(base: PrismaClient, workspaceId: string) {
  return base.$extends({
    name: 'tenant-scope-tx',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isScoped(model)) return query(args);
          return query(scopeArgs(model, operation, args, workspaceId));
        },
      },
    },
  });
}

function assertActor(actor: unknown): asserts actor is SuperAdminCrossTenant['actor'] {
  const ok =
    isObject(actor) &&
    typeof actor.userId === 'string' &&
    UUID.test(actor.userId) &&
    typeof actor.requestId === 'string' &&
    actor.requestId.length > 0;
  if (!ok) {
    throw new TypeError('crossTenantDb: super_admin mode needs actor { userId: uuid, requestId }');
  }
}

function crossTenant(base: PrismaClient, superAdmin: SuperAdminCrossTenant | undefined) {
  return base.$extends({
    name: 'tenant-cross',
    client: { $transaction: refuseTransaction },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!READ_OPERATIONS.has(operation)) {
            throw new CrossTenantOperationError(model, operation, 'read-only');
          }
          const nested = nestedTenantRelation(model, args);
          if (nested) {
            throw new CrossTenantOperationError(
              model,
              operation,
              `include/select reaches tenant relation "${nested}"; query it separately with its own userId filter`,
            );
          }
          if (!isScoped(model)) return query(args);
          if (!superAdmin) {
            if (!hasCrossTenantFilter(model, args)) {
              throw new CrossTenantFilterMissingError(model, operation, [
                ...userKeys(model),
                ...lookupKeys(model),
              ]);
            }
            const [, result] = await base.$transaction([
              base.$executeRaw`SELECT set_config('app.bypass_tenant', 'on', true)`,
              query(args) as Prisma.PrismaPromise<unknown>,
            ]);
            return result;
          }
          const { actor } = superAdmin;
          const user = await base.user.findUnique({
            where: { id: actor.userId },
            select: { platformRole: true, status: true },
          });
          if (user?.platformRole !== 'SUPER_ADMIN' || user.status !== 'ACTIVE') {
            throw new CrossTenantOperationError(
              model,
              operation,
              'actor is not an active SUPER_ADMIN',
            );
          }
          // The audit row commits or rolls back with the query (same batch transaction). Only the
          // model and operation are recorded, never the query arguments.
          const [, , result] = await base.$transaction([
            base.$executeRaw`SELECT set_config('app.bypass_tenant', 'on', true)`,
            base.auditLog.create({
              data: {
                action: CROSS_TENANT_AUDIT_ACTION,
                actorUserId: actor.userId,
                actorRole: 'SUPER_ADMIN',
                entityType: model,
                after: { operation },
                requestId: actor.requestId,
              },
            }),
            query(args) as Prisma.PrismaPromise<unknown>,
          ]);
          return result;
        },
      },
    },
  });
}

export type GuardedClient = ReturnType<typeof guarded>;
export type TenantClient = ReturnType<typeof scoped>;
export type CrossTenantClient = ReturnType<typeof crossTenant>;
/** The client handed to `withTenantTx`'s callback: tenant-scoped, no `$transaction`/`$connect`. */
export type TenantTx = Omit<
  ReturnType<typeof scopedInTransaction>,
  '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'
>;

/**
 * Builds the tenancy API over a lazily created base client. Exported for tests that need a
 * dedicated base (`connection_limit=1`, or the BYPASSRLS system client to test the extension
 * alone); application code uses the module-level exports.
 */
export function bindTenancy(base: () => PrismaClient) {
  let guardedClient: GuardedClient | undefined;
  return {
    get db(): GuardedClient {
      guardedClient ??= guarded(base());
      return guardedClient;
    },
    tenantDb(workspaceId: string): TenantClient {
      assertWorkspaceId(workspaceId);
      return scoped(base(), workspaceId);
    },
    crossTenantDb(opts?: SuperAdminCrossTenant): CrossTenantClient {
      if (opts !== undefined) {
        if (opts.reason !== 'super_admin') {
          throw new TypeError('crossTenantDb: unknown reason');
        }
        assertActor(opts.actor);
      }
      return crossTenant(base(), opts);
    },
    async withTenantTx<T>(workspaceId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
      assertWorkspaceId(workspaceId);
      return scopedInTransaction(base(), workspaceId).$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
        return fn(tx);
      });
    },
  };
}

let appBase: PrismaClient | undefined;
/** The un-extended `app_user` client behind `db`/`tenantDb`/`crossTenantDb` (kept for `$on`). */
function appClient(): PrismaClient {
  appBase ??= createPrismaClient();
  return appBase;
}

const tenancy = bindTenancy(appClient);

/** Defers creating the client to first use, so importing `@nibras/db` never needs `DATABASE_URL`. */
function lazy<T extends object>(make: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const target = make();
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
    has: (_target, prop) => Reflect.has(make(), prop),
  });
}

/** `app_user` client for non-tenant tables (Consent: account-level rows only). */
export const db: GuardedClient = lazy(() => tenancy.db);

export function tenantDb(workspaceId: string): TenantClient {
  return tenancy.tenantDb(workspaceId);
}

/**
 * Read-only cross-tenant client for `/me/…` and system paths (see the module comment). The
 * `super_admin` form is for the admin console only (enforced by ESLint) and audits every query.
 */
export function crossTenantDb(opts?: SuperAdminCrossTenant): CrossTenantClient {
  return tenancy.crossTenantDb(opts);
}

export function withTenantTx<T>(workspaceId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return tenancy.withTenantTx(workspaceId, fn);
}

/**
 * Forwards Prisma `warn`/`error` events of the `app_user` base client and of `systemPrisma()`
 * (`$on` is unavailable on `$extends` results). The API's logger module is the only caller.
 */
export function onPrismaLog(handler: PrismaLogHandler): void {
  for (const client of [appClient(), systemPrisma()]) {
    const c = client as unknown as PrismaClient<Prisma.PrismaClientOptions, 'warn' | 'error'>;
    for (const level of ['warn', 'error'] as const) {
      c.$on(level, (e: Prisma.LogEvent) =>
        handler(level, { message: e.message, target: e.target, timestamp: e.timestamp }),
      );
    }
  }
}
