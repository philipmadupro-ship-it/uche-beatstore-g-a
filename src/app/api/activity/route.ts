import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceClient, isSupabaseConfigured, getAll, query } from '@/lib/db';
import { safeSellerId } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.activity');

export const runtime = 'nodejs';

/**
 * GET /api/activity?from=ISO&to=ISO
 *
 * Returns the user's activity stream — uploads, version replacements,
 * comments, sends, ratings — between [from, to]. Used by the calendar
 * page's daily-log side panel so the user can see "what did I do today."
 *
 * Each stream is fetched in parallel, normalized to a single shape, then
 * merged + sorted client-side (small N — at most a few hundred rows per
 * day for an active user). We don't bother with cursor pagination yet.
 *
 * Shape:
 *   {
 *     kind: 'upload' | 'version' | 'comment' | 'send' | 'rating',
 *     at: ISO timestamp,
 *     title: string,             // human-readable description
 *     subject_id?: string,       // track / project / contact id for jump-to
 *     subject_kind?: 'track' | 'project' | 'contact',
 *     meta?: Record<string, unknown>,
 *   }
 */

interface ActivityItem {
  id: string;
  kind: 'upload' | 'version' | 'comment' | 'send' | 'rating';
  at: string;
  title: string;
  subject_id?: string | null;
  subject_kind?: 'track' | 'project' | 'contact' | null;
  meta?: Record<string, unknown>;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');

  // Default to "the last 24 hours" if no range. Validate ISO 8601 first
  // so a bad query doesn't get echoed straight into a SQL `.gte(...)`.
  const now = Date.now();
  const from = fromParam && !Number.isNaN(Date.parse(fromParam))
    ? new Date(fromParam).toISOString()
    : new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const to = toParam && !Number.isNaN(Date.parse(toParam))
    ? new Date(toParam).toISOString()
    : new Date(now).toISOString();

