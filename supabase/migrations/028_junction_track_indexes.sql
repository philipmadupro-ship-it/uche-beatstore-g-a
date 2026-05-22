-- Junction tables (project_tracks, playlist_tracks) use composite primary
-- keys leading with the parent id (project_id / playlist_id). That covers
-- "which tracks are in this project" but NOT the reverse direction —
-- "which projects/playlists contain this track" — which scans the table.
--
-- The reverse lookup is hit by:
--   • the library page's TrackDetailsDrawer ("Used in N projects")
--   • the delete-track confirmation ("Remove from 3 playlists first")
--   • offline cache reconciliation
--
-- Two single-column track_id indexes fix it. Tiny disk footprint, big
-- payoff once the library passes a couple hundred tracks.

CREATE INDEX IF NOT EXISTS project_tracks_track_id_idx
  ON public.project_tracks (track_id);

CREATE INDEX IF NOT EXISTS playlist_tracks_track_id_idx
  ON public.playlist_tracks (track_id);

NOTIFY pgrst, 'reload schema';
