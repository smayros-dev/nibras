import argon2 from 'argon2';

/** PRD §8.1.1: argon2id, 64 MiB, 3 passes, 1 lane. The salt is random per hash. */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/** `false` for a wrong password and for a malformed hash; never throws on bad input. */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