  try {
    if (!isSupabaseConfigured()) {
      // Local-store fallback — same merge, against in-memory tables.
      return NextResponse.json({ activity: assembleLocal(from, to), from, to });
    }

    const cookieClient = await createServerClient();
    const { data: { user } } = await cookieClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ activity: [], from, to });
    }
    // Validate the id once here so every `.or('user_id.eq.${userId}…')`
    // below — including the resolveOwned* helpers — is provably safe from
    // the PostgREST comma-injection footgun. These are service-role queries
    // where the filter is the only scoping, so a bad id must short-circuit
    // to empty, never drop the clause.
    const userId = safeSellerId(user.id);
    if (!userId) {
      return NextResponse.json({ activity: [], from, to });
    }
    const admin = createServiceClient();
    const ownerFilter = `user_id.eq.${userId},user_id.is.null`;

    // Pull each stream in parallel. We restrict the SELECTs to the
    // exact columns we render so the JSON payload stays slim and the
    // join cost is predictable.
    const [tracks, versions, comments, sends, ratings] = await Promise.all([
      admin
        .from('tracks')
        .select('id, title, created_at, user_id')
        .or(ownerFilter)
        .gte('created_at', from).lte('created_at', to),

      admin
        .from('track_versions')
        // Versions don't carry user_id; we filter via the parent track.
        // Two-step: pull versions in range, then join tracks ownership
        // client-side. Fine because version writes are rare.
        .select('id, track_id, version_label, created_at')
        .gte('created_at', from).lte('created_at', to),

      admin
        .from('project_comments')
        .select('id, project_id, track_id, user_id, share_token, author_name, body, created_at')
        .gte('created_at', from).lte('created_at', to),

      admin
        .from('beat_sends')
        .select('id, contact_id, track_ids, status, sent_at, message')
        .gte('sent_at', from).lte('sent_at', to),

      admin
        .from('rating_history')
        .select('id, track_id, user_id, rating, rated_at')
        .eq('user_id', userId)
        .gte('rated_at', from).lte('rated_at', to),
    ]);

    // For ownership-via-parent streams (versions, comments, sends) we
    // need to filter to rows whose parent belongs to this user.
    const trackOwnerIds = await resolveOwnedTrackIds(admin, userId);
    const projectOwnerIds = await resolveOwnedProjectIds(admin, userId);
    const contactOwnerIds = await resolveOwnedContactIds(admin, userId);

    const items: ActivityItem[] = [];

    for (const t of (tracks.data ?? [])) {
      items.push({
        id: `upload-${t.id}`,
        kind: 'upload',
        at: t.created_at,
        title: `Uploaded "${t.title}"`,
        subject_id: t.id,
        subject_kind: 'track',
      });
    }

    for (const v of (versions.data ?? [])) {
      if (!trackOwnerIds.has(v.track_id)) continue;
      items.push({
        id: `version-${v.id}`,
        kind: 'version',
        at: v.created_at,
        title: `New version: ${v.version_label}`,
        subject_id: v.track_id,
        subject_kind: 'track',
      });
    }

    for (const c of (comments.data ?? [])) {
      if (!projectOwnerIds.has(c.project_id)) continue;
      const author = c.user_id ? 'You' : (c.author_name || 'A guest');
      const preview = (c.body || '').slice(0, 80);
      items.push({
        id: `comment-${c.id}`,
        kind: 'comment',
        at: c.created_at,
        title: `${author} commented: "${preview}${(c.body || '').length > 80 ? '…' : ''}"`,
        subject_id: c.project_id,
        subject_kind: 'project',
        meta: { track_id: c.track_id ?? null, via_share: !!c.share_token },
      });
    }

    for (const s of (sends.data ?? [])) {
      if (!contactOwnerIds.has(s.contact_id)) continue;
      const trackCount = Array.isArray(s.track_ids) ? s.track_ids.length : 0;
      items.push({
        id: `send-${s.id}`,
        kind: 'send',
        at: s.sent_at,
        title: `Sent ${trackCount} track${trackCount === 1 ? '' : 's'} · status ${s.status}`,
        subject_id: s.contact_id,
        subject_kind: 'contact',
        meta: { status: s.status, message: s.message ?? null, send_id: s.id },
      });
    }

    for (const r of (ratings.data ?? [])) {
      items.push({
        id: `rating-${r.id}`,
        kind: 'rating',
        at: r.rated_at,
        title: `Rated ${r.rating}/5`,
        subject_id: r.track_id,
        subject_kind: 'track',
      });
    }

    items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return NextResponse.json({ activity: items, from, to });
  } catch (error) {
    log.error('activity fetch failed', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

// ---- ownership pre-resolution -----------------------------------------------
// These three helpers run once per request and let us filter every
// activity stream against a small Set instead of N joined queries.

async function resolveOwnedTrackIds(admin: ReturnType<typeof createServiceClient>, userId: string): Promise<Set<string>> {
  const { data } = await admin
    .from('tracks')
    .select('id')
    .or(`user_id.eq.${userId},user_id.is.null`);
  return new Set((data ?? []).map((r: { id: string }) => r.id));
}

async function resolveOwnedProjectIds(admin: ReturnType<typeof createServiceClient>, userId: string): Promise<Set<string>> {
  const { data } = await admin
    .from('projects')
    .select('id')
    .or(`user_id.eq.${userId},user_id.is.null`);
  return new Set((data ?? []).map((r: { id: string }) => r.id));
}

async function resolveOwnedContactIds(admin: ReturnType<typeof createServiceClient>, userId: string): Promise<Set<string>> {
  const { data } = await admin
    .from('contacts')
    .select('id')
    .or(`user_id.eq.${userId},user_id.is.null`);
  return new Set((data ?? []).map((r: { id: string }) => r.id));
}

// ---- local-store path -------------------------------------------------------

function assembleLocal(from: string, to: string): ActivityItem[] {
  const inRange = (iso: string | null | undefined) =>
    !!iso && iso >= from && iso <= to;
  const items: ActivityItem[] = [];

  type AnyRow = Record<string, unknown>;
  for (const t of getAll('tracks') as AnyRow[]) {
    if (!inRange(t.created_at as string)) continue;
    items.push({
      id: `upload-${String(t.id)}`,
      kind: 'upload',
      at: String(t.created_at),
      title: `Uploaded "${String(t.title)}"`,
      subject_id: String(t.id),
      subject_kind: 'track',
    });
  }

  for (const c of getAll('project_comments') as AnyRow[]) {
    if (!inRange(c.created_at as string)) continue;
    const body = String(c.body ?? '');
    items.push({
      id: `comment-${String(c.id)}`,
      kind: 'comment',
      at: String(c.created_at),
      title: `${c.user_id ? 'You' : String(c.author_name ?? 'Someone')} commented: "${body.slice(0, 80)}${body.length > 80 ? '…' : ''}"`,
      subject_id: c.project_id ? String(c.project_id) : null,
      subject_kind: 'project',
    });
  }

  for (const s of getAll('beat_sends') as AnyRow[]) {
    if (!inRange(s.sent_at as string)) continue;
    const trackIds = Array.isArray(s.track_ids) ? s.track_ids : [];
    items.push({
      id: `send-${String(s.id)}`,
      kind: 'send',
      at: String(s.sent_at),
      title: `Sent ${trackIds.length} track${trackIds.length === 1 ? '' : 's'} · status ${String(s.status)}`,
      subject_id: s.contact_id ? String(s.contact_id) : null,
      subject_kind: 'contact',
    });
  }

  // local-store query() returns Rows (not promises); ratings/versions
  // optional — call them only if present in the schema.
  const versions = query('track_versions', () => true);
  for (const v of versions as AnyRow[]) {
    if (!inRange(v.created_at as string)) continue;
    items.push({
      id: `version-${String(v.id)}`,
      kind: 'version',
      at: String(v.created_at),
      title: `New version: ${String(v.version_label ?? 'v?')}`,
      subject_id: String(v.track_id),
      subject_kind: 'track',
    });
  }

  const ratings = query('rating_history', () => true);
  for (const r of ratings as AnyRow[]) {
    if (!inRange(r.rated_at as string)) continue;
    items.push({
      id: `rating-${String(r.id)}`,
      kind: 'rating',
      at: String(r.rated_at),
      title: `Rated ${String(r.rating)}/5`,
      subject_id: String(r.track_id),
      subject_kind: 'track',
    });
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  return items;
}
