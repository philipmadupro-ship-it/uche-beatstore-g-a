import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceClient, isSupabaseConfigured, getAll, query } from '@/lib/db';
import { safeSellerId } from '@/lib/auth/ownership';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { presentNotification } from '@/lib/notifications/presentation';
import {
  commentItem, contactActivityItem, mergeActivity, notificationItem, openedItem, ratingItem, sendItem, uploadItem, versionItem,
  type ActivityItem, type Names,
} from '@/lib/dashboard/activity-taxonomy';

const log = createLogger('api.activity');

export const runtime = 'nodejs';

/**
 * GET /api/activity?from=ISO&to=ISO
 *
 * The producer's activity stream between [from, to]. What counts as activity,
 * its group, wording and link is decided ONCE in `lib/dashboard/activity-taxonomy`
 * (DASH-01); this route only reads rows and feeds them through those builders.
 *
 * Sources, every one scoped to the signed-in producer IN THE QUERY (never read
 * for everyone and filtered afterwards):
 *   tracks / track_versions / rating_history   → Music
 *   notifications (money + delivery kinds only) → Sales
 *   contact_activity (artist-written kinds)     → Artists
 *   project_comments                            → Artists
 *   beat_sends (sent, opened)                   → Sharing
 * Label OS rows are never read: producer notifications are `org_id IS NULL`,
 * org tracks / projects are excluded, org contacts have no `user_id`.
 *
 * Optional sources (notifications, contact_activity) degrade to empty on a
 * missing table or column, never to a 500.
 *
 * Item shape: { id, kind, group, tone, at, title, href, subject_id?,
 * subject_kind?, meta? } — the pre-DASH-01 fields are all still present.
 */

const OWNED_CHUNK = 100;
const STREAM_LIMIT = 200;

type Admin = ReturnType<typeof createServiceClient>;
type Row = Record<string, unknown>;

