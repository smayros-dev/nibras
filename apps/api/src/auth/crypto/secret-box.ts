import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1.';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PAYLOAD = /^[0-9a-f]+$/;

/**
 * Authenticated encryption for secrets at rest (TOTP seeds): AES-256-GCM with a random 96-bit
 * nonce per seal. Output: `v1.` + lowercase hex of `iv ‖ ciphertext ‖ tag`. The version prefix
 * lets a later key or algorithm rotation tell old values apart.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(`SecretBox key must decode to ${KEY_BYTES} bytes`);
    }
    this.key = key;
  }

  seal(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_BYTES });
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const payload = Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
    return VERSION + payload.toString('hex');
  }

  /** Throws a generic error on any malformed, tampered or foreign-key input. */
  open(sealed: string): string {
    if (!sealed.startsWith(VERSION)) throw new Error('SecretBox: unsupported format');
    const hex = sealed.slice(VERSION.length);
    // Strict hex (Buffer.from silently drops invalid digits), even length, room for iv + tag.
    if (!PAYLOAD.test(hex) || hex.length % 2 !== 0 || hex.length < 2 * (IV_BYTES + TAG_BYTES)) {
      throw new Error('SecretBox: malformed payload');
    }
    const payload = Buffer.from(hex, 'hex');
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(payload.length - TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES, payload.length - TAG_BYTES);
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_BYTES });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('SecretBox: authentication failed');
    }
  }
}
