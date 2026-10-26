-- 165_labelos_playlist_tracks_same_owner.sql
-- Label OS (LABEL-44, review G3): `playlist_tracks` gets the same-owner
-- trigger every other junction has (122/123/133, 142's project_tracks).
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 136–164. Never part of supabase/apply/pending.sql.
--
-- Why: a playlist is the producer's (owned by playlists.user_id; no org_id),
-- and the public store reads a featured playlist's tracks by id. G3 found
-- that POST /api/playlists/[id]/tracks accepted any track id, so an org song
-- (ownerless since 142) could be put in a producer playlist and read back
-- through the store. #117 fixed the route (the caller's own tracks only);
-- this makes it a database fact for every writer — the upload attach paths,
-- a future route, a script with the service key.
--
-- The rule: the track and the playlist have the same (non-null) owner, and
-- the track is not an organization's. 002 dropped NOT NULL from
-- playlists.user_id; an ownerless playlist (none since 053's reconcile)
-- takes no track, since NULL never equals an owner. Playlists have no
-- organization, so the org case of 142 does not exist here: an org track
-- never joins a playlist, and no two producers' rows ever meet. That is
-- exactly what the route already allows (`tracks.user_id = caller`), so the
-- producer's own playlists behave as before.
--
-- Fires on INSERT and on an UPDATE that changes which playlist or track a
-- row joins; a reorder (`position`) does not fire it. Existing rows are not
-- re-checked (a trigger cannot), so a cross-owner row written before this
-- migration stays until removed; supabase/local/checks/165_* shows the query
-- that lists them.
--
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS first.

CREATE OR REPLACE FUNCTION public.playlist_tracks_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.playlists p
    JOIN public.tracks t ON t.id = NEW.track_id AND t.user_id = p.user_id AND t.org_id IS NULL
    WHERE p.id = NEW.playlist_id
  ) THEN
    RAISE EXCEPTION 'playlist_tracks: track % and playlist % must have the same owner', NEW.track_id, NEW.playlist_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION public.playlist_tracks_same_owner() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.playlist_tracks_same_owner() FROM PUBLIC;

DROP TRIGGER IF EXISTS playlist_tracks_same_owner ON public.playlist_tracks;
CREATE TRIGGER playlist_tracks_same_owner
  BEFORE INSERT OR UPDATE OF playlist_id, track_id ON public.playlist_tracks
  FOR EACH ROW EXECUTE FUNCTION public.playlist_tracks_same_owner();

NOTIFY pgrst, 'reload schema';