/** Run `fn` over id chunks (an `in (…)` list has a URL length limit) and concatenate the rows. Errors read as no rows, as these streams always have. */
async function inChunks(ids: string[], fn: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<Row[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += OWNED_CHUNK) chunks.push(ids.slice(i, i + OWNED_CHUNK));
  const results = await Promise.all(chunks.map((c) => fn(c)));
  const rows: Row[] = [];
  for (const r of results) {
    if (r.error) { log.warn('activity stream read failed', { error: r.error.message }); continue; }
    rows.push(...((r.data ?? []) as Row[]));
  }
  return rows;
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

    // Ownership + names first: the id sets scope the child streams in the
    // database, the names make every row say WHICH track / project / person.
    const [tracksOwned, projectsOwned, contactsOwned] = await Promise.all([
      resolveOwned(admin, 'tracks', 'id, title', userId),
      resolveOwned(admin, 'projects', 'id, name', userId),
      resolveOwnedContacts(admin, userId),
    ]);
    const trackTitles = new Map(tracksOwned.map((r) => [String(r.id), (r.title as string | null) ?? null]));
    const projectNames = new Map(projectsOwned.map((r) => [String(r.id), (r.name as string | null) ?? null]));
    const contactNames = new Map(contactsOwned.map((r) => [String(r.id), (r.name as string | null) ?? null]));
    const names: Names = {
      track: (id) => (id ? trackTitles.get(id) ?? null : null),
      project: (id) => (id ? projectNames.get(id) ?? null : null),
      contact: (id) => (id ? contactNames.get(id) ?? null : null),
    };
    const trackIds = [...trackTitles.keys()];
    const projectIds = [...projectNames.keys()];
    const contactIds = [...contactNames.keys()];

    const [tracks, versions, comments, sends, opens, ratings, notes, timeline] = await Promise.all([
      admin
        .from('tracks')
        .select('id, title, created_at, user_id')
        .or(ownerFilter)
        .gte('created_at', from).lte('created_at', to)
        .order('created_at', { ascending: false }).limit(STREAM_LIMIT),

      // Versions / comments / sends carry no (or a nullable) owner column, so
      // they are scoped by the owner's own parent ids IN the query.
      inChunks(trackIds, (c) => admin.from('track_versions')
        .select('id, track_id, version_label, created_at')
        .in('track_id', c).gte('created_at', from).lte('created_at', to)
        .order('created_at', { ascending: false }).limit(STREAM_LIMIT)),

      readComments(admin, projectIds, from, to),

      inChunks(contactIds, (c) => admin.from('beat_sends')
        .select('id, contact_id, track_ids, sent_at, message')
        .in('contact_id', c).gte('sent_at', from).lte('sent_at', to)
        .order('sent_at', { ascending: false }).limit(STREAM_LIMIT)),

      inChunks(contactIds, (c) => admin.from('beat_sends')
        .select('id, contact_id, opened_at, link_clicked_at')
        .in('contact_id', c).gte('opened_at', from).lte('opened_at', to)
        .order('opened_at', { ascending: false }).limit(STREAM_LIMIT)),

      admin
        .from('rating_history')
        .select('id, track_id, user_id, rating, rated_at')
        .eq('user_id', userId)
        .gte('rated_at', from).lte('rated_at', to)
        .order('rated_at', { ascending: false }).limit(STREAM_LIMIT),

      readNotifications(admin, userId, from, to),
      readContactActivity(admin, userId, from, to),
    ]);

    const items: ActivityItem[] = [];

    for (const t of ((tracks.data ?? []) as { id: string; title: string | null; created_at: string }[])) {
      if (!trackTitles.has(t.id)) continue; // an org song is not the producer's activity
      items.push(uploadItem(t));
    }
    for (const v of versions) items.push(versionItem(v as Parameters<typeof versionItem>[0], names));
    for (const c of comments) items.push(commentItem(c as Parameters<typeof commentItem>[0], names));
    for (const s of sends) items.push(sendItem(s as Parameters<typeof sendItem>[0], names));
    for (const s of opens) {
      const it = openedItem(s as Parameters<typeof openedItem>[0], names);
      if (it) items.push(it);
    }
    for (const r of ((ratings.data ?? []) as Parameters<typeof ratingItem>[0][])) items.push(ratingItem(r, names));
    for (const n of notes) {
      const it = notificationItem(n as Parameters<typeof notificationItem>[0], presentNotification(n as { kind: string; data?: unknown }));
      if (it) items.push(it);
    }
    for (const a of timeline) {
      const it = contactActivityItem(a as Parameters<typeof contactActivityItem>[0], names);
      if (it) items.push(it);
    }

    return NextResponse.json({ activity: mergeActivity(items, 400), from, to });
  } catch (error) {
    log.error('activity fetch failed', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/** Comments on the owner's projects. `contact_id` (mig 128) is read when it exists. */
async function readComments(admin: Admin, projectIds: string[], from: string, to: string): Promise<Row[]> {
  const read = (cols: string) => inChunks(projectIds, (c) => admin.from('project_comments')
    .select(cols).in('project_id', c).gte('created_at', from).lte('created_at', to)
    .order('created_at', { ascending: false }).limit(STREAM_LIMIT));
  const base = 'id, project_id, track_id, user_id, share_token, author_name, body, created_at';
  // A missing column makes every chunk fail (logged, read as empty); retry once without it.
  const rows = await read(`${base}, contact_id`);
  if (rows.length > 0 || projectIds.length === 0) return rows;
  return read(base);
}

/** Producer bell rows of the money / delivery kinds. Only `org_id IS NULL` (an org ask is the org bell's). */
async function readNotifications(admin: Admin, userId: string, from: string, to: string): Promise<Row[]> {
  const kinds = ['purchase', 'refund', 'dispute', 'buyer_offer', 'fulfillment_alert'];
  const read = (orgScoped: boolean) => {
    const q = admin.from('notifications').select('id, kind, title, data, created_at')
      .eq('user_id', userId).in('kind', kinds).gte('created_at', from).lte('created_at', to)
      .order('created_at', { ascending: false }).limit(STREAM_LIMIT);
    return orgScoped ? q.is('org_id', null) : q;
  };
  let res = await read(true);
  if (res.error && isMissingSchema(res.error)) res = await read(false);
  if (res.error) {
    if (!isMissingSchema(res.error)) log.warn('activity notifications read failed', { error: res.error.message });
    return [];
  }
  return (res.data ?? []) as Row[];
}

/** The artist-written timeline kinds (see the taxonomy for what is left out), the owner's rows only. */
async function readContactActivity(admin: Admin, userId: string, from: string, to: string): Promise<Row[]> {
  const res = await admin.from('contact_activity')
    .select('id, contact_id, kind, metadata, occurred_at')
    .eq('user_id', userId)
    .in('kind', ['decision_changed', 'artist_message', 'artist_request', 'artist_request_resolved', 'file_uploaded'])
    .gte('occurred_at', from).lte('occurred_at', to)
    .order('occurred_at', { ascending: false }).limit(STREAM_LIMIT);
  if (res.error) {
    if (!isMissingSchema(res.error)) log.warn('activity timeline read failed', { error: res.error.message });
    return [];
  }
  return (res.data ?? []) as Row[];
}

// ---- ownership pre-resolution -----------------------------------------------
// These helpers run once per request: their ids scope every child stream in the
// database, and their names are what the rows say.

/**
 * The producer's own tracks / projects: `user_id` is theirs, or NULL for the
 * legacy producer rows that predate ownership. An ORGANIZATION row is also
 * ownerless (Label OS: org rows never carry a user_id, mig 142), so the NULL
 * arm would hand every producer the titles — and, for projects, the comments,
 * internal notes included — of every org. Org rows are excluded explicitly.
 * Before migration 141 there is no `org_id` column and nothing to exclude, so
 * the read steps down to the plain filter.
 */
async function resolveOwned(admin: Admin, table: 'tracks' | 'projects', cols: string, userId: string): Promise<Row[]> {
  const read = (excludeOrg: boolean) => {
    const q = admin.from(table).select(cols).or(`user_id.eq.${userId},user_id.is.null`);
    return excludeOrg ? q.is('org_id', null) : q;
  };
  let res = await read(true);
  // Only a MISSING column steps down to the plain filter. Any other failure
  // must not: the plain filter is the one that lets org rows in.
  if (res.error && isMissingSchema(res.error)) res = await read(false);
  if (res.error) throw new Error(`activity ownership read failed: ${res.error.message}`);
  return (res.data ?? []) as unknown as Row[];
}

async function resolveOwnedContacts(admin: Admin, userId: string): Promise<Row[]> {
  // Strictly the producer's own. A NULL-owner contact is no longer a legacy
  // producer row (mig 111 adopted those onto the producer) but a Label OS org
  // contact (mig 139: org contacts never carry a user_id), which must never
  // reach the producer's feed.
  const { data } = await admin
    .from('contacts')
    .select('id, name')
    .eq('user_id', userId);
  return (data ?? []) as Row[];
}

// ---- local-store path -------------------------------------------------------

function assembleLocal(from: string, to: string): ActivityItem[] {
  const inRange = (iso: string | null | undefined) =>
    !!iso && iso >= from && iso <= to;
  type AnyRow = Record<string, unknown>;
  const tracks = getAll('tracks') as AnyRow[];
  const projects = getAll('projects') as AnyRow[];
  const contacts = getAll('contacts') as AnyRow[];
  const lookup = (rows: AnyRow[], field: string) => (id: string | null | undefined) => {
    const r = id ? rows.find((x) => String(x.id) === id) : null;
    return r ? ((r[field] as string | null) ?? null) : null;
  };
  const names: Names = { track: lookup(tracks, 'title'), project: lookup(projects, 'name'), contact: lookup(contacts, 'name') };
  const items: ActivityItem[] = [];

  for (const t of tracks) {
    if (inRange(t.created_at as string)) items.push(uploadItem({ id: String(t.id), title: (t.title as string) ?? null, created_at: String(t.created_at) }));
  }
  for (const c of getAll('project_comments') as AnyRow[]) {
    if (inRange(c.created_at as string)) items.push(commentItem({ ...(c as object), id: String(c.id), project_id: String(c.project_id ?? ''), created_at: String(c.created_at) } as Parameters<typeof commentItem>[0], names));
  }
  for (const s of getAll('beat_sends') as AnyRow[]) {
    if (inRange(s.sent_at as string)) items.push(sendItem({ id: String(s.id), contact_id: String(s.contact_id ?? ''), track_ids: s.track_ids, sent_at: String(s.sent_at) }, names));
    if (inRange(s.opened_at as string)) {
      const it = openedItem({ id: String(s.id), contact_id: String(s.contact_id ?? ''), opened_at: s.opened_at as string, link_clicked_at: (s.link_clicked_at as string) ?? null }, names);
      if (it) items.push(it);
    }
  }
  // local-store query() returns Rows (not promises); ratings/versions
  // optional — call them only if present in the schema.
  for (const v of query('track_versions', () => true) as AnyRow[]) {
    if (inRange(v.created_at as string)) items.push(versionItem({ id: String(v.id), track_id: String(v.track_id), version_label: (v.version_label as string) ?? null, created_at: String(v.created_at) }, names));
  }
  for (const r of query('rating_history', () => true) as AnyRow[]) {
    if (inRange(r.rated_at as string)) items.push(ratingItem({ id: String(r.id), track_id: String(r.track_id), rating: Number(r.rating), rated_at: String(r.rated_at) }, names));
  }
  return mergeActivity(items, 400);
}
