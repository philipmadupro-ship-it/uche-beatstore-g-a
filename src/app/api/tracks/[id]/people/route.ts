import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { selectIn } from '@/lib/db/chunked-in';
import { isDecision } from '@/lib/contacts/decisions';
import { engagementByTrack, signalsFromActivity, signalsFromSends } from '@/lib/contacts/track-engagement';
import { isSchemaNotReady } from '@/lib/artists/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.tracks.people');

/**
 * GET /api/tracks/[id]/people — "who has this?" for the track drawer.
 *
 * Rows answer it as links, not a graph: each artist connected to the beat
 * (through a project they are linked to, a decision, or a send) with the
 * project it arrived through, their decision and play count; the songs built
 * on this beat; and, for a song, the beat it is built on.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Local-store mode (no Supabase): the workspace tables do not exist there.
  if (!isSupabaseConfigured()) return NextResponse.json({ schemaReady: false, people: [], songs: [], builtOn: null });
  const auth = await requireRowOwnership('tracks', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  try {
    const [trackRes, projectTracksRes, statesRes, sendsRes, songsRes] = await Promise.all([
      admin.from('tracks').select('id, type, beat_track_id').eq('id', id).eq('user_id', userId).maybeSingle(),
      admin.from('project_tracks').select('project_id').eq('track_id', id),
      admin.from('contact_track_states').select('contact_id, project_id, decision, set_by, updated_at').eq('track_id', id).eq('user_id', userId),
      admin.from('beat_sends').select('contact_id, track_ids, sent_at, opened_at, link_clicked_at').contains('track_ids', [id]).order('sent_at', { ascending: false }).limit(200),
      admin.from('tracks').select('id, title, status').eq('beat_track_id', id).eq('user_id', userId),
    ]);
    for (const r of [trackRes, projectTracksRes, statesRes, sendsRes, songsRes]) if (r.error) throw r.error;
    const track = trackRes.data as { id: string; type: string | null; beat_track_id: string | null } | null;
    if (!track) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const projectIds = ((projectTracksRes.data ?? []) as Array<{ project_id: string }>).map((r) => r.project_id);
    const [links, projects] = await Promise.all([
      projectIds.length
        ? selectIn<{ project_id: string; contact_id: string; role: string; in_portal: boolean }>((ids) => admin.from('project_contacts').select('project_id, contact_id, role, in_portal').in('project_id', ids).eq('user_id', userId), projectIds)
        : Promise.resolve([]),
      projectIds.length
        ? selectIn<{ id: string; name: string | null }>((ids) => admin.from('projects').select('id, name').in('id', ids).eq('user_id', userId), projectIds)
        : Promise.resolve([]),
    ]);
    const states = (statesRes.data ?? []) as Array<{ contact_id: string; project_id: string | null; decision: string | null; set_by: string; updated_at: string }>;
    const sends = (sendsRes.data ?? []) as Array<{ contact_id: string; track_ids: string[]; sent_at: string | null; opened_at: string | null; link_clicked_at: string | null }>;

    const contactIds = [...new Set([...links.map((l) => l.contact_id), ...states.map((s) => s.contact_id), ...sends.map((s) => s.contact_id)])];
    const [contacts, activity] = await Promise.all([
      contactIds.length
        ? selectIn<{ id: string; name: string; avatar_url: string | null }>((ids) => admin.from('contacts').select('id, name, avatar_url').in('id', ids).eq('user_id', userId), contactIds)
        : Promise.resolve([]),
      contactIds.length
        ? selectIn<{ contact_id: string; kind: string; occurred_at: string; metadata: Record<string, unknown> | null }>((ids) => admin.from('contact_activity').select('contact_id, kind, occurred_at, metadata').in('contact_id', ids).eq('user_id', userId).in('kind', ['track_played', 'track_downloaded']).eq('metadata->>track_id', id), contactIds)
        : Promise.resolve([]),
    ]);
    const projectName = new Map(projects.map((p) => [p.id, p.name ?? 'Untitled project']));

    const people = contacts.map((c) => {
      const st = states.find((s) => s.contact_id === c.id);
      const via = links.filter((l) => l.contact_id === c.id).map((l) => ({ id: l.project_id, name: projectName.get(l.project_id) ?? 'Untitled project', inPortal: l.in_portal }));
      const eng = engagementByTrack([
        ...signalsFromSends(sends.filter((s) => s.contact_id === c.id)),
        ...signalsFromActivity(activity.filter((a) => a.contact_id === c.id)),
      ]).get(id);
      return {
        contact: c,
        projects: via,
        decision: st && isDecision(st.decision) ? st.decision : null,
        decisionSetBy: st && isDecision(st.decision) ? st.set_by : null,
        engagement: eng ?? null,
      };
    }).sort((a, b) => Number(!!b.decision) - Number(!!a.decision) || a.contact.name.localeCompare(b.contact.name));

    let builtOn: { id: string; title: string } | null = null;
    if (track.beat_track_id) {
      const { data: beat } = await admin.from('tracks').select('id, title').eq('id', track.beat_track_id).eq('user_id', userId).maybeSingle();
      if (beat) builtOn = { id: beat.id, title: beat.title ?? 'Untitled' };
    }

    return NextResponse.json({
      schemaReady: true,
      people,
      songs: (songsRes.data ?? []) as Array<{ id: string; title: string | null; status: string | null }>,
      builtOn,
    });
  } catch (err) {
    if (isSchemaNotReady(err)) return NextResponse.json({ schemaReady: false, people: [], songs: [], builtOn: null });
    log.error('people load failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
