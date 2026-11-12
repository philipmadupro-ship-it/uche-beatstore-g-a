/** The press share token (LABEL-66): server only. Pure rules for it live in press.ts. */
import { createHash, randomBytes } from 'node:crypto';

export const newPressToken = (): string => randomBytes(32).toString('base64url');
export const isWellFormedPressToken = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);
export const hashPressToken = (token: string): string => createHash('sha256').update(`label-os.press-kit.v1\0${token}`).digest('hex');
