// Local-only JWTs for the verification stack (scripts/local-db). The secret is
// public on purpose: nothing signed with it is accepted anywhere but the local
// PostgREST started by up.sh.
import crypto from 'node:crypto';

export const SECRET = 'local-db-jwt-secret-for-verification-only-000';
export const PRODUCER_ID = '0b0e1a57-0000-4000-8000-000000000001';
export const BUYER_ID = '0b0e1a57-0000-4000-8000-0000000000b1';
export const ARTIST_A_ID = '0b0e1a57-0000-4000-8000-0000000000b2';
export const ARTIST_B_ID = '0b0e1a57-0000-4000-8000-0000000000b3';

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

export function sign(claims) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ iat: now, exp: now + 60 * 60 * 24 * 30, ...claims });
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verify(token) {
  const [h, b, s] = String(token).split('.');
  if (!s) return null;
  const want = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
  if (want !== s) return null;
  const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
  return claims.exp && claims.exp < Date.now() / 1000 ? null : claims;
}

export const ANON_KEY = sign({ role: 'anon', iss: 'supabase' });
export const SERVICE_KEY = sign({ role: 'service_role', iss: 'supabase' });

export function userToken(id, email) {
  return sign({ sub: id, role: 'authenticated', aud: 'authenticated', email });
}

/** The @supabase/ssr session cookie for a user (project ref "127" = 127.0.0.1). */
export function sessionCookie(id, email) {
  const token = userToken(id, email);
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: token, refresh_token: token, token_type: 'bearer', expires_in: 60 * 60 * 24 * 30, expires_at: now + 60 * 60 * 24 * 30,
    user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  };
  return { name: 'sb-127-auth-token', value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}` };
}
