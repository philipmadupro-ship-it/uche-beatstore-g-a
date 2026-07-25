import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { verifyBuyerToken } from '@/lib/buyer-tokens';
import { parsePurchaseLineItems } from '@/lib/contracts';
import { publicError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LicensePurchaseAccountRow {
  id: string;
  amount_usd: number | string | null;
  line_items: unknown;
  stripe_session_id: string | null;
  created_at: string | null;
  status: string | null;
  fulfillment_email_sent: boolean | null;
}

interface TrackTitleRow {
  id: string;
  title: string;
}

interface ProjectAccessAccountRow {
  id: string;
  project_id: string;
  token: string | null;
  amount_usd: number | string | null;
  stripe_session_id: string | null;
  created_at: string | null;
}

interface ProjectSummaryRow {
  id: string;
  name: string;
  cover_url: string | null;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

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

    // Batch-load track titles so the account shows WHAT was bought, not "2 tracks".
    const licenseRows = (lpRes.data ?? []) as LicensePurchaseAccountRow[];
    const allItems = licenseRows.flatMap((r) => parsePurchaseLineItems(r.line_items));
    const trackIds = [...new Set(allItems.map((i) => i.track_id).filter(isNonEmptyString))];
    const titleMap = new Map<string, string>();
    if (trackIds.length > 0) {
      const { data: tracks } = await admin.from('tracks').select('id, title').in('id', trackIds);
      for (const t of (tracks ?? []) as TrackTitleRow[]) titleMap.set(t.id, t.title);
    }

    const trackLicenses = licenseRows.map((row) => ({
      id: row.id,
      kind: 'track' as const,
      items: parsePurchaseLineItems(row.line_items).map((i) => ({
        ...i,
        title: titleMap.get(i.track_id) ?? null,
      })),
      amount_usd: Number(row.amount_usd ?? 0),
      created_at: row.created_at,
      status: row.status,
      stripe_session_id: row.stripe_session_id,
      download_url: row.stripe_session_id
        ? `/store/download?session_id=${row.stripe_session_id}`
        : null,
    }));

    // Resolve project name + cover for each bundle in one round-trip.
    const projectAccessRows = (paRes.data ?? []) as ProjectAccessAccountRow[];
    const projectIds = [...new Set(projectAccessRows.map((r) => r.project_id).filter(isNonEmptyString))];
    const projectMap = new Map<string, { name: string; cover_url: string | null }>();
    if (projectIds.length > 0) {
      const { data: projects } = await admin
        .from('projects')
        .select('id, name, cover_url')
        .in('id', projectIds);
      for (const p of (projects ?? []) as ProjectSummaryRow[]) {
        projectMap.set(p.id, { name: p.name, cover_url: p.cover_url });
      }
    }

    const projectBundles = projectAccessRows.map((row) => ({
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
