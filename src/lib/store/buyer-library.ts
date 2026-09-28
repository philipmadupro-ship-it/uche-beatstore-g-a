export interface BuyerLibraryTrackSummary {
  id: string;
  title: string | null;
  cover_url: string | null;
  type: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  duration_seconds: number | null;
}

export interface BuyerLibraryHistoryRow {
  track_id: string;
  played_at: string;
  track: BuyerLibraryTrackSummary | null;
}

export interface BuyerLibraryFavoriteRow {
  track_id: string;
  created_at: string;
  track: BuyerLibraryTrackSummary | null;
}

export interface BuyerLibraryPlaylist {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  track_ids: string[];
  tracks: BuyerLibraryTrackSummary[];
}

export interface BuyerLibraryShape {
  email: string;
  history: BuyerLibraryHistoryRow[];
  favorites: BuyerLibraryFavoriteRow[];
  playlists: BuyerLibraryPlaylist[];
}

export interface BuyerLibraryTrackJoinRow {
  playlist_id: string;
  track_id: string;
  position?: number | null;
}

export function buildBuyerLibraryShape(input: {
  email: string;
  history: Array<{ track_id: string; played_at: string }>;
  favorites: Array<{ track_id: string; created_at: string }>;
  playlists: Array<{ id: string; name: string; created_at: string; updated_at: string }>;
  playlistTracks: BuyerLibraryTrackJoinRow[];
  tracks: BuyerLibraryTrackSummary[];
}): BuyerLibraryShape {
  const trackMap = new Map(input.tracks.map((track) => [track.id, track]));
  const playlistTrackMap = new Map<string, BuyerLibraryTrackJoinRow[]>();

  for (const row of input.playlistTracks) {
    const rows = playlistTrackMap.get(row.playlist_id) ?? [];
    rows.push(row);
    playlistTrackMap.set(row.playlist_id, rows);
  }

  return {
    email: input.email,
    history: input.history.map((row) => ({
      ...row,
      track: trackMap.get(row.track_id) ?? null,
    })),
    favorites: input.favorites.map((row) => ({
      ...row,
      track: trackMap.get(row.track_id) ?? null,
    })),
    playlists: input.playlists.map((playlist) => {
      const rows = playlistTrackMap.get(playlist.id) ?? [];
      return {
        ...playlist,
        track_ids: rows.map((row) => row.track_id),
        tracks: rows
          .map((row) => trackMap.get(row.track_id) ?? null)
          .filter((track): track is BuyerLibraryTrackSummary => Boolean(track)),
      };
    }),
  };
}

export function collectBuyerLibraryTrackIds(input: {
  history: Array<{ track_id: string }>;
  favorites: Array<{ track_id: string }>;
  playlistTracks: Array<{ track_id: string }>;
}): string[] {
  return [
    ...new Set([
      ...input.history.map((row) => row.track_id),
      ...input.favorites.map((row) => row.track_id),
      ...input.playlistTracks.map((row) => row.track_id),
    ].filter(Boolean)),
  ];
}

/**
 * Which tracks' metadata a buyer's library may show.
 *
 * GET joins every track id in the buyer's rows against `tracks`. Rows written
 * before `/api/store/me` checked `store_listed` can name any track, so the
 * join is filtered too: a beat shows if the storefront lists it, or if this
 * buyer paid for it (an exclusive delists the beat, and the buyer who bought
 * it should not see it turn into "Beat unavailable" in their own library).
 * Everything else renders as unavailable — the row survives, the metadata
 * does not.
 */
export function visibleBuyerLibraryTracks(
  tracks: Array<BuyerLibraryTrackSummary & { store_listed?: boolean | null }>,
  purchasedTrackIds: ReadonlySet<string>,
): BuyerLibraryTrackSummary[] {
  return tracks
    .filter((t) => t.store_listed === true || purchasedTrackIds.has(t.id))
    .map((t) => ({
      id: t.id,
      title: t.title,
      cover_url: t.cover_url,
      type: t.type,
      bpm: t.bpm,
      key: t.key,
      scale: t.scale,
      duration_seconds: t.duration_seconds,
    }));
}

/** Track ids across a buyer's `license_purchases.track_ids` arrays. */
export function purchasedTrackIdSet(rows: Array<{ track_ids?: unknown }>): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row.track_ids)) continue;
    for (const id of row.track_ids) if (typeof id === 'string') ids.add(id);
  }
  return ids;
}

export interface BuyerPlaylistMembership {
  id: string;
  name: string;
  /** True when the track is already in this playlist — selecting removes it. */
  contains: boolean;
  count: number;
}

/**
 * The rows of the storefront's "Add to playlist" menu: every playlist the
 * buyer owns, most recently updated first (the order GET returns), marked
 * with whether this track is already in it.
 */
export function buyerPlaylistMembership(
  playlists: Array<Pick<BuyerLibraryPlaylist, 'id' | 'name' | 'track_ids'>>,
  trackId: string,
): BuyerPlaylistMembership[] {
  return playlists.map((p) => ({
    id: p.id,
    name: p.name,
    contains: p.track_ids.includes(trackId),
    count: p.track_ids.length,
  }));
}

/**
 * Name for a playlist created from a beat's menu. The storefront has no
 * text field to ask for one, so it is named after the beat, trimmed to the
 * 80-character limit `buyer_playlists.name` enforces.
 */
export function playlistNameFromTrack(title: string | null | undefined): string {
  const base = title?.trim() || 'My playlist';
  return base.slice(0, 80);
}
