/**
 * The org's Slack webhook URL at rest (LABEL-38). The URL is a bearer secret
 * (whoever holds it can post to the channel), so it is stored only as
 * AES-256-GCM ciphertext in `org_digest_channels` (service role only, never
 * selected by a client route) and never logged or returned.
 *
 * Format, versioned so the scheme or the key can change:
 *
 *   v1.<kid>.<salt>.<iv>.<ciphertext+tag>      (base64url parts)
 *
 *  - key: HKDF-SHA256 over the server secret with a random 16-byte salt PER
 *    ROW, so no two rows share a key;
 *  - iv: random 12 bytes per encryption;
 *  - aad: the org id, so a ciphertext copied onto another org's row does not
 *    open;
 *  - kid: the first 8 hex of sha256(secret). `DIGEST_SECRET` is the current
 *    secret; `DIGEST_SECRET_PREVIOUS` (comma separated) still decrypts, so a
 *    key rotates by moving the old value there and re-saving the webhooks.
 *    Without `DIGEST_SECRET` the secret falls back to the Supabase service
 *    role key, as `SHARE_MEDIA_TOKEN_SECRET` does.
 *
 * No secret at all = `SecretUnavailableError`: the settings route answers 503
 * and the cron skips quietly.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

export class SecretUnavailableError extends Error {
  constructor() {
    super('No server secret is configured for the digest webhook');
    this.name = 'SecretUnavailableError';
  }
}

const VERSION = 'v1';
const INFO = 'label-os/digest-webhook/v1';

const kidOf = (secret: string): string => createHash('sha256').update(secret).digest('hex').slice(0, 8);
const b64 = (b: Buffer): string => b.toString('base64url');

/** Current secret first, then the previous ones. */
export function digestSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const current = env.DIGEST_SECRET?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
  const previous = (env.DIGEST_SECRET_PREVIOUS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...new Set([current, ...previous].filter(Boolean))];
}

export function secretAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return digestSecrets(env).length > 0;
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, salt, INFO, 32));
}

export function encryptWebhook(plain: string, orgId: string, env: NodeJS.ProcessEnv = process.env): string {
  const [secret] = digestSecrets(env);
  if (!secret) throw new SecretUnavailableError();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  cipher.setAAD(Buffer.from(orgId));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return [VERSION, kidOf(secret), b64(salt), b64(iv), b64(body)].join('.');
}

/** The plaintext, or null for anything that does not open (wrong key, other org, tampered, unknown version). Never throws on bad input. */
export function decryptWebhook(stored: string, orgId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const parts = stored.split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) return null;
  const [, kid, saltRaw, ivRaw, bodyRaw] = parts;
  const secrets = digestSecrets(env).filter((s) => kidOf(s) === kid);
  const salt = Buffer.from(saltRaw, 'base64url');
  const iv = Buffer.from(ivRaw, 'base64url');
  const body = Buffer.from(bodyRaw, 'base64url');
  if (salt.length !== 16 || iv.length !== 12 || body.length < 17) return null;
  for (const secret of secrets) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
      decipher.setAAD(Buffer.from(orgId));
      decipher.setAuthTag(body.subarray(body.length - 16));
      return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
    } catch {
      // Wrong key for this row, or it was altered: try the next, then give up.
    }
  }
  return null;
}
