-- 080_track_stem_files.sql
-- Flexible, repeatable stem files (Lyrics Studio stems redesign).
--
-- The legacy stems table has four fixed columns (vocals/drums/bass/other),
-- which can't hold the many stems a real session exports (lead, harmony, fx,
-- 808, perc, adlibs, …). This table allows an arbitrary number of labeled
-- stem files per track, with an optional free-text label and a category for
-- grouping ('vocals'|'drums'|'bass'|'melody'|'fx'|'other'). The legacy
-- four-column flow stays intact for producer-share downloads; this is additive.

CREATE TABLE IF NOT EXISTS public.track_stem_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id    uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label       text NOT NULL DEFAULT 'Stem',
  category    text NOT NULL DEFAULT 'other',
  url         text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_track_stem_files_track ON public.track_stem_files (track_id, position);

ALTER TABLE public.track_stem_files ENABLE ROW LEVEL SECURITY;

-- Owner-only: the producer manages their own stem files. Service-role
-- bypasses RLS for the upload route (which verifies ownership first).
DROP POLICY IF EXISTS track_stem_files_owner ON public.track_stem_files;
CREATE POLICY track_stem_files_owner ON public.track_stem_files
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
