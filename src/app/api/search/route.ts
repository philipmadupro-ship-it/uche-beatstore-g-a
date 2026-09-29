import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getAll, createServiceClient } from '@/lib/db';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { songArtistNames } from '@/lib/search/labels';
const log = createLogger('api.search');

export const runtime = 'nodejs';

interface SearchTrackRow {
  id: string;
  title?: string | null;
  type?: string | null;
  cover_url?: string | null;
  audio_url?: string | null;
}

interface SearchProjectRow {
  id: string;
  name?: string | null;
  cover_url?: string | null;
}

interface SearchContactRow {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  label?: string | null;
}

/**
 * GET /api/search?q=foo
 *
 * Lightweight cross-entity search for the command palette.
 * Hits tracks, projects, contacts in parallel and returns up to 5 of each.
 *
 * Scoped to the calling user — without the user_id filters the command
 * palette would surface every tenant's titles and contact emails.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (q.length < 1) {
    return NextResponse.json({ tracks: [], projects: [], contacts: [], files: [] });
  }

  try {
    if (isSupabaseConfigured()) {
      const cookieClient = await createServerClient();
      const { data: { user } } = await cookieClient.auth.getUser();
      if (!user) {
        return NextResponse.json({ tracks: [], projects: [], contacts: [], files: [] });
      }

      const sb = createServiceClient();

      const pattern = `%${q.replace(/[%_]/g, '\\$&')}%`;
      // For the .or() filter string, also strip PostgREST grammar chars
      // (comma, parens, backslash, dot) — otherwise a crafted query could
      // break the filter or inject extra OR conditions. (Results stay scoped
      // to user_id by the AND below, but we don't rely on that alone.)
      const orTerm = q.replace(/[%_]/g, '\\$&').replace(/[(),\\.]/g, ' ').trim();
      const orPattern = `%${orTerm}%`;
      const [tracksRes, projectsRes, contactsRes] = await Promise.all([
        sb.from('tracks').select('id, title, type, cover_url, audio_url')
          .ilike('title', pattern).eq('user_id', user.id).limit(5),
        sb.from('projects').select('id, name, cover_url')
          .or(`name.ilike.${orPattern},description.ilike.${orPattern}`).eq('user_id', user.id).limit(5),
        sb.from('contacts').select('id, name, email, role, label')
          .or(`name.ilike.${orPattern},email.ilike.${orPattern}`).eq('user_id', user.id).limit(5),
      ]);

      const tracks = (tracksRes.data || []) as SearchTrackRow[];
      const contacts = (contactsRes.data || []) as SearchContactRow[];
      const extra = await workspaceLabels(sb, user.id, pattern, tracks, contacts)
        .catch(() => ({ songArtists: new Map<string, string>(), artistIds: new Set<string>(), files: [] }));

      return NextResponse.json({
        tracks: tracks.map((t) => ({ ...t, artist: extra.songArtists.get(t.id) ?? null })),
        projects: await withRelatedProjects(sb, user.id, (projectsRes.data || []) as SearchProjectHit[], tracks, contacts)
          .catch(() => (projectsRes.data || []) as SearchProjectHit[]),
        contacts: contacts.map((c) => ({ ...c, is_artist: extra.artistIds.has(c.id) })),
        files: extra.files,
      });
    }

    // Local-store fallback
    const lower = q.toLowerCase();
    const matches = (s: string | null | undefined) =>
      (s || '').toLowerCase().includes(lower);

    const tracks = getAll<SearchTrackRow>('tracks')
      .filter((t) => matches(t.title))
      .slice(0, 5)
      .map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type,
        cover_url: t.cover_url,
        audio_url: t.audio_url,
      }));

    const projects = getAll<SearchProjectRow>('projects')
      .filter((p) => matches(p.name))
      .slice(0, 5)
      .map((p) => ({ id: p.id, name: p.name, cover_url: p.cover_url }));

    const contacts = getAll<SearchContactRow>('contacts')
      .filter((c) => matches(c.name) || matches(c.email))
      .slice(0, 5)
      .map((c) => ({ id: c.id, name: c.name, email: c.email, role: c.role, label: c.label }));

    return NextResponse.json({ tracks, projects, contacts, files: [] });
  } catch (err: unknown) {
    log.error('Search error:', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/**
 * The artist-workspace additions (migrations 122–127): project files that
 * match, the artist behind each song hit, and which contact hits are artists.
 * Every query is owner-filtered and optional — before the migrations, or on
 * any error, search answers exactly what it did before.
 */
