import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { publicError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/store/projects/access/by-session?session_id=cs_xxx
 *
 * Resolves a Stripe checkout session_id to the project_access_links
 * token that was created by the webhook. Used by the post-checkout
 * landing page (/store/projects/access?session_id=…) to poll until
 * the webhook has fired, then redirect to /store/projects/access/[token].
 *
 *   200 { token: string }                 — found, ready to redirect
 *   404 { error: 'pending'  }              — row not written yet (poll again)
 *   404 { error: 'not-found' }             — no project purchase ever
 *                                            matched this session_id
 *
 * Public — no auth — but only returns the access token for whichever
 * row stores the matching stripe_session_id (already a secret).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('session_id');
    if (!sessionId) {
      return NextResponse.json({ error: 'session_id required' }, { status: 400 });
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }

    const admin = createServiceClient();
    const { data, error } = await admin
      .from('project_access_links')
      .select('token')
      .eq('stripe_session_id', sessionId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      // We can't distinguish "webhook hasn't fired yet" from "wrong session"
      // without an extra round-trip to Stripe. Caller treats 404 as a poll
      // cue and will give up after its own timeout.
      return NextResponse.json({ error: 'pending' }, { status: 404 });
    }

    return NextResponse.json({ token: (data as any).token });
  } catch (err) {
    return publicError(err);
  }
}
