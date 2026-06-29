import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { parsePurchaseLineItems } from '@/lib/contracts';
import { publicError } from '@/lib/api-error';

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

    // Resolve email from auth.users — buyer_email columns are keyed on email string.
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const email = authUser?.user?.email;
    if (!email) {
      return NextResponse.json({ error: 'No email on account' }, { status: 400 });
    }

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
    const allItems = (lpRes.data ?? []).flatMap((r: any) => parsePurchaseLineItems(r.line_items));
    const trackIds = [...new Set(allItems.map((i) => i.track_id).filter(Boolean))];
    const titleMap = new Map<string, string>();
    if (trackIds.length > 0) {
      const { data: tracks } = await admin.from('tracks').select('id, title').in('id', trackIds);
      for (const t of (tracks ?? []) as any[]) titleMap.set(t.id, t.title);
    }

    const trackLicenses = (lpRes.data ?? []).map((row: any) => ({
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

    return NextResponse.json({ email, track_licenses: trackLicenses, project_bundles: projectBundles });
  } catch (err) {
    return publicError(err);
  }
}
