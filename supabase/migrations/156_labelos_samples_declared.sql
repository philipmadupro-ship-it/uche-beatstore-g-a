-- 156_labelos_samples_declared.sql (LABEL-29)
-- Where a song says whether it uses samples, and how they were cleared
-- (05 §3 `samples_declared`; 09 §3.1 L8). Three columns on `tracks`, no new
-- table, no policy change: org songs are written by the service role only
-- (141's labelos_org_rows_service_only is on tracks), and members read the
-- row through the policies 141 already put there.
--
--   samples_declared            'none' | 'yes' | 'unknown'. NOT NULL, default
--                               'unknown', so every existing row (producer
--                               songs included) reads as "not declared" and
--                               nothing in the producer app changes.
--   samples_clearance_note      free text, at most 2000 characters.
--   samples_clearance_asset_id  an optional clearance document: a RESTRICTED
--                               `project_assets` file (143) of the song's own
--                               org. ON DELETE SET NULL, so removing the file
--                               un-clears the song rather than blocking the
--                               delete.
--
-- Producer rows can carry none of it (CHECK tracks_samples_org_only): the
-- declaration is a Label OS fact. A trigger holds the asset to the song's org
-- and to sensitivity 'restricted' (a clearance is a contract, D4); the route
-- additionally requires the file's project to hold the song.
--
-- Idempotent: IF NOT EXISTS, CHECKs dropped and re-added, CREATE OR REPLACE.
-- No DO blocks (pastes into the Supabase SQL editor). Proven in
-- supabase/local/checks/156_labelos_samples_declared.sql.

ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS samples_declared text NOT NULL DEFAULT 'unknown';
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS samples_clearance_note text;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS samples_clearance_asset_id uuid REFERENCES public.project_assets(id) ON DELETE SET NULL;

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_samples_declared_check;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_samples_declared_check
  CHECK (samples_declared IN ('none', 'yes', 'unknown'));

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_samples_note_length;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_samples_note_length
  CHECK (samples_clearance_note IS NULL OR char_length(samples_clearance_note) <= 2000);

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_samples_org_only;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_samples_org_only
  CHECK (org_id IS NOT NULL OR (samples_declared = 'unknown' AND samples_clearance_note IS NULL AND samples_clearance_asset_id IS NULL));

CREATE INDEX IF NOT EXISTS idx_tracks_samples_asset
  ON public.tracks (samples_clearance_asset_id)
  WHERE samples_clearance_asset_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tracks_samples_asset_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid;
  v_sens text;
BEGIN
  IF NEW.samples_clearance_asset_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT a.org_id, a.sensitivity INTO v_org, v_sens FROM public.project_assets a WHERE a.id = NEW.samples_clearance_asset_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tracks: clearance file % does not exist', NEW.samples_clearance_asset_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'tracks: the clearance file must belong to the song''s organization'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_sens IS DISTINCT FROM 'restricted' THEN
    RAISE EXCEPTION 'tracks: a clearance file must be restricted'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION public.tracks_samples_asset_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tracks_samples_asset_integrity() FROM PUBLIC;

DROP TRIGGER IF EXISTS tracks_samples_asset_integrity ON public.tracks;
CREATE TRIGGER tracks_samples_asset_integrity
  BEFORE INSERT OR UPDATE OF samples_clearance_asset_id, org_id ON public.tracks
  FOR EACH ROW EXECUTE FUNCTION public.tracks_samples_asset_integrity();

NOTIFY pgrst, 'reload schema';
