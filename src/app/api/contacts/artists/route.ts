import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { selectIn } from '@/lib/db/chunked-in';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { loadPortalAssets, toPortalFileRows } from '@/lib/artist-portal/files';
import { sortArtistSummaries, summarizeArtist } from '@/lib/contacts/artist-summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.contacts.artists');

const ENGAGEMENT_WINDOW_DAYS = 90;

/**
 * GET /api/contacts/artists — every contact in workspace mode (linked to a
 * project or holding a portal), summarised for the Artists card view.
 *
 * A fixed number of owner-filtered batch queries for the whole list — never
 * one workspace load per artist — then `summarizeArtist` per contact, which
 * applies the same rules as the workspace. Before migrations 122–126 there
 * are no artists: `schemaReady: false`.
 */
export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ schemaReady: false, artists: [] });
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  try {
    const [linksRes, portalsRes] = await Promise.all([
      admin.from('project_contacts').select('contact_id, project_id, in_portal, created_at, last_notified_at').eq('user_id', userId),
      admin.from('artist_portals').select('contact_id, revoked_at, last_viewed_at').eq('user_id', userId),
    ]);
    for (const r of [linksRes, portalsRes]) {
      if (r.error) {
        if (isMissingSchema(r.error)) return NextResponse.json({ schemaReady: false, artists: [] });
        throw r.error;
      }
    }
    const links = (linksRes.data ?? []) as Array<{ contact_id: string; project_id: string; in_portal: boolean; created_at: string; last_notified_at: string | null }>;
    const portals = (portalsRes.data ?? []) as Array<{ contact_id: string; revoked_at: string | null; last_viewed_at: string | null }>;
    const contactIds = [...new Set([...links.map((l) => l.contact_id), ...portals.map((p) => p.contact_id)])];
    if (contactIds.length === 0) return NextResponse.json({ schemaReady: true, artists: [] });

    const projectIds = [...new Set(links.map((l) => l.project_id))];
    const portalProjectIds = [...new Set(links.filter((l) => l.in_portal).map((l) => l.project_id))];
    const since = new Date(Date.now() - ENGAGEMENT_WINDOW_DAYS * 86_400_000).toISOString();

    const [contacts, projects, states, sends, activity, shares, projectTracks, assets] = await Promise.all([
      selectIn<{ id: string; name: string; avatar_url: string | null; crm_status: string | null }>((ids) => admin.from('contacts').select('id, name, avatar_url, crm_status').in('id', ids).eq('user_id', userId), contactIds),
      selectIn<{ id: string; name: string | null; cover_url: string | null; status: string | null }>((ids) => admin.from('projects').select('id, name, cover_url, status').in('id', ids).eq('user_id', userId), projectIds),
      selectIn<{ contact_id: string; decision: string | null }>((ids) => admin.from('contact_track_states').select('contact_id, decision').in('contact_id', ids).eq('user_id', userId), contactIds),
      selectIn<{ contact_id: string; opened_at: string | null; link_clicked_at: string | null }>((ids) => admin.from('beat_sends').select('contact_id, opened_at, link_clicked_at').in('contact_id', ids), contactIds),
      selectIn<{ contact_id: string; kind: string }>((ids) => admin.from('contact_activity').select('contact_id, kind').in('contact_id', ids).eq('user_id', userId)
        .in('kind', ['portal_opened', 'track_played', 'track_downloaded', 'file_downloaded']).gte('occurred_at', since), contactIds),
      selectIn<{ contact_id: string }>((ids) => admin.from('project_shares').select('contact_id').in('contact_id', ids), contactIds),
      selectIn<{ project_id: string; track_id: string; added_at: string }>((ids) => admin.from('project_tracks').select('project_id, track_id, added_at').in('project_id', ids), portalProjectIds),
      loadPortalAssets(admin, userId, portalProjectIds),
    ]);

    const group = <T extends { contact_id: string }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) m.set(r.contact_id, [...(m.get(r.contact_id) ?? []), r]);
      return m;
    };
    const linksBy = group(links);
    const statesBy = group(states);
    const sendsBy = group(sends);
    const activityBy = group(activity);
    const sharesBy = group(shares);
    const portalBy = new Map(portals.map((p) => [p.contact_id, p]));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const portalTracks = projectTracks.map((pt) => ({ projectId: pt.project_id, trackId: pt.track_id, addedAt: pt.added_at }));
    const portalFiles = toPortalFileRows(assets);

    const artists = sortArtistSummaries(contacts.map((c) => {
      const mine = linksBy.get(c.id) ?? [];
      return summarizeArtist({
        contact: c,
        links: mine,
        projects: mine.map((l) => projectById.get(l.project_id)).filter((p): p is NonNullable<typeof p> => !!p),
        portal: portalBy.get(c.id) ?? null,
        decisions: (statesBy.get(c.id) ?? []).map((s) => s.decision),
        sends: sendsBy.get(c.id) ?? [],
        activity: activityBy.get(c.id) ?? [],
        shareCount: (sharesBy.get(c.id) ?? []).length,
        portalTracks,
        portalFiles,
      });
    }));

    return NextResponse.json({ schemaReady: true, artists });
  } catch (err) {
    if (isMissingSchema(err)) return NextResponse.json({ schemaReady: false, artists: [] });
    log.error('artists load failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
