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
