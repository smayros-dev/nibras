import { Prisma } from '@tt/db';

/** Whether `err` is a unique-constraint violation (`P2002`) on `column`. */
export function uniqueViolationOn(err: unknown, column: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  return Array.isArray(target) ? target.includes(column) : String(target).includes(column);
}
