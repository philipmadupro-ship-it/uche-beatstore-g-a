import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { verifyBuyerToken } from '@/lib/buyer-tokens';
import { publicError } from '@/lib/api-error';
import { loadBuyerPurchases } from '@/lib/store/buyer-purchases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/store/account/[token]
 *
 * Public-by-token: the magic-link delivered to the buyer's inbox proves
 * possession of the email. We verify the token's HMAC + expiry then
 * fetch every license_purchases + project_access_links row for that
 * email and return a unified buyer-facing shape.
 *
 * Response:
 *   {
 *     email,
 *     track_licenses: Array<{ id, kind: 'track', items: [...],
 *                             amount_usd, created_at,
 *                             download_url, stripe_session_id }>,
 *     project_bundles: Array<{ id, kind: 'project', project: {...},
 *                              amount_usd, created_at,
 *                              download_url, stripe_session_id }>,
 *   }
 *
 * Errors: 400 expired/malformed/missing token (we don't tell the caller
 * which); 500 on infra failures.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const claims = verifyBuyerToken(token);
    if (!claims) {
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 400 });
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json({
        email: claims.email,
        track_licenses: [],
        project_bundles: [],
      });
    }

    const admin = createServiceClient();
    return NextResponse.json(await loadBuyerPurchases(admin, claims.email));
  } catch (err) {
    return publicError(err);
  }
}
