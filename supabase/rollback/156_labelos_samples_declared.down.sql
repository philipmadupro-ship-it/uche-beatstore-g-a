-- Rollback for 156_labelos_samples_declared.sql (LABEL-29).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only, before the rollback of
-- anything that reads these columns.
--
-- Drops the three columns and everything attached to them. Every declaration
-- and clearance note is lost (export them first); a clearance FILE stays in
-- `project_assets`, only the link goes. The `song.samples_declared` events
-- stay: the log is append-only.

DROP TRIGGER IF EXISTS tracks_samples_asset_integrity ON public.tracks;
DROP FUNCTION IF EXISTS public.tracks_samples_asset_integrity();
DROP INDEX IF EXISTS public.idx_tracks_samples_asset;

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_samples_org_only;
ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_samples_note_length;
ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_samples_declared_check;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS samples_clearance_asset_id;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS samples_clearance_note;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS samples_declared;

NOTIFY pgrst, 'reload schema';
