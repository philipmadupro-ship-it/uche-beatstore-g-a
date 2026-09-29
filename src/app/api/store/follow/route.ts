import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient, requireUser } from '@/lib/auth/ownership';
import { sessionBuyerEmail } from '@/lib/store/buyer-purchases';
import { isSupabaseConfigured } from '@/lib/local-store';
import { verifyBuyerToken } from '@/lib/buyer-tokens';
import { publicError } from '@/lib/api-error';
import { rateLimitDurable, clientIp } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/store/follow — follow or unfollow a producer.
 *
 * Body: { producer_user_id, action: 'follow' | 'unfollow', token? }
 *
 * Buyer identity (email) resolves from, in order:
 *   1. the signed-in buyer's Supabase session (persistent account)
 *   2. a magic-link `token` (HMAC, mig 060 buyer accounts)
 *
 * An email typed into the body is NOT an identity. It used to be, which let
 * anyone subscribe a stranger's address to drop announcements
 * (cron/announce-drops mails every follower) or silently unfollow someone
 * else. No client ever sent one: the producer page sends only the token.
 * With neither identity the caller gets `needsSignIn` and keeps its
 * localStorage follow.
 *
 * The session comes first for the same reason it does in
 * lib/buyer-session.ts: the 24h token outlives its expiry in localStorage, and
 * a signed-in buyer whose follow depended on it was silently not persisted
 * once it lapsed. That session is also the only identity a buyer who signed
 * in without ever opening a delivery link has at all.
 *
 * Persists to producer_follows (mig 066) via the service-role client so
 * the producer can later notify followers when a new beat drops.
 */
const bodySchema = z.object({
  producer_user_id: z.string().uuid(),
  action: z.enum(['follow', 'unfollow']),
  token: z.string().optional(),
});

/** The canonical email behind the request's Supabase session, if any. */
async function sessionEmail(): Promise<string | null> {
  const auth = await requireUser();
  if (!auth.ok) return null;
  return sessionBuyerEmail(auth.admin, auth.userId);
}

function resolveEmail(body: z.infer<typeof bodySchema>): string | null {
  if (body.token) {
    const claims = verifyBuyerToken(body.token);
    if (claims?.email) return claims.email;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    if (!await rateLimitDurable(`follow:${clientIp(req)}`, 20, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ ok: true, persisted: false });
    }

    const email = (await sessionEmail()) ?? resolveEmail(parsed.data);
    if (!email) {
      // No verified identity. The client keeps its localStorage follow, but
      // we can't persist or notify. Signing in at /store/account fixes that.
      return NextResponse.json({ ok: true, persisted: false, needsSignIn: true });
    }

    const admin = createServiceClient();
    if (parsed.data.action === 'follow') {
      const { error } = await admin
        .from('producer_follows')
        .upsert(
          { producer_user_id: parsed.data.producer_user_id, email },
          { onConflict: 'producer_user_id,email' },
        );
      if (error) throw error;
    } else {
      const { error } = await admin
        .from('producer_follows')
        .delete()
        .eq('producer_user_id', parsed.data.producer_user_id)
        .eq('email', email);
      if (error) throw error;
    }
    return NextResponse.json({ ok: true, persisted: true });
  } catch (err) {
    return publicError(err);
  }
}
