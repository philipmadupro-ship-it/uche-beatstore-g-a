import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { verifyBuyerToken } from '@/lib/buyer-tokens';
import { parsePurchaseLineItems } from '@/lib/contracts';
import { publicError } from '@/lib/api-error';

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
    const email = claims.email;

    const [lpRes, paRes] = await Promise.all([
      admin
        .from('license_purchases')
        .select('id, amount_usd, line_items, stripe_session_id, created_at, status, fulfillment_email_sent')
        .eq('buyer_email', email)
        .order('created_at', { ascending: false }),
      admin
        .from('project_access_links')
        .select('id, project_id, token, amount_usd, stripe_session_id, created_at')
        .eq('buyer_email', email)
        .order('created_at', { ascending: false }),
    ]);

    const trackLicenses = (lpRes.data ?? []).map((row: any) => ({
      id: row.id,
      kind: 'track' as const,
      items: parsePurchaseLineItems(row.line_items),
      amount_usd: Number(row.amount_usd ?? 0),
      created_at: row.created_at,
      status: row.status,
      stripe_session_id: row.stripe_session_id,
      download_url: row.stripe_session_id
        ? `/store/download?session_id=${row.stripe_session_id}`
        : null,
    }));

    // Resolve project name + cover for each bundle in one round-trip.
    const projectIds = [...new Set((paRes.data ?? []).map((r: any) => r.project_id).filter(Boolean))];
    const projectMap = new Map<string, { name: string; cover_url: string | null }>();
    if (projectIds.length > 0) {
      const { data: projects } = await admin
        .from('projects')
        .select('id, name, cover_url')
        .in('id', projectIds);
      for (const p of (projects ?? []) as any[]) {
        projectMap.set(p.id, { name: p.name, cover_url: p.cover_url });
      }
    }

    const projectBundles = (paRes.data ?? []).map((row: any) => ({
      id: row.id,
      kind: 'project' as const,
      project: projectMap.get(row.project_id) ?? { name: 'Untitled project', cover_url: null },
      project_id: row.project_id,
      amount_usd: Number(row.amount_usd ?? 0),
      created_at: row.created_at,
      stripe_session_id: row.stripe_session_id,
      download_url: row.token ? `/store/projects/access/${row.token}` : null,
    }));

    return NextResponse.json({
      email,
      track_licenses: trackLicenses,
      project_bundles: projectBundles,
    });
  } catch (err) {
    return publicError(err);
  }
}
