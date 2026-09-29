/**
 * The gate every /api/portal/[token] route passes first.
 *
 * Resolution and the revoked (410) / password (401) checks are the shared
 * share-token ones (`lib/share/token-access`), with `artist_portal` as the
 * only kind honoured — a project share token must not open a portal, nor the
 * reverse. The portal's owner must still be the producer: a portal row whose
 * owner lost their creator profile grants nothing.
 */

import { createHash } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { isProducerUserId } from '@/lib/auth/producer';
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
};

export type PortalGate = { ok: true; portal: GatedPortal } | { ok: false; res: NextResponse };

export async function gatePortal(
  admin: Admin,
  token: string,
  req: NextRequest,
  opts: { checkPassword?: boolean } = {},
): Promise<PortalGate> {
  const resolved = await resolveShareToken(admin, token, ['artist_portal']);
  if (!resolved || resolved.kind !== 'artist_portal') return { ok: false, res: shareNotFoundResponse() };
  const failure = await shareAccessFailure(lockableOf(resolved), {
    password: sharePasswordFrom(req),
    checkPassword: opts.checkPassword ?? true,
  });
  if (failure) return { ok: false, res: shareGateResponse(failure) };
  if (!(await isProducerUserId(admin, resolved.row.user_id))) return { ok: false, res: shareNotFoundResponse() };
  return { ok: true, portal: resolved.row as GatedPortal };
}

export function hashRequestIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  const ip = fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  return createHash('sha256').update(`${ip}:${process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'antigravity'}`).digest('hex').slice(0, 32);
}
