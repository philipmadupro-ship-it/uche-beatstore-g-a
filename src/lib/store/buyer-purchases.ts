/**
 * One buyer identity, one order history.
 *
 * A buyer reaches their purchases two ways: the persistent account
 * (`/store/account/me`, a Supabase session) and the legacy 24h link
 * (`/store/account/[token]`, an HMAC-signed email). Both must resolve to the
 * same canonical email and run the same query, or the same human sees two
 * different histories.
 *
 * The write side is already canonical: the Stripe webhook lowercases
 * `buyer_email` once before writing `license_purchases` /
 * `project_access_links`, and mig 110 repaired older rows. Tokens are signed
 * over a lowercased email. The session side was not: it used
 * `auth.users.email` as-is, so an account whose stored email carried any
 * capitals (an OAuth provider's casing, an admin-created user) matched none
 * of its own orders. `normalizeEmail` on every identity is the fix; this
 * module is the single place both routes get it from.
 */
import type { createServiceClient } from '@/lib/auth/ownership';
import { parsePurchaseLineItems } from '@/lib/contracts';
import { normalizeEmailOrNull } from '@/lib/contacts/email';

type Admin = ReturnType<typeof createServiceClient>;

/**
 * The canonical buyer email behind a Supabase session, or null when the
 * account has none. Use this rather than reading `auth.users.email` directly.
 */
export async function sessionBuyerEmail(admin: Admin, userId: string): Promise<string | null> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return normalizeEmailOrNull(data?.user?.email);
}

interface LicensePurchaseAccountRow {
  id: string;
  amount_usd: number | string | null;
  line_items: unknown;
  stripe_session_id: string | null;
  created_at: string | null;
  status: string | null;
}

interface ProjectAccessAccountRow {
  id: string;
  project_id: string;
  token: string | null;
  amount_usd: number | string | null;
  stripe_session_id: string | null;
  created_at: string | null;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Every track license and project bundle bought under `email`, in the shape
 * both account pages render:
 *
 *   { email, track_licenses, project_bundles }
 *
 * The email is normalised here as well, so a caller cannot forget. A failed
 * purchase query THROWS rather than returning an empty list: "No purchases
 * yet" in front of a buyer who has paid is worse than an error they can retry.
 */
export async function loadBuyerPurchases(admin: Admin, rawEmail: string) {
  const email = normalizeEmailOrNull(rawEmail);
  if (!email) throw new Error('Buyer email required');

  const [lpRes, paRes] = await Promise.all([
    admin
      .from('license_purchases')
      .select('id, amount_usd, line_items, stripe_session_id, created_at, status')
      .eq('buyer_email', email)
      .order('created_at', { ascending: false }),
    admin
      .from('project_access_links')
      .select('id, project_id, token, amount_usd, stripe_session_id, created_at')
      .eq('buyer_email', email)
      .order('created_at', { ascending: false }),
  ]);
  if (lpRes.error) throw lpRes.error;
  if (paRes.error) throw paRes.error;

  // Batch-load track titles so the account shows WHAT was bought, not "2 tracks".
  const licenseRows = (lpRes.data ?? []) as LicensePurchaseAccountRow[];
  const allItems = licenseRows.flatMap((r) => parsePurchaseLineItems(r.line_items));
  const trackIds = [...new Set(allItems.map((i) => i.track_id).filter(isNonEmptyString))];
  const titleMap = new Map<string, string>();
  if (trackIds.length > 0) {
    const { data: tracks } = await admin.from('tracks').select('id, title').in('id', trackIds);
    for (const t of (tracks ?? []) as Array<{ id: string; title: string }>) titleMap.set(t.id, t.title);
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
    for (const p of (projects ?? []) as Array<{ id: string; name: string; cover_url: string | null }>) {
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

  return { email, track_licenses: trackLicenses, project_bundles: projectBundles };
}
