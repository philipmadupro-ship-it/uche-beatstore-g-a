/**
 * Optional email sign-in for an artist portal (mig 131).
 *
 * A portal link is a bearer credential. With `require_sign_in` on, the link
 * alone opens only a "confirm it's you" screen: the portal emails a sign-in
 * link to the address ON THE CONTACT — the visitor never types an address, so
 * a forwarded link cannot be redirected to someone else's inbox — and opening
 * that link leaves a signed, httpOnly cookie for this browser.
 *
 * Both the emailed code and the cookie are stateless HMACs over
 * (purpose, portal id, portal token, contact email, expiry):
 *   - reissuing the portal (new token) signs everyone out;
 *   - changing the contact's email signs everyone out;
 *   - a code is useless for any other portal, and a cookie is not a code.
 * No Supabase auth user is created: artists are neither buyers nor producers,
 * and a Supabase session here would put them through the buyer/producer gates.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { normalizeEmail } from '@/lib/contacts/email';
import { shareSigningSecret } from '@/lib/share-media-token';

export const SIGN_IN_CODE_TTL_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 86_400_000;
/** One sign-in email a minute per portal. */
export const SIGN_IN_RESEND_MS = 60_000;

export interface SignInSubject {
  portalId: string;
  token: string;
  email: string;
}

type Purpose = 'code' | 'session';

function mac(purpose: Purpose, s: SignInSubject, expires: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(`artist-portal-sign-in\0${purpose}\0${s.portalId}\0${s.token}\0${normalizeEmail(s.email)}\0${expires}`)
    .digest('base64url');
}

function sign(purpose: Purpose, s: SignInSubject, ttl: number, now: number, secret: string): string {
  const expires = Math.floor((now + ttl) / 1000);
  return `${expires}.${mac(purpose, s, expires, secret)}`;
}

function verify(purpose: Purpose, value: string | null | undefined, s: SignInSubject, now: number, secret: string): boolean {
  if (!value || !normalizeEmail(s.email)) return false;
  const dot = value.indexOf('.');
  if (dot <= 0) return false;
  const expires = Number(value.slice(0, dot));
  if (!Number.isInteger(expires) || expires * 1000 < now) return false;
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(mac(purpose, s, expires, secret));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function signInCode(s: SignInSubject, now = Date.now(), secret = shareSigningSecret()): string {
  return sign('code', s, SIGN_IN_CODE_TTL_MS, now, secret);
}

export function verifySignInCode(code: string | null | undefined, s: SignInSubject, now = Date.now(), secret = shareSigningSecret()): boolean {
  return verify('code', code, s, now, secret);
}

export function sessionValue(s: SignInSubject, now = Date.now(), secret = shareSigningSecret()): string {
  return sign('session', s, SESSION_TTL_MS, now, secret);
}

export function verifySession(value: string | null | undefined, s: SignInSubject, now = Date.now(), secret = shareSigningSecret()): boolean {
  return verify('session', value, s, now, secret);
}

/** One cookie per portal, so signing in to one artist's portal says nothing about another. */
export function sessionCookieName(portalId: string): string {
  return `ap_${portalId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;
}

/** "n•••@g•••.com" — enough for the artist to recognise their address, not enough to harvest it. */
export function maskEmail(email: string | null | undefined): string | null {
  const e = normalizeEmail(email ?? '');
  const at = e.indexOf('@');
  if (!e || at <= 0) return null;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}•••@${host[0] ?? ''}•••${tld}`;
}

/** May another sign-in email go out? */
export function canSendSignIn(lastSentAt: string | null | undefined, now = Date.now()): boolean {
  const t = lastSentAt ? Date.parse(lastSentAt) : NaN;
  return !Number.isFinite(t) || now - t >= SIGN_IN_RESEND_MS;
}
