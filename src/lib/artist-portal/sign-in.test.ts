import { describe, expect, it } from 'vitest';
import {
  canSendSignIn,
  maskEmail,
  sessionCookieName,
  sessionValue,
  signInCode,
  verifySession,
  verifySignInCode,
  SIGN_IN_CODE_TTL_MS,
} from './sign-in';

const S = 'test-secret';
const now = Date.parse('2026-09-29T12:00:00Z');
const subject = { portalId: 'p-1', token: 'tok', email: 'Nova@Example.com' };

describe('sign-in codes', () => {
  it('round-trips and tolerates email casing', () => {
    const code = signInCode(subject, now, S);
    expect(verifySignInCode(code, { ...subject, email: ' nova@example.com ' }, now + 1000, S)).toBe(true);
  });
  it('expires', () => {
    const code = signInCode(subject, now, S);
    expect(verifySignInCode(code, subject, now + SIGN_IN_CODE_TTL_MS + 1000, S)).toBe(false);
  });
  it('is bound to the portal, its token and the contact email', () => {
    const code = signInCode(subject, now, S);
    expect(verifySignInCode(code, { ...subject, portalId: 'p-2' }, now, S)).toBe(false);
    expect(verifySignInCode(code, { ...subject, token: 'reissued' }, now, S)).toBe(false);
    expect(verifySignInCode(code, { ...subject, email: 'other@example.com' }, now, S)).toBe(false);
    expect(verifySignInCode(code, subject, now, 'other-secret')).toBe(false);
  });
  it('a code is not a session and a session is not a code', () => {
    expect(verifySession(signInCode(subject, now, S), subject, now, S)).toBe(false);
    expect(verifySignInCode(sessionValue(subject, now, S), subject, now, S)).toBe(false);
    expect(verifySession(sessionValue(subject, now, S), subject, now + 29 * 86_400_000, S)).toBe(true);
  });
  it('rejects junk and a missing email', () => {
    expect(verifySession('', subject, now, S)).toBe(false);
    expect(verifySession('abc', subject, now, S)).toBe(false);
    expect(verifySession('99999999999.x', subject, now, S)).toBe(false);
    expect(verifySession(sessionValue(subject, now, S), { ...subject, email: '' }, now, S)).toBe(false);
  });
});

describe('helpers', () => {
  it('masks an email', () => {
    expect(maskEmail('Nova@Gmail.com')).toBe('n•••@g•••.com');
    expect(maskEmail('bad')).toBeNull();
    expect(maskEmail(null)).toBeNull();
  });
  it('names one cookie per portal', () => {
    expect(sessionCookieName('3f2a-11ee-b9d1-0242ac120002')).toBe('ap_3f2a11eeb9d10242');
  });
  it('throttles the email to one a minute', () => {
    expect(canSendSignIn(null, now)).toBe(true);
    expect(canSendSignIn('2026-09-29T11:59:30Z', now)).toBe(false);
    expect(canSendSignIn('2026-09-29T11:58:59Z', now)).toBe(true);
  });
});
