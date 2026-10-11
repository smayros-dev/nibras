# Login throttling and account lockout (security note)

What the API does against password guessing (PRD §8.1.2, §14.7, AC-AUTH-03), what it costs, and
what to do when it misbehaves. Code: `apps/api/src/auth/login-throttle.service.ts` (login) and
`apps/api/src/common/rate-limit.module.ts` (global limits).

## Rules

| Scope              | Limit                                                                                                                                  | Answer                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| ip + email         | 5 failures / 60 s, then the n-th failure imposes a `min(60, 2^(n-5))` s wait                                                           | `429 RATE_LIMITED` + `Retry-After`   |
| email              | 10 failures / 15 min → locked 15 min, audit `auth.account_locked`, email `security.account_locked` (at most once per 24 h)             | `429 ACCOUNT_LOCKED` + `Retry-After` |
| authenticated user | 600 requests / 60 s, all routes                                                                                                        | `429 RATE_LIMITED`                   |
| client ip          | 60 requests / 60 s on unauthenticated requests and on every public route (login, register, password reset, refresh…) even with a token | `429 RATE_LIMITED`                   |

`/health/*` and `/metrics` are never limited. The client ip is `req.ip` (`TRUST_PROXY_HOPS`);
IPv6 clients are grouped per /64. Unknown emails are counted and locked exactly like existing ones,
so the answers never reveal whether an account exists. Each attempt is reserved atomically in Redis
before the password check, so concurrent requests cannot exceed the limits.

## Lockout-DoS trade-off

The PRD lock is kept: anyone who knows an email can keep that account locked by failing 10 times
every 15 minutes (from any number of ips). Accepted because the alternative (no email-wide lock)
leaves distributed guessing unbounded. Mitigations:

- the owner is alerted at most once per 24 h (no mail bombing through the lock);
- a **completed password reset** clears the lock and every counter of the email
  (`LoginThrottleService.clearForEmail`), so the owner always has a way back in. The password
  reset flow (SP1 Task 9) must call it after the new password is stored.

Signs of an attack: a burst of `auth.account_locked` / `auth.login_failed` audit entries for one
account, or many accounts from one ip range. Unlock one account by hand:

```sh
# h = sha256 of the lower-cased, trimmed email
redis-cli -n <db> DEL login:lock:<h> login:fail:<h>
```

## Redis failure policy

- **Login throttle: fails closed.** If Redis errors, `POST /auth/login` answers
  `503 SERVICE_UNAVAILABLE` before any password check: without the counters, login would be an
  unthrottled password oracle.
- **Global limits: fail open.** Other requests proceed unthrottled; the API logs
  `rate limiter unavailable, failing open` at most once a minute. Availability of the whole API
  outweighs a short window without global limits.

Either way, restore Redis first (`/health/ready` reports it).
