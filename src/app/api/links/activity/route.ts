/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, requireUser } from '@/lib/db';
import { selectIn } from '@/lib/db/chunked-in';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import {
  summarizeLinkActivity,
  type LinkActivity,
  type SendRow,
  type ShareEventRow,
} from '@/lib/links/link-activity';

const log = createLogger('api.links.activity');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LINKS = 200;
const PAGE = 1000;
const MAX_PAGES = 10;

type Ref = { source: 'share_links' | 'project_shares'; id: string };

function parseRefs(raw: string | null): Ref[] {
  const seen = new Set<string>();
  const out: Ref[] = [];
  for (const part of (raw ?? '').split(',')) {
    const [source, id] = part.trim().split(':');
    if ((source !== 'share_links' && source !== 'project_shares') || !UUID_RE.test(id ?? '')) continue;
    const key = `${source}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source, id });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/**
 * GET /api/links/activity?links=share_links:<id>,project_shares:<id>,…
 *
 * What happened on each listed link: sends, opens, people, plays, downloads,
 * last activity. Owner-only — every read filters by the caller's id, and the
 * client only ever handles row ids (the token → id step stays on the server).
 * `{ schemaReady: false }` while migration 203 is not applied.
 */
export async function GET(req: NextRequest) {
  try {
    if (!isSupabaseConfigured()) return NextResponse.json({ schemaReady: false, activity: {} });
    const owner = await requireUser();
    if (!owner.ok) return owner.res;
    const { admin, userId } = owner;

    const refs = parseRefs(req.nextUrl.searchParams.get('links'));
    if (refs.length === 0) return NextResponse.json({ schemaReady: true, activity: {} });

    // The caller's own share rows (owner filter), for the token and counters.
    // share_links carries user_id; project_shares has none — its owner is the
    // owner of the project / playlist / track it points at.
    const shareRows = new Map<string, { id: string; source: Ref['source']; token: string | null; plays: number | null; created_at: string }>();
    const legacyIds = refs.filter((r) => r.source === 'share_links').map((r) => r.id);
    for (const r of await selectIn<any>(
      (slice) => admin.from('share_links').select('id, token, plays, created_at').eq('user_id', userId).in('id', slice),
      legacyIds,
    )) {
      shareRows.set(`share_links:${r.id}`, { id: r.id, source: 'share_links', token: r.token ?? null, plays: r.plays ?? null, created_at: r.created_at });
    }
    const modernRows = await selectIn<any>(
      (slice) => admin.from('project_shares').select('id, token, plays, created_at, content_type, project_id, playlist_id, track_id').in('id', slice),
      refs.filter((r) => r.source === 'project_shares').map((r) => r.id),
    );
    const parentOf = (r: any): { table: 'projects' | 'playlists' | 'tracks'; id: string } | null => {
      const kind = r.content_type ?? 'project';
      if (kind === 'playlist' && r.playlist_id) return { table: 'playlists', id: r.playlist_id };
      if (kind === 'track' && r.track_id) return { table: 'tracks', id: r.track_id };
      return r.project_id ? { table: 'projects', id: r.project_id } : null;
    };
    const mine = new Set<string>();
    for (const table of ['projects', 'playlists', 'tracks'] as const) {
      const ids = [...new Set(modernRows.map(parentOf).filter((p): p is NonNullable<ReturnType<typeof parentOf>> => !!p && p.table === table).map((p) => p.id))];
      for (const row of await selectIn<any>((slice) => admin.from(table).select('id').eq('user_id', userId).in('id', slice), ids)) {
        mine.add(`${table}:${row.id}`);
      }
    }
    for (const r of modernRows) {
      const parent = parentOf(r);
      if (!parent || !mine.has(`${parent.table}:${parent.id}`)) continue;
      shareRows.set(`project_shares:${r.id}`, { id: r.id, source: 'project_shares', token: r.token ?? null, plays: r.plays ?? null, created_at: r.created_at });
    }
    const owned = refs.filter((r) => shareRows.has(`${r.source}:${r.id}`));
    if (owned.length === 0) return NextResponse.json({ schemaReady: true, activity: {} });

    // Events. Reading first is the schema probe: a missing table is an error here.
    const eventsByShare = new Map<string, ShareEventRow[]>();
    try {
      await selectIn<any>(async (slice) => {
        let rows: any[] = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const { data, error } = await admin
            .from('share_events')
            .select('share_source, share_id, kind, ip_hash, created_at')
            .eq('owner_user_id', userId)
            .in('share_id', slice)
            .order('created_at', { ascending: false })
            .range(page * PAGE, page * PAGE + PAGE - 1);
          if (error) return { data: null, error };
          rows = rows.concat(data ?? []);
          if ((data ?? []).length < PAGE) break;
        }
        for (const r of rows) {
          const key = `${r.share_source}:${r.share_id}`;
          const list = eventsByShare.get(key) ?? [];
          list.push({ kind: r.kind, ip_hash: r.ip_hash ?? null, created_at: r.created_at });
          eventsByShare.set(key, list);
        }
        return { data: [], error: null };
      }, owned.map((r) => r.id));
    } catch (err) {
      if (isMissingSchema(err)) return NextResponse.json({ schemaReady: false, activity: {} });
      throw err;
    }

    // Sends: beat_sends rows carrying the link's token, kept only for the
    // caller's own contacts (beat_sends has no owner column).
    const tokens = [...new Set(owned.map((r) => shareRows.get(`${r.source}:${r.id}`)!.token).filter((t): t is string => !!t))];
    const sends = await selectIn<any>(
      (slice) => admin.from('beat_sends').select('contact_id, share_token, sent_at, opened_at, link_clicked_at').in('share_token', slice),
      tokens,
    );
    const contactIds = [...new Set(sends.map((s) => s.contact_id).filter(Boolean))] as string[];
    const myContacts = new Set(
      (await selectIn<any>((slice) => admin.from('contacts').select('id').eq('user_id', userId).in('id', slice), contactIds)).map((c) => c.id),
    );
    const sendsByToken = new Map<string, SendRow[]>();
    for (const s of sends) {
      if (!myContacts.has(s.contact_id)) continue;
      const list = sendsByToken.get(s.share_token) ?? [];
      list.push({ contact_id: s.contact_id, sent_at: s.sent_at, opened_at: s.opened_at ?? null, link_clicked_at: s.link_clicked_at ?? null });
      sendsByToken.set(s.share_token, list);
    }

    const activity: Record<string, LinkActivity> = {};
    for (const r of owned) {
      const key = `${r.source}:${r.id}`;
      const row = shareRows.get(key)!;
      activity[key] = summarizeLinkActivity({
        link: { plays: row.plays, created_at: row.created_at },
        events: eventsByShare.get(key) ?? [],
        sends: row.token ? sendsByToken.get(row.token) ?? [] : [],
      });
    }
    return NextResponse.json({ schemaReady: true, activity });
  } catch (err) {
    log.error('link activity failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
