-- Rollback for 165_labelos_playlist_tracks_same_owner.sql (LABEL-44).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Removes the same-owner trigger: playlist_tracks accepts any track id again
-- from any writer with the service key. POST /api/playlists/[id]/tracks keeps
-- filtering to the caller's own tracks (#117) either way.

DROP TRIGGER IF EXISTS playlist_tracks_same_owner ON public.playlist_tracks;
DROP FUNCTION IF EXISTS public.playlist_tracks_same_owner();

NOTIFY pgrst, 'reload schema';
