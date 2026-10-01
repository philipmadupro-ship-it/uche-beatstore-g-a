/**
 * The gate every /api/portal/[token] route passes first.
 *
 * Resolution and the revoked (410) / password (401) checks are the shared
 * share-token ones (`lib/share/token-access`), with `artist_portal` as the
 * only kind honoured — a project share token must not open a portal, nor the
 * reverse. The portal's owner must still be the producer: a portal row whose
 * owner lost their creator profile grants nothing.
 *
 * A portal with `require_sign_in` (mig 131) then also needs this browser's
 * signed session cookie (lib/artist-portal/sign-in); without it the answer is
 * 401 `{ requiresSignIn: true, emailHint }`. The sign-in route itself passes
 * `signIn: false`, or nobody could ever get in.
 */

import { createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { isProducerUserId } from '@/lib/auth/producer';
import { maskEmail, sessionCookieName, verifySession } from './sign-in';
import {
  resolveShareToken,
  shareAccessFailure,
  shareGateResponse,
  shareNotFoundResponse,
  sharePasswordFrom,
  lockableOf,
  type ArtistPortalRecord,
} from '@/lib/share/token-access';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export type GatedPortal = ArtistPortalRecord & {
  id: string;
  token: string;
  last_viewed_at: string | null;
  previous_viewed_at: string | null;
  view_count: number;
  /** Mig 131; undefined before it. */
  require_sign_in?: boolean;
  sign_in_sent_at?: string | null;
};

export type PortalGate = { ok: true; portal: GatedPortal } | { ok: false; res: NextResponse };

export async function gatePortal(
  admin: Admin,
  token: string,
  req: NextRequest,
  opts: { checkPassword?: boolean; signIn?: boolean } = {},
): Promise<PortalGate> {
  const resolved = await resolveShareToken(admin, token, ['artist_portal']);
  if (!resolved || resolved.kind !== 'artist_portal') return { ok: false, res: shareNotFoundResponse() };
  const failure = await shareAccessFailure(lockableOf(resolved), {
    password: sharePasswordFrom(req),
    checkPassword: opts.checkPassword ?? true,
  });
  if (failure) return { ok: false, res: shareGateResponse(failure) };
  if (!(await isProducerUserId(admin, resolved.row.user_id))) return { ok: false, res: shareNotFoundResponse() };
  const portal = resolved.row as GatedPortal;
  if (portal.require_sign_in && opts.signIn !== false) {
    const email = await portalContactEmail(admin, portal);
    const cookie = req.cookies.get(sessionCookieName(portal.id))?.value;
    if (!email || !verifySession(cookie, { portalId: portal.id, token: portal.token, email })) {
      return {
        ok: false,
        res: NextResponse.json(
          { error: 'Confirm your email to open this library.', requiresSignIn: true, emailHint: maskEmail(email), canSignIn: !!email },
          { status: 401, headers: { 'cache-control': 'private, no-store' } },
        ),
      };
    }
  }
  return { ok: true, portal };
}

/** The address sign-in is sent to and checked against: the contact's, owner-filtered. */
export async function portalContactEmail(admin: Admin, portal: { user_id: string; contact_id: string }): Promise<string | null> {
  const { data, error } = await admin.from('contacts').select('email').eq('id', portal.contact_id).eq('user_id', portal.user_id).maybeSingle();
  if (error) throw error;
  const email = (data as { email?: string | null } | null)?.email?.trim();
  return email ? email : null;
}

export function hashRequestIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  const ip = fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  return createHash('sha256').update(`${ip}:${process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'antigravity'}`).digest('hex').slice(0, 32);
}
