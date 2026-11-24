/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, requireUser } from '@/lib/db';
import { selectIn } from '@/lib/db/chunked-in';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';
import { BeatSendsDuplicatesBodySchema } from '@/lib/contracts';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { normalizeEmail } from '@/lib/contacts/email';
import {
  DUPLICATE_WINDOW_DAYS,
  findDuplicateSends,
  recipientKey,
  type PriorSend,
  type ShareActivity,
} from '@/lib/crm/duplicate-sends';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.beat_sends.duplicates');

const PAGE = 1000;
const MAX_PAGES = 10;

/** Every page of a chunk's query: a contact's history can pass PostgREST's 1000-row default. */
async function pagedRows(run: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: unknown }>) {
  let rows: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await run(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { data: null, error };
    rows = rows.concat(data ?? []);
    if ((data ?? []).length < PAGE) break;
  }
  return { data: rows, error: null };
}

/**
 * POST /api/beat_sends/duplicates
 *
 * Which recipients already have any of these tracks from an earlier send in
 * the last 90 days (SHARE-08). A warning for the send flow, never a block.
 * Owner-only: every read filters by the caller's id (beat_sends has no owner
 * column, so it is read through the caller's own contacts).
 */
export async function POST(req: NextRequest) {
  try {
    if (!isSupabaseConfigured()) return NextResponse.json({ duplicates: [] });
    const owner = await requireUser();
    if (!owner.ok) return owner.res;
    const { admin, userId } = owner;

    const parsed = await readBody(req, BeatSendsDuplicatesBodySchema);
    if (!parsed.ok) return parsed.res;
    const body = parsed.data;

    // What is about to be sent: picked tracks plus a project's current tracks,
    // each limited to the caller's own rows.
    const wanted = new Set(body.track_ids ?? []);
    if (body.project_id) {
      const { data: project, error } = await admin.from('projects').select('id').eq('id', body.project_id).eq('user_id', userId).maybeSingle();
      if (error) throw error;
      if (project) {
        const links = await selectIn<any>((s) => admin.from('project_tracks').select('track_id').in('project_id', s), [body.project_id]);
        for (const l of links) wanted.add(l.track_id);
      }
    }
    const mineTracks = await selectIn<any>((s) => admin.from('tracks').select('id, title').eq('user_id', userId).in('id', s), [...wanted]);
    const titles = new Map<string, string>(mineTracks.map((t) => [t.id, t.title ?? '']));
    const newTrackIds = [...wanted].filter((id) => titles.has(id));
    if (newTrackIds.length === 0) return NextResponse.json({ duplicates: [] });

    // Recipients → the caller's contacts. An email matches by normalised address.
    const refs = body.recipients
      .map((r) => ({ key: recipientKey(r), contact_id: r.contact_id ?? null, email: r.email ? normalizeEmail(r.email) : null }))
      .filter((r): r is { key: string; contact_id: string | null; email: string | null } => !!r.key);
    const byId = new Set<string>();
    const emails = [...new Set(refs.filter((r) => !r.contact_id && r.email).map((r) => r.email as string))];
    for (const c of await selectIn<any>((s) => admin.from('contacts').select('id').eq('user_id', userId).in('id', s), [...new Set(refs.map((r) => r.contact_id).filter(Boolean) as string[])])) {
      byId.add(c.id);
    }
    const idByEmail = new Map<string, string>();
    for (const c of await selectIn<any>((s) => admin.from('contacts').select('id, email').eq('user_id', userId).in('email', s), emails)) {
      if (c.email) idByEmail.set(normalizeEmail(c.email), c.id);
    }
    const recipients = refs.map((r) => ({
      key: r.key,
      contactId: r.contact_id ? (byId.has(r.contact_id) ? r.contact_id : null) : idByEmail.get(r.email ?? '') ?? null,
    }));
    const contactIds = [...new Set(recipients.map((r) => r.contactId).filter(Boolean) as string[])];
    if (contactIds.length === 0) return NextResponse.json({ duplicates: [] });

    // Their sends inside the window.
    const since = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 86_400_000).toISOString();
    const priorSends = (await selectIn<any>(
      (s) => pagedRows((from, to) =>
        admin.from('beat_sends').select('contact_id, track_ids, share_token, sent_at, opened_at, link_clicked_at')
          .in('contact_id', s).gte('sent_at', since).order('sent_at', { ascending: false }).range(from, to)),
      contactIds,
    )) as PriorSend[];

    // A send whose share is a project share also covers the project's current tracks.
    const tokens = [...new Set(priorSends.map((s) => s.share_token).filter((t): t is string => !!t))];
    const projectShares = await selectIn<any>(
      (s) => admin.from('project_shares').select('id, token, project_id, content_type').in('token', s),
      tokens,
    );
    const projectIds = [...new Set(projectShares.filter((p) => (p.content_type ?? 'project') === 'project' && p.project_id).map((p) => p.project_id as string))];
    const myProjects = new Set<string>(
      (await selectIn<any>((s) => admin.from('projects').select('id').eq('user_id', userId).in('id', s), projectIds)).map((p) => p.id),
    );
    const tracksOfProject = new Map<string, string[]>();
    for (const l of await selectIn<any>((s) => admin.from('project_tracks').select('project_id, track_id').in('project_id', s), [...myProjects])) {
      const list = tracksOfProject.get(l.project_id) ?? [];
      list.push(l.track_id);
      tracksOfProject.set(l.project_id, list);
    }
    const projectTracksByToken = new Map<string, string[]>();
    const projectShareIdByToken = new Map<string, string>();
    for (const p of projectShares) {
      if (!p.project_id || !myProjects.has(p.project_id)) continue;
      projectShareIdByToken.set(p.token, p.id);
      if ((p.content_type ?? 'project') === 'project') projectTracksByToken.set(p.token, tracksOfProject.get(p.project_id) ?? []);
    }

    const first = findDuplicateSends({ recipients, newTrackIds, priorSends, projectTracksByToken });

    // What happened on the latest overlapping send's link (share_events, mig 203).
    let activityByToken: Map<string, ShareActivity> | null = null;
    const latestTokens = [...new Set(first.map((e) => e.shareToken).filter((t): t is string => !!t))];
    if (first.length > 0 && latestTokens.length > 0) {
      const legacy = await selectIn<any>((s) => admin.from('share_links').select('id, token').eq('user_id', userId).in('token', s), latestTokens);
      const idByToken = new Map<string, string>(projectShareIdByToken);
      for (const l of legacy) idByToken.set(l.token, l.id);
      const shareIds = [...new Set(latestTokens.map((t) => idByToken.get(t)).filter((x): x is string => !!x))];
      try {
        const events = await selectIn<any>(
          (s) => pagedRows((from, to) =>
            admin.from('share_events').select('share_id, kind').eq('owner_user_id', userId).in('share_id', s)
              .order('created_at', { ascending: false }).range(from, to)),
          shareIds,
        );
        const byShare = new Map<string, ShareActivity>();
        for (const e of events) {
          const a = byShare.get(e.share_id) ?? { opens: 0, plays: 0, downloads: 0 };
          if (e.kind === 'open') a.opens += 1;
          else if (e.kind === 'play') a.plays += 1;
          else if (e.kind === 'download' || e.kind === 'download_all') a.downloads += 1;
          byShare.set(e.share_id, a);
        }
        activityByToken = new Map();
        for (const t of latestTokens) {
          const id = idByToken.get(t);
          if (id) activityByToken.set(t, byShare.get(id) ?? { opens: 0, plays: 0, downloads: 0 });
        }
      } catch (err) {
        // Before 203 the table is missing: degrade silently to email stamps only.
        if (!isMissingSchema(err)) throw err;
      }
    }
    const entries = activityByToken ? findDuplicateSends({ recipients, newTrackIds, priorSends, projectTracksByToken, activityByToken }) : first;

    return NextResponse.json({
      duplicates: entries.map((e) => ({
        key: e.key,
        tracks: e.overlappingTrackIds.map((id) => ({ id, title: titles.get(id) ?? '' })),
        last_sent_at: e.lastSentAt,
        email_opened: e.outcome.emailOpened,
        link_clicked: e.outcome.linkClicked,
        activity: e.outcome.activity,
      })),
    });
  } catch (err) {
    log.error('duplicate check failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
