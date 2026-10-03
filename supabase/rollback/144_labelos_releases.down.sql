-- Rollback for 144_labelos_releases.sql (LABEL-16).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Order matters:
--   1. labelos_track_is_finished goes back to 141's rule FIRST — the 144
--      version reads release_items, so it must not outlive the table;
--   2. the guards on project_assets, tracks and track_links go (they read
--      releases / release_items);
--   3. the two functions, then the tables (release_items before releases),
--      which takes their policies, triggers and constraints with them. Every
--      release and tracklist is lost; the release projects and their files
--      stay (they are ordinary org projects).

CREATE OR REPLACE FUNCTION public.labelos_track_is_finished(p_track uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
      SELECT 1 FROM public.track_links l
      WHERE l.to_track_id = p_track AND l.relation NOT IN ('master', 'instrumental')
    )
    AND NOT EXISTS (SELECT 1 FROM public.song_beats sb WHERE sb.beat_track_id = p_track)
    AND (
      EXISTS (
        SELECT 1
        FROM public.track_links l
        JOIN public.tracks s ON s.id = l.from_track_id AND s.type = 'song'
        JOIN public.tracks t ON t.id = l.to_track_id AND t.org_id = s.org_id
        WHERE l.to_track_id = p_track AND l.relation IN ('master', 'instrumental')
      )
      OR EXISTS (
        SELECT 1 FROM public.tracks t
        WHERE t.id = p_track AND t.type = 'song' AND t.song_stage = 'selected'
      )
    );
$$;

DROP TRIGGER IF EXISTS project_assets_release_artwork ON public.project_assets;
DROP TRIGGER IF EXISTS tracks_release_song_type ON public.tracks;
DROP TRIGGER IF EXISTS track_links_release_master ON public.track_links;
DROP FUNCTION IF EXISTS public.project_assets_release_artwork();
DROP FUNCTION IF EXISTS public.tracks_release_song_type();
DROP FUNCTION IF EXISTS public.track_links_release_master();

DROP FUNCTION IF EXISTS public.labelos_release_items_reorder(uuid, uuid, uuid[]);
DROP FUNCTION IF EXISTS public.labelos_release_item_remove(uuid, uuid, uuid);

DROP TABLE IF EXISTS public.release_items;
DROP TABLE IF EXISTS public.releases;

DROP FUNCTION IF EXISTS public.release_items_contiguous();
DROP FUNCTION IF EXISTS public.release_items_integrity();
DROP FUNCTION IF EXISTS public.releases_integrity();

NOTIFY pgrst, 'reload schema';
