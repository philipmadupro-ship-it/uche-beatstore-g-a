/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { isSupabaseConfigured, getAll, requireUser } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import type { ArtworkKind } from '@/lib/artwork/gradient';
import { selectIn } from '@/lib/db/chunked-in';

/**
 * Which default-artwork slot a share borrows.
 *
 * A share is never artwork of its own — it points at something that has (or
 * lacks) a cover. Mapping the content type onto the producer's per-kind
 * default means a coverless project share picks up the project artwork set in
 * Settings rather than the track one, which is the whole point of that setting
 * being split three ways.
 */
function artworkKindFor(contentType: string, trackCount: number): ArtworkKind {
  if (contentType === 'playlist') return 'playlist';
  if (contentType === 'track') return 'track';
  if (contentType === 'project') return 'project';
  // Legacy ad-hoc shares carry no parent row: one track reads as a track, a
  // pack of them reads as a collection.
  return trackCount > 1 ? 'project' : 'track';
}

type TrackSummary = {
  id: string;
  title: string;
  type: string;
  cover_url: string | null;
};

type ShareListItem = {
  id: string;
  source: 'share_links' | 'project_shares';
  token: string;
  title: string | null;
  content_title: string | null;
  kind: string;
  track_ids: string[];
  tracks: TrackSummary[];
  plays: number;
  expires_at: string | null;
  revoked_at: string | null;
  allow_downloads: boolean;
  password_protected: boolean;
  created_at: string;
  href: string;
  /** The subject's own cover, when it has one. Null falls back to brand artwork. */
  cover_url: string | null;
  /** Which default-artwork slot this link borrows when it has no cover. */
  artwork_kind: ArtworkKind;
  /**
   * Stable identity for the generated gradient. The SUBJECT's id, not the
   * share's: two links pointing at the same project must show the same
   * artwork, or the page looks like it holds two different things.
   */
  artwork_seed: string;
  /** Genre-then-mood tags of the leading track, so gradients match the library. */
  artwork_tags: string[];
};

