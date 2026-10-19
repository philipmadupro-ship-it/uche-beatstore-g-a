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
import { isProjectAccessActive } from '@/lib/store/project-access';

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
  download_unlocked?: boolean | null;
}

interface ProjectAccessAccountRow {
  id: string;
  project_id: string;
  token: string | null;
  amount_usd: number | string | null;
  stripe_session_id: string | null;
  created_at: string | null;
  expires_at?: string | null;
}

/**
 * Whether a license purchase still grants downloads. Same rule the delivery
 * and download-file routes enforce: a refund or dispute flips
 * `download_unlocked` to false (it defaults to true). A missing value means
 * an older select or row, so it is treated as unlocked, like the column
 * default.
 */
export function isLicenseDownloadActive(row: { download_unlocked?: boolean | null }): boolean {
  return row.download_unlocked !== false;
}

interface PurchasedTrackMeta {
  title: string | null;
  cover_url: string | null;
  type: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  duration_seconds: number | null;
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
 * Refunded, disputed or revoked purchases stay in the history, since the
 * buyer did pay and should see that, but carry `access_revoked: true` and no
 * `download_url`. Linking them led to a delivery page that answered 403.
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
      .select('id, amount_usd, line_items, stripe_session_id, created_at, status, download_unlocked')
      .eq('buyer_email', email)
      .order('created_at', { ascending: false }),
    admin
      .from('project_access_links')
      .select('id, project_id, token, amount_usd, stripe_session_id, created_at, expires_at')
      .eq('buyer_email', email)
      .order('created_at', { ascending: false }),
  ]);
  if (lpRes.error) throw lpRes.error;
  if (paRes.error) throw paRes.error;

  // Batch-load track titles so the account shows WHAT was bought, not "2 tracks".
  const licenseRows = (lpRes.data ?? []) as LicensePurchaseAccountRow[];
  const allItems = licenseRows.flatMap((r) => parsePurchaseLineItems(r.line_items));
  const trackIds = [...new Set(allItems.map((i) => i.track_id).filter(isNonEmptyString))];
  // The same read also carries what the player needs to play a bought beat
  // from the account (cover, length, tempo), so it costs no extra query.
  const trackMap = new Map<string, PurchasedTrackMeta>();
  if (trackIds.length > 0) {
    const { data: tracks } = await admin
      .from('tracks')
      .select('id, title, cover_url, type, bpm, key, scale, duration_seconds')
      .in('id', trackIds);
    for (const t of (tracks ?? []) as Array<PurchasedTrackMeta & { id: string }>) trackMap.set(t.id, t);
  }

  const trackLicenses = licenseRows.map((row) => {
    const revoked = !isLicenseDownloadActive(row);
    return {
      id: row.id,
      kind: 'track' as const,
      items: parsePurchaseLineItems(row.line_items).map((i) => {
        const t = trackMap.get(i.track_id);
        return {
          ...i,
          title: t?.title ?? null,
          cover_url: t?.cover_url ?? null,
          type: t?.type ?? null,
          bpm: t?.bpm ?? null,
          key: t?.key ?? null,
          scale: t?.scale ?? null,
          duration_seconds: t?.duration_seconds ?? null,
        };
      }),
      amount_usd: Number(row.amount_usd ?? 0),
      created_at: row.created_at,
      status: row.status,
      stripe_session_id: row.stripe_session_id,
      access_revoked: revoked,
      download_url: row.stripe_session_id && !revoked
        ? `/store/download?session_id=${row.stripe_session_id}`
        : null,
    };
  });

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

  const projectBundles = projectAccessRows.map((row) => {
    const revoked = !isProjectAccessActive(row);
    return {
      id: row.id,
      kind: 'project' as const,
      project: projectMap.get(row.project_id) ?? { name: 'Untitled project', cover_url: null },
      project_id: row.project_id,
      amount_usd: Number(row.amount_usd ?? 0),
      created_at: row.created_at,
      stripe_session_id: row.stripe_session_id,
      access_revoked: revoked,
      download_url: row.token && !revoked ? `/store/projects/access/${row.token}` : null,
    };
  });

  return { email, track_licenses: trackLicenses, project_bundles: projectBundles };
}
