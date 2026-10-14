import { authenticator } from 'otplib';

/** Current 6-digit TOTP for `secret` (same algorithm and window the API verifies). */
export function totpCode(secret: string): string {
  return authenticator.generate(secret);
}

/** A code guaranteed to differ from the current one (wrong-code e2e paths). */
export function wrongTotpCode(secret: string): string {
  return String((Number(totpCode(secret)) + 1) % 1_000_000).padStart(6, '0');
}
