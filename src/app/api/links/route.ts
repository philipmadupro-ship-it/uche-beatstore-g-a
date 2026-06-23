/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { isSupabaseConfigured, getAll, requireUser } from '@/lib/db';
import { errorMessage } from '@/lib/errors';

type TrackSummary = {
  id: string;
  title: string;
  type: string;
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
};

function localLinks(): ShareListItem[] {
  const tracks = getAll('tracks') as any[];
  const projects = getAll('projects') as any[];
  const playlists = getAll('playlists') as any[];
  const projectTracks = getAll('project_tracks') as any[];
  const playlistTracks = getAll('playlist_tracks') as any[];
  const trackById = new Map(tracks.map((track) => [track.id, track]));

  const summarizeTracks = (ids: string[]) =>
    ids.flatMap((id) => {
      const track = trackById.get(id);
      return track ? [{ id: track.id, title: track.title, type: track.type }] : [];
    });

  const legacy = (getAll('share_links') as any[]).map((share): ShareListItem => {
    const trackIds = Array.isArray(share.track_ids) ? share.track_ids : [];
    return {
      id: share.id,
      source: 'share_links',
      token: share.token,
      title: share.title ?? null,
      content_title: null,
      kind: share.kind ?? (trackIds.length > 1 ? 'project' : 'track'),
      track_ids: trackIds,
      tracks: summarizeTracks(trackIds),
      plays: share.plays ?? 0,
      expires_at: share.expires_at ?? null,
      revoked_at: share.revoked_at ?? null,
      allow_downloads: share.allow_downloads !== false,
      password_protected: Boolean(share.password_hash),
      created_at: share.created_at,
      href: `/share/${share.token}`,
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

    return {
      id: share.id,
      source: 'project_shares',
      token: share.token,
      title: share.label ?? parent?.name ?? parent?.title ?? null,
      content_title: parent?.name ?? parent?.title ?? null,
      kind: contentType,
      track_ids: trackIds,
      tracks: summarizeTracks(trackIds),
      plays: share.plays ?? 0,
      expires_at: share.expires_at ?? null,
      revoked_at: share.revoked_at ?? null,
      allow_downloads: share.allow_downloads !== false,
      password_protected: Boolean(share.password_hash),
      created_at: share.created_at,
      href: `/projects/share/${share.token}`,
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
      owner.admin.from('projects').select('id, name').eq('user_id', owner.userId),
      owner.admin.from('playlists').select('id, name').eq('user_id', owner.userId),
      owner.admin.from('tracks').select('id, title, type').eq('user_id', owner.userId),
    ]);

    const firstError = legacyRes.error || projectsRes.error || playlistsRes.error || tracksRes.error;
    if (firstError) throw firstError;

    const projects = projectsRes.data ?? [];
    const playlists = playlistsRes.data ?? [];
    const tracks = tracksRes.data ?? [];
    const projectIds = projects.map((project: any) => project.id);
    const playlistIds = playlists.map((playlist: any) => playlist.id);
    const trackIds = tracks.map((track: any) => track.id);

    const shareQueries: PromiseLike<any>[] = [];
    if (projectIds.length > 0) {
      shareQueries.push(
        owner.admin
          .from('project_shares')
          .select('id, token, content_type, project_id, playlist_id, track_id, label, plays, expires_at, revoked_at, allow_downloads, password_hash, created_at')
          .in('project_id', projectIds),
      );
    }
    if (playlistIds.length > 0) {
      shareQueries.push(
        owner.admin
          .from('project_shares')
          .select('id, token, content_type, project_id, playlist_id, track_id, label, plays, expires_at, revoked_at, allow_downloads, password_hash, created_at')
          .in('playlist_id', playlistIds),
      );
    }
    if (trackIds.length > 0) {
      shareQueries.push(
        owner.admin
          .from('project_shares')
          .select('id, token, content_type, project_id, playlist_id, track_id, label, plays, expires_at, revoked_at, allow_downloads, password_hash, created_at')
          .in('track_id', trackIds),
      );
    }

    const [shareResults, projectTracksRes, playlistTracksRes] = await Promise.all([
      Promise.all(shareQueries),
      projectIds.length > 0
        ? owner.admin.from('project_tracks').select('project_id, track_id, position').in('project_id', projectIds)
        : Promise.resolve({ data: [], error: null }),
      playlistIds.length > 0
        ? owner.admin.from('playlist_tracks').select('playlist_id, track_id, position').in('playlist_id', playlistIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const relatedError =
      shareResults.find((result) => result.error)?.error ||
      projectTracksRes.error ||
      playlistTracksRes.error;
    if (relatedError) throw relatedError;

    const projectById = new Map(projects.map((project: any) => [project.id, project]));
    const playlistById = new Map(playlists.map((playlist: any) => [playlist.id, playlist]));
    const trackById = new Map(tracks.map((track: any) => [track.id, track]));
    const projectTrackIds = new Map<string, string[]>();
    const playlistTrackIds = new Map<string, string[]>();

    for (const row of (projectTracksRes.data ?? []).sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))) {
      projectTrackIds.set(row.project_id, [...(projectTrackIds.get(row.project_id) ?? []), row.track_id]);
    }
    for (const row of (playlistTracksRes.data ?? []).sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))) {
      playlistTrackIds.set(row.playlist_id, [...(playlistTrackIds.get(row.playlist_id) ?? []), row.track_id]);
    }

    const summarizeTracks = (ids: string[]): TrackSummary[] =>
      ids.flatMap((id) => {
        const track: any = trackById.get(id);
        return track ? [{ id: track.id, title: track.title, type: track.type }] : [];
      });

    const legacyLinks: ShareListItem[] = (legacyRes.data ?? []).map((share: any) => {
      const ids = Array.isArray(share.track_ids) ? share.track_ids : [];
      return {
        id: share.id,
        source: 'share_links',
        token: share.token,
        title: share.title ?? null,
        content_title: null,
        kind: share.kind ?? (ids.length > 1 ? 'project' : 'track'),
        track_ids: ids,
        tracks: summarizeTracks(ids),
        plays: share.plays ?? 0,
        expires_at: share.expires_at ?? null,
        revoked_at: share.revoked_at ?? null,
        allow_downloads: share.allow_downloads !== false,
        password_protected: Boolean(share.password_hash),
        created_at: share.created_at,
        href: `/share/${share.token}`,
      };
    });

    const modernById = new Map<string, any>();
    for (const result of shareResults) {
      for (const share of result.data ?? []) modernById.set(share.id, share);
    }

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

      return {
        id: share.id,
        source: 'project_shares',
        token: share.token,
        title: share.label ?? parent?.name ?? parent?.title ?? null,
        content_title: parent?.name ?? parent?.title ?? null,
        kind: contentType,
        track_ids: ids,
        tracks: summarizeTracks(ids),
        plays: share.plays ?? 0,
        expires_at: share.expires_at ?? null,
        revoked_at: share.revoked_at ?? null,
        allow_downloads: share.allow_downloads !== false,
        password_protected: Boolean(share.password_hash),
        created_at: share.created_at,
        href: `/projects/share/${share.token}`,
      };
    });

    const links = [...legacyLinks, ...modernLinks].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return NextResponse.json({ links });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
