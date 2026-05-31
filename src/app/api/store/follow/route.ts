import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { verifyBuyerToken } from '@/lib/buyer-tokens';
import { errorMessage } from '@/lib/errors';
import { rateLimit, clientIp } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/store/follow — follow or unfollow a producer.
 *
 * Body: { producer_user_id, action: 'follow' | 'unfollow', email?, token? }
 *
 * Buyer identity (email) resolves from, in order:
 *   1. a magic-link `token` (HMAC, mig 060 buyer accounts)
 *   2. an explicit `email` in the body (anonymous follow with email capture)
 *
 * Persists to producer_follows (mig 066) via the service-role client so
 * the producer can later notify followers when a new beat drops.
 */
const bodySchema = z.object({
  producer_user_id: z.string().uuid(),
  action: z.enum(['follow', 'unfollow']),
  email: z.string().email().optional(),
  token: z.string().optional(),
});

function resolveEmail(body: z.infer<typeof bodySchema>): string | null {
  if (body.token) {
    const claims = verifyBuyerToken(body.token);
    if (claims?.email) return claims.email;
  }
  if (body.email) return body.email.trim().toLowerCase();
  return null;
}

export async function POST(req: NextRequest) {
  try {
    if (!rateLimit(`follow:${clientIp(req)}`, 20, 60_000)) {
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

    const email = resolveEmail(parsed.data);
    if (!email) {
      // No identity — the client keeps its localStorage follow, but we
      // can't persist or notify. Tell the caller so it can prompt for email.
      return NextResponse.json({ ok: true, persisted: false, needsEmail: true });
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
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
