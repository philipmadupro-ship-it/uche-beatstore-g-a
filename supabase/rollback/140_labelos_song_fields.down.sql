-- Rollback for 140_labelos_song_fields.sql (LABEL-11).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- The relation CHECK goes back to 133's four values ONLY if no master / demo
-- link exists: those rows are Label OS material, and silently deleting them
-- would lose which file is a song's master. If any exist this stops with a
-- clear error and changes nothing (single transaction); decide what to do
-- with them first.
-- song_stage and iswc are dropped outright: nothing outside Label OS reads
-- or writes them.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.track_links WHERE relation IN ('master', 'demo')) THEN
    RAISE EXCEPTION '140 rollback: % master/demo track_links rows exist; resolve them before restoring the 133 relation check',
      (SELECT count(*) FROM public.track_links WHERE relation IN ('master', 'demo'));
  END IF;
END $$;

ALTER TABLE public.track_links DROP CONSTRAINT IF EXISTS track_links_relation_check;
ALTER TABLE public.track_links ADD CONSTRAINT track_links_relation_check
  CHECK (relation IN ('instrumental', 'loop', 'topline', 'version'));

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_iswc_format;
ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_song_stage_check;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS iswc;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS song_stage;

NOTIFY pgrst, 'reload schema';