async function workspaceLabels(
  sb: ReturnType<typeof createServiceClient>,
  userId: string,
  pattern: string,
  tracks: SearchTrackRow[],
  contacts: SearchContactRow[],
): Promise<{
  songArtists: Map<string, string>;
  artistIds: Set<string>;
  files: Array<{ id: string; project_id: string; project_name: string; label: string; kind: string }>;
}> {
  const songIds = tracks.filter((t) => t.type === 'song').map((t) => t.id);
  const contactIds = contacts.map((c) => c.id);
  const out = { songArtists: new Map<string, string>(), artistIds: new Set<string>(), files: [] as Array<{ id: string; project_id: string; project_name: string; label: string; kind: string }> };

  const [filesRes, creditsRes, songProjectsRes, artistLinksRes, artistPortalsRes] = await Promise.all([
    sb.from('project_assets').select('id, project_id, label, kind').eq('user_id', userId).ilike('label', pattern).limit(5),
    songIds.length ? sb.from('track_collaborators').select('track_id, contact_id').in('track_id', songIds).not('contact_id', 'is', null) : Promise.resolve({ data: [], error: null }),
    songIds.length ? sb.from('project_tracks').select('project_id, track_id').in('track_id', songIds) : Promise.resolve({ data: [], error: null }),
    contactIds.length ? sb.from('project_contacts').select('contact_id').eq('user_id', userId).in('contact_id', contactIds) : Promise.resolve({ data: [], error: null }),
    contactIds.length ? sb.from('artist_portals').select('contact_id').eq('user_id', userId).in('contact_id', contactIds) : Promise.resolve({ data: [], error: null }),
  ]);

  for (const r of [...(artistLinksRes.data ?? []), ...(artistPortalsRes.data ?? [])] as Array<{ contact_id: string }>) out.artistIds.add(r.contact_id);

  const files = (filesRes.error ? [] : filesRes.data ?? []) as Array<{ id: string; project_id: string; label: string; kind: string }>;
  const credits = (creditsRes.error ? [] : creditsRes.data ?? []) as Array<{ track_id: string; contact_id: string | null }>;
  const songProjects = (songProjectsRes.error ? [] : songProjectsRes.data ?? []) as Array<{ project_id: string; track_id: string }>;

  const projectIds = [...new Set([...files.map((f) => f.project_id), ...songProjects.map((p) => p.project_id)])];
  const [projectsRes, linksRes] = projectIds.length
    ? await Promise.all([
        sb.from('projects').select('id, name').in('id', projectIds).eq('user_id', userId),
        songProjects.length
          ? sb.from('project_contacts').select('project_id, contact_id, role, created_at').eq('user_id', userId).in('project_id', [...new Set(songProjects.map((p) => p.project_id))])
          : Promise.resolve({ data: [], error: null }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const projectName = new Map(((projectsRes.data ?? []) as Array<{ id: string; name: string | null }>).map((p) => [p.id, p.name ?? 'Untitled project']));
  const links = (linksRes.error ? [] : linksRes.data ?? []) as Array<{ project_id: string; contact_id: string; role: string; created_at: string }>;

  out.files = files
    .filter((f) => projectName.has(f.project_id))
    .map((f) => ({ id: f.id, project_id: f.project_id, project_name: projectName.get(f.project_id)!, label: f.label, kind: f.kind }));

  const nameIds = [...new Set([...credits.map((c) => c.contact_id), ...links.map((l) => l.contact_id)].filter((x): x is string => !!x))];
  if (songIds.length && nameIds.length) {
    const { data } = await sb.from('contacts').select('id, name').in('id', nameIds).eq('user_id', userId);
    out.songArtists = songArtistNames({
      songIds,
      credits,
      projectTracks: songProjects,
      links,
      contactNames: new Map(((data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name])),
    });
  }
  return out;
}

type SearchProjectHit = { id: string; name: string; cover_url: string | null; via?: string | null };

/**
 * Search inside projects: besides a name or description hit, a project is a
 * result when it CONTAINS a matching track or is LINKED to a matching artist
 * (mig 122), labelled with why (`via`). Owner-filtered; capped at 8.
 */
async function withRelatedProjects(
  sb: ReturnType<typeof createServiceClient>,
  userId: string,
  direct: SearchProjectHit[],
  tracks: Array<{ id: string; title?: string | null }>,
  contacts: Array<{ id: string; name?: string | null }>,
): Promise<SearchProjectHit[]> {
  const out = new Map(direct.map((p) => [p.id, { ...p, via: null as string | null }]));
  const [viaTracks, viaContacts] = await Promise.all([
    tracks.length
      ? sb.from('project_tracks').select('project_id, track_id').in('track_id', tracks.map((t) => t.id)).limit(50)
      : Promise.resolve({ data: [], error: null }),
    contacts.length
      ? sb.from('project_contacts').select('project_id, contact_id').in('contact_id', contacts.map((c) => c.id)).eq('user_id', userId).limit(50)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const reasons = new Map<string, string>();
  for (const r of (viaTracks.error ? [] : viaTracks.data ?? []) as Array<{ project_id: string; track_id: string }>) {
    const t = tracks.find((x) => x.id === r.track_id);
    if (!reasons.has(r.project_id)) reasons.set(r.project_id, `has ${t?.title ?? 'a matching track'}`);
  }
  for (const r of (viaContacts.error ? [] : viaContacts.data ?? []) as Array<{ project_id: string; contact_id: string }>) {
    const c = contacts.find((x) => x.id === r.contact_id);
    if (!reasons.has(r.project_id)) reasons.set(r.project_id, `with ${c?.name ?? 'a matching artist'}`);
  }
  const extraIds = [...reasons.keys()].filter((id) => !out.has(id)).slice(0, 8);
  if (extraIds.length) {
    const { data } = await sb.from('projects').select('id, name, cover_url').in('id', extraIds).eq('user_id', userId);
    for (const p of (data ?? []) as SearchProjectHit[]) out.set(p.id, { ...p, via: reasons.get(p.id) ?? null });
  }
  return [...out.values()].slice(0, 8);
}
