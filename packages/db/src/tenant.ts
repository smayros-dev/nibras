import { Prisma, type PrismaClient } from '@prisma/client';
import { createPrismaClient, systemPrisma } from './client';
import { TENANT_MODELS } from './tenancy';

/**
 * Tenant isolation, Prisma half of PRD §13.3 / D-P13 (the other half is the `tenant_isolation`
 * RLS policy of the `rls_and_audit_privileges` migration). Every client here runs as `app_user`
 * (`DATABASE_URL`, no BYPASSRLS):
 *
 * - `db` — non-tenant tables only; any operation on a `TENANT_MODELS` model throws
 *   `TenantContextMissingError` (and RLS would return 0 rows anyway).
 * - `tenantDb(wid)` — injects `workspaceId` into every tenant operation and runs it in a batch
 *   transaction after `set_config('app.workspace_id', wid, true)` (transaction-local).
 * - `withTenantTx(wid, fn)` — interactive transaction with `app.workspace_id` set for its lifetime;
 *   use it for multi-statement writes and for raw SQL on tenant tables.
 * - `crossTenantDb()` — `app.bypass_tenant = 'on'` for `/me/…` and system paths, only with a
 *   top-level `userId`/`id` filter on tenant models (or `{ reason: 'super_admin' }`).
 *
 * Only top-level model operations are intercepted. Tenant rows reached through a relation of a
 * non-tenant model (`db.user.findMany({ include: { memberships: true } })`), raw SQL outside
 * `withTenantTx`, and nested writes are left to RLS, which fails closed (0 rows / policy error).
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

export class CrossTenantFilterMissingError extends Error {
  readonly code = 'CROSS_TENANT_FILTER_MISSING' as const;
  constructor(model: string, operation: string) {
    super(
      `CrossTenantFilterMissing: ${model}.${operation} via crossTenantDb needs a top-level where.userId or where.id equality filter (no create/upsert)`,
    );
    this.name = 'CrossTenantFilterMissingError';
  }
}

export type PrismaLogHandler = (
  level: 'warn' | 'error',
  event: { message: string; target?: string; timestamp: Date },
) => void;

const TENANT = new Set<string>(TENANT_MODELS);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Args = Record<string, unknown>;

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
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

/** `where AND workspaceId = wid`. Prisma ≥ 5 accepts `AND` alongside the unique keys of a WhereUniqueInput. */
function scopeWhere(where: unknown, workspaceId: string): Args {
  const base = isObject(where) ? where : {};
  const and = base.AND === undefined ? [] : Array.isArray(base.AND) ? base.AND : [base.AND];
  return { ...base, AND: [...and, { workspaceId }] };
}

/** Rejects a `data` that names another workspace; on create, fills in `workspaceId`. */
function scopeData(
  data: unknown,
  workspaceId: string,
  creating: boolean,
  fail: () => never,
): unknown {
  if (Array.isArray(data)) return data.map((d) => scopeData(d, workspaceId, creating, fail));
  if (!isObject(data)) return data;
  if ('workspace' in data) {
    // Relation form: only `connect` to this very workspace is allowed.
    const rel = data.workspace;
    const keys = isObject(rel) ? Object.keys(rel) : [];
    const connect = isObject(rel) ? rel.connect : undefined;
    if (keys.length !== 1 || !isObject(connect) || connect.id !== workspaceId) fail();
    return data;
  }
  let given = data.workspaceId;
  if (isObject(given) && 'set' in given) given = given.set;
  if (given !== undefined && given !== workspaceId) fail();
  return creating ? { ...data, workspaceId } : data;
}

function scopeArgs(model: string, operation: string, args: unknown, workspaceId: string): Args {
  const a: Args = isObject(args) ? { ...args } : {};
  const fail = (): never => {
    throw new TenantMismatchError(model, operation, workspaceId);
  };
  if (CREATE_OPERATIONS.has(operation)) {
    a.data = scopeData(a.data, workspaceId, true, fail);
    return a;
  }
  if (!WHERE_OPERATIONS.has(operation)) {
    throw new Error(`tenant: unsupported operation ${model}.${operation}`);
  }
  a.where = scopeWhere(a.where, workspaceId);
  if (operation === 'upsert') {
    a.create = scopeData(a.create, workspaceId, true, fail);
    a.update = scopeData(a.update, workspaceId, false, fail);
  } else if ('data' in a) {
    a.data = scopeData(a.data, workspaceId, false, fail);
  }
  return a;
}

/** A top-level `userId`/`id` equality (`'x'`, `{ equals: 'x' }` or a non-empty `{ in: [...] }`). */
function hasUserOrIdFilter(args: unknown): boolean {
  const where = isObject(args) ? args.where : undefined;
  if (!isObject(where)) return false;
  return ['userId', 'id'].some((key) => {
    const v = where[key];
    if (typeof v === 'string') return true;
    if (!isObject(v)) return false;
    const keys = Object.keys(v);
    if (keys.length !== 1) return false;
    if (typeof v.equals === 'string') return true;
    return Array.isArray(v.in) && v.in.length > 0 && v.in.every((x) => typeof x === 'string');
  });
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
          if (TENANT.has(model)) throw new TenantContextMissingError(model, operation);
          return query(args);
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
          if (!TENANT.has(model)) return query(args);
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
          if (!TENANT.has(model)) return query(args);
          return query(scopeArgs(model, operation, args, workspaceId));
        },
      },
    },
  });
}

function crossTenant(base: PrismaClient, superAdmin: boolean) {
  return base.$extends({
    name: 'tenant-cross',
    client: { $transaction: refuseTransaction },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT.has(model)) return query(args);
          // Creates have no `where`; an upsert's `create` branch could insert into any workspace.
          if (!superAdmin && (operation === 'upsert' || !hasUserOrIdFilter(args))) {
            throw new CrossTenantFilterMissingError(model, operation);
          }
          const [, result] = await base.$transaction([
            base.$executeRaw`SELECT set_config('app.bypass_tenant', 'on', true)`,
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
 * Builds the tenancy API over a lazily created `app_user` base client. Exported for tests that need
 * a dedicated base (e.g. `connection_limit=1`); application code uses the module-level exports.
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
    crossTenantDb(opts?: { reason: 'super_admin' }): CrossTenantClient {
      return crossTenant(base(), opts?.reason === 'super_admin');
    },
    async withTenantTx<T>(workspaceId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
      assertWorkspaceId(workspaceId);
      const client = base();
      return scopedInTransaction(client, workspaceId).$transaction(async (tx) => {
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

/** Defers creating the client to first use, so importing `@tt/db` never needs `DATABASE_URL`. */
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

/** `app_user` client for non-tenant tables; throws `TenantContextMissingError` on tenant models. */
export const db: GuardedClient = lazy(() => tenancy.db);

export function tenantDb(workspaceId: string): TenantClient {
  return tenancy.tenantDb(workspaceId);
}

/**
 * Cross-tenant reads for `/me/…` and system paths: tenant-model operations must carry a top-level
 * `userId`/`id` filter. `{ reason: 'super_admin' }` lifts that check for the admin console's
 * aggregates only; the caller must audit `admin.cross_tenant_query`.
 */
export function crossTenantDb(opts?: { reason: 'super_admin' }): CrossTenantClient {
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
