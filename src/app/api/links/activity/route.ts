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
    const shareRows = new Map<string, { id: string; source: Ref['source']; token: string | null; plays: number | null; created_at: string }>();
    for (const source of ['share_links', 'project_shares'] as const) {
      const ids = refs.filter((r) => r.source === source).map((r) => r.id);
      const rows = await selectIn<any>(
        (slice) => admin.from(source).select('id, token, plays, created_at').eq('user_id', userId).in('id', slice),
        ids,
      );
      for (const r of rows) shareRows.set(`${source}:${r.id}`, { id: r.id, source, token: r.token ?? null, plays: r.plays ?? null, created_at: r.created_at });
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
    const mine = new Set(
      (await selectIn<any>((slice) => admin.from('contacts').select('id').eq('user_id', userId).in('id', slice), contactIds)).map((c) => c.id),
    );
    const sendsByToken = new Map<string, SendRow[]>();
    for (const s of sends) {
      if (!mine.has(s.contact_id)) continue;
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
