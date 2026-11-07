/**
 * Who is calling a buyer-keyed route: a magic-link token or a Supabase
 * session, resolved to the one canonical (lowercased) email every buyer_*
 * and purchase row is keyed on. Shared by /api/store/me and the buyer's
 * playback route, so the two cannot disagree about who a request is.
 */
import type { NextRequest } from 'next/server';
import { requireUser, createServiceClient } from '@/lib/auth/ownership';
import { verifyBuyerToken } from '@/lib/buyer-tokens';
import { normalizeEmail } from '@/lib/contacts/email';
import { sessionBuyerEmail } from '@/lib/store/buyer-purchases';

async function readClaims(token: string | null) {
  if (!token) return null;
  return verifyBuyerToken(token);
}

export async function resolveBuyerEmail(req: NextRequest): Promise<{ email: string } | null> {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const sessionMode = searchParams.get('session') === '1';

  // Every buyer_* row is keyed on the canonical email, whichever proof of
  // identity the caller brings — a token and a session for the same person
  // must land on the same rows.
  if (token) {
    const claims = await readClaims(token);
    return claims ? { email: normalizeEmail(claims.email) } : null;
  }
  if (sessionMode) {
    const result = await requireUser();
    if (!result.ok) return null;
    // Same canonical email the token path carries (tokens are signed over a
    // lowercased email), so a session and a token share one library.
    const email = await sessionBuyerEmail(createServiceClient(), result.userId);
    return email ? { email } : null;
  }
  return null;
}