function localLinks(): ShareListItem[] {
  const tracks = getAll('tracks') as any[];
  const projects = getAll('projects') as any[];
  const playlists = getAll('playlists') as any[];
  const projectTracks = getAll('project_tracks') as any[];
  const playlistTracks = getAll('playlist_tracks') as any[];
  const trackById = new Map(tracks.map((track) => [track.id, track]));

  const tagsByTrack = new Map<string, string[]>();
  for (const row of getAll('track_tags') as any[]) {
    if (row.category !== 'genre' && row.category !== 'mood') continue;
    const existing = tagsByTrack.get(row.track_id) ?? [];
    // Genre leads: it is the axis the gradient encodes, and the axis a
    // producer browses by.
    if (row.category === 'genre') existing.unshift(row.tag);
    else existing.push(row.tag);
    tagsByTrack.set(row.track_id, existing);
  }

  const summarizeTracks = (ids: string[]): TrackSummary[] =>
    ids.flatMap((id) => {
      const track = trackById.get(id);
      return track
        ? [{ id: track.id, title: track.title, type: track.type, cover_url: track.cover_url ?? null }]
        : [];
    });

  const legacy = (getAll('share_links') as any[]).map((share): ShareListItem => {
    const trackIds = Array.isArray(share.track_ids) ? share.track_ids : [];
    const linkTracks = summarizeTracks(trackIds);
    const lead = linkTracks[0];
    return {
      id: share.id,
      source: 'share_links',
      token: share.token,
      title: share.title ?? null,
      content_title: null,
      kind: share.kind ?? (trackIds.length > 1 ? 'project' : 'track'),
      track_ids: trackIds,
      tracks: linkTracks,
      plays: share.plays ?? 0,
      expires_at: share.expires_at ?? null,
      revoked_at: share.revoked_at ?? null,
      allow_downloads: share.allow_downloads !== false,
      password_protected: Boolean(share.password_hash),
      created_at: share.created_at,
      href: `/share/${share.token}`,
      cover_url: lead?.cover_url ?? null,
      artwork_kind: artworkKindFor(share.kind ?? '', trackIds.length),
      artwork_seed: trackIds.length === 1 && lead ? lead.id : share.token,
      artwork_tags: lead ? tagsByTrack.get(lead.id) ?? [] : [],
    };
  });

  const modern = (getAll('project_shares') as any[]).map((share): ShareListItem => {
    const contentType = share.content_type ?? 'project';
    const parent =
      contentType === 'playlist'
        ? playlists.find((playlist) => playlist.id === share.playlist_id)
        : contentType === 'track'
          ? tracks.find((track) => track.id === share.track_id)
          : projects.find((project) => project.id === share.project_id);
    const trackIds =
      contentType === 'playlist'
        ? playlistTracks.filter((row) => row.playlist_id === share.playlist_id).map((row) => row.track_id)
        : contentType === 'track'
          ? [share.track_id].filter(Boolean)
          : projectTracks.filter((row) => row.project_id === share.project_id).map((row) => row.track_id);

    const linkTracks = summarizeTracks(trackIds);
    const lead = linkTracks[0];
    return {
      id: share.id,
      source: 'project_shares',
      token: share.token,
      title: share.label ?? parent?.name ?? parent?.title ?? null,
      content_title: parent?.name ?? parent?.title ?? null,
      kind: contentType,
      track_ids: trackIds,
      tracks: linkTracks,
      plays: share.plays ?? 0,
      expires_at: share.expires_at ?? null,
      revoked_at: share.revoked_at ?? null,
      allow_downloads: share.allow_downloads !== false,
      password_protected: Boolean(share.password_hash),
      created_at: share.created_at,
      href: `/projects/share/${share.token}`,
      cover_url: parent?.cover_url ?? lead?.cover_url ?? null,
      artwork_kind: artworkKindFor(contentType, trackIds.length),
      artwork_seed: parent?.id ?? share.token,
      artwork_tags: lead ? tagsByTrack.get(lead.id) ?? [] : [],
    };
  });

  return [...legacy, ...modern].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ links: localLinks() });
    }

    const owner = await requireUser();
    if (!owner.ok) return owner.res;

    const [legacyRes, projectsRes, playlistsRes, tracksRes] = await Promise.all([
      owner.admin
        .from('share_links')
        .select('id, token, title, kind, track_ids, plays, expires_at, revoked_at, allow_downloads, password_hash, created_at')
        .eq('user_id', owner.userId),
      owner.admin.from('projects').select('id, name, cover_url').eq('user_id', owner.userId),
      owner.admin.from('playlists').select('id, name, cover_url').eq('user_id', owner.userId),
      owner.admin.from('tracks').select('id, title, type, cover_url').eq('user_id', owner.userId),
    ]);

    const firstError = legacyRes.error || projectsRes.error || playlistsRes.error || tracksRes.error;
    if (firstError) throw firstError;

    const projects = projectsRes.data ?? [];
    const playlists = playlistsRes.data ?? [];
    const tracks = tracksRes.data ?? [];
    const projectIds = projects.map((project: any) => project.id);
    const playlistIds = playlists.map((playlist: any) => playlist.id);
    const trackIds = tracks.map((track: any) => track.id);

    const SHARE_FIELDS =
      'id, token, content_type, project_id, playlist_id, track_id, label, plays, expires_at, revoked_at, allow_downloads, password_hash, created_at';

    // A share is owned transitively — through the project, playlist or track
    // it points at — so ownership is expressed as three id filters rather than
    // one user_id. Each is chunked; see ID_CHUNK.
    const [shareRows, projectTrackRows, playlistTrackRows, tagRows] = await Promise.all([
      Promise.all([
        selectIn<any>((ids) => owner.admin.from('project_shares').select(SHARE_FIELDS).in('project_id', ids), projectIds),
        selectIn<any>((ids) => owner.admin.from('project_shares').select(SHARE_FIELDS).in('playlist_id', ids), playlistIds),
        selectIn<any>((ids) => owner.admin.from('project_shares').select(SHARE_FIELDS).in('track_id', ids), trackIds),
      ]).then((groups) => groups.flat()),
      selectIn<any>(
        (ids) => owner.admin.from('project_tracks').select('project_id, track_id, position').in('project_id', ids),
        projectIds,
      ),
      selectIn<any>(
        (ids) => owner.admin.from('playlist_tracks').select('playlist_id, track_id, position').in('playlist_id', ids),
        playlistIds,
      ),
      // Only genre + mood: those are the two categories the gradient reads,
      // and pulling instrument/status as well would triple the rows for
      // nothing visible.
      selectIn<any>(
        (ids) => owner.admin.from('track_tags').select('track_id, tag, category').in('track_id', ids),
        trackIds,
      ),
    ]);

    const projectById = new Map(projects.map((project: any) => [project.id, project]));
    const playlistById = new Map(playlists.map((playlist: any) => [playlist.id, playlist]));
    const trackById = new Map(tracks.map((track: any) => [track.id, track]));
    const projectTrackIds = new Map<string, string[]>();
    const playlistTrackIds = new Map<string, string[]>();

    for (const row of projectTrackRows.slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))) {
      projectTrackIds.set(row.project_id, [...(projectTrackIds.get(row.project_id) ?? []), row.track_id]);
    }
    for (const row of playlistTrackRows.slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))) {
      playlistTrackIds.set(row.playlist_id, [...(playlistTrackIds.get(row.playlist_id) ?? []), row.track_id]);
    }

    const tagsByTrack = new Map<string, string[]>();
    for (const row of tagRows as any[]) {
      if (row.category !== 'genre' && row.category !== 'mood') continue;
      const existing = tagsByTrack.get(row.track_id) ?? [];
      // Genre first — the gradient leads on the first entry.
      if (row.category === 'genre') existing.unshift(row.tag);
      else existing.push(row.tag);
      tagsByTrack.set(row.track_id, existing);
    }

    const summarizeTracks = (ids: string[]): TrackSummary[] =>
      ids.flatMap((id) => {
        const track: any = trackById.get(id);
        return track
          ? [{ id: track.id, title: track.title, type: track.type, cover_url: track.cover_url ?? null }]
          : [];
      });

    const legacyLinks: ShareListItem[] = (legacyRes.data ?? []).map((share: any) => {
      const ids = Array.isArray(share.track_ids) ? share.track_ids : [];
      const tracks = summarizeTracks(ids);
      const lead = tracks[0];
      return {
        id: share.id,
        source: 'share_links',
        token: share.token,
        title: share.title ?? null,
        content_title: null,
        kind: share.kind ?? (ids.length > 1 ? 'project' : 'track'),
        track_ids: ids,
        tracks,
        plays: share.plays ?? 0,
        expires_at: share.expires_at ?? null,
        revoked_at: share.revoked_at ?? null,
        allow_downloads: share.allow_downloads !== false,
        password_protected: Boolean(share.password_hash),
        created_at: share.created_at,
        href: `/share/${share.token}`,
        cover_url: lead?.cover_url ?? null,
        artwork_kind: artworkKindFor(share.kind ?? '', ids.length),
        artwork_seed: ids.length === 1 && lead ? lead.id : share.token,
        artwork_tags: lead ? tagsByTrack.get(lead.id) ?? [] : [],
      };
    });

    // Deduped by id: a share can be reached through more than one filter.
    const modernById = new Map<string, any>();
    for (const share of shareRows as any[]) modernById.set(share.id, share);

    const modernLinks: ShareListItem[] = Array.from(modernById.values()).map((share: any) => {
      const contentType = share.content_type ?? 'project';
      const parent: any =
        contentType === 'playlist'
          ? playlistById.get(share.playlist_id)
          : contentType === 'track'
            ? trackById.get(share.track_id)
            : projectById.get(share.project_id);
      const ids =
        contentType === 'playlist'
          ? playlistTrackIds.get(share.playlist_id) ?? []
          : contentType === 'track'
            ? [share.track_id].filter(Boolean)
            : projectTrackIds.get(share.project_id) ?? [];

      const tracks = summarizeTracks(ids);
      const lead = tracks[0];
      return {
        id: share.id,
        source: 'project_shares',
        token: share.token,
        title: share.label ?? parent?.name ?? parent?.title ?? null,
        content_title: parent?.name ?? parent?.title ?? null,
        kind: contentType,
        track_ids: ids,
        tracks,
        plays: share.plays ?? 0,
        expires_at: share.expires_at ?? null,
        revoked_at: share.revoked_at ?? null,
        allow_downloads: share.allow_downloads !== false,
        password_protected: Boolean(share.password_hash),
        created_at: share.created_at,
        href: `/projects/share/${share.token}`,
        // The collection's own cover wins; a coverless project borrows its
        // first track's art before falling back to brand artwork, so a link
        // list still shows what the pack sounds like.
        cover_url: parent?.cover_url ?? lead?.cover_url ?? null,
        artwork_kind: artworkKindFor(contentType, ids.length),
        artwork_seed: parent?.id ?? share.token,
        artwork_tags: lead ? tagsByTrack.get(lead.id) ?? [] : [],
      };
    });

    const links = [...legacyLinks, ...modernLinks].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return NextResponse.json({ links });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
