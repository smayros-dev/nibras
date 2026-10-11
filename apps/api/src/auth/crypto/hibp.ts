import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';

/** Breached-password lookup used by {@link PasswordPolicy}. */
export interface PwnedPasswordClient {
  isPwned(plain: string): Promise<boolean>;
}

export interface HibpClientOptions {
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  logger?: { warn(message: string): void };
}

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';

/**
 * Have I Been Pwned "Pwned Passwords" with k-anonymity: only the first 5 hex chars of the SHA-1
 * leave the process; the suffix is matched locally. `Add-Padding` hides the real bucket size.
 * Fail-open (planner ruling): on network error, timeout or non-2xx the password is treated as not
 * breached and a warning is logged — the 10 000-common list still applies.
 */
export class HibpClient implements PwnedPasswordClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly logger: { warn(message: string): void };

  constructor(options: HibpClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.logger = options.logger ?? new Logger(HibpClient.name);
  }

  async isPwned(plain: string): Promise<boolean> {
    const sha1 = createHash('sha1').update(plain, 'utf8').digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    let body: string;
    try {
      const res = await this.fetchImpl(RANGE_URL + prefix, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        this.logger.warn(`HIBP range lookup failed with HTTP ${res.status}; check skipped`);
        return false;
      }
      body = await res.text();
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'unknown error';
      this.logger.warn(`HIBP range lookup failed (${reason}); check skipped`);
      return false;
    }
    for (const line of body.split('\n')) {
      const [candidate, count] = line.trim().split(':');
      if (candidate?.toUpperCase() === suffix && Number(count) > 0) return true;
    }
    return false;
  }
}

/** Test double: reports exactly the given passwords as breached. */
export class FakePwnedClient implements PwnedPasswordClient {
  private readonly pwned: ReadonlySet<string>;

  constructor(set: string[]) {
    this.pwned = new Set(set);
  }

  isPwned(plain: string): Promise<boolean> {
    return Promise.resolve(this.pwned.has(plain));
  }
}
