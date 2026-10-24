-- Rollback for 173_labelos_track_metadata.sql (LABEL-53).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the constraints and the eight columns. The values typed into them
-- (version, language, genre, P-line, master owner, ...) are LOST; isrc and
-- iswc (141, 140) are untouched.

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_org_metadata_only;
ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_metadata_format;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS metadata_updated_at;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS master_owner;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS p_line;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS recorded_on;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS genre;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS explicit;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS language;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS version_label;

NOTIFY pgrst, 'reload schema';
