import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { publicError } from '@/lib/api-error';
import { loadBuyerPurchases, sessionBuyerEmail } from '@/lib/store/buyer-purchases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/store/account/me
 *
 * Same response shape as /api/store/account/[token] but gated by a
 * Supabase auth session cookie instead of a 24h HMAC token. Used by
 * /store/account/me after the buyer signs in via signInWithOtp.
 *
 *   { email, track_licenses, project_bundles }
 *
 * Identity and query both come from lib/store/buyer-purchases.ts, so the
 * session and the token link always show the same orders.
 */
export async function GET() {
  try {
    const result = await requireUser();
    if (!result.ok) return result.res;
    const { userId } = result;

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ email: '', track_licenses: [], project_bundles: [] });
    }

    const admin = createServiceClient();

    // buyer_email columns are keyed on the canonical (lowercased) email.
    const email = await sessionBuyerEmail(admin, userId);
    if (!email) {
      return NextResponse.json({ error: 'No email on account' }, { status: 400 });
    }

    return NextResponse.json(await loadBuyerPurchases(admin, email));
  } catch (err) {
    return publicError(err);
  }
}
