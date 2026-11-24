-- Rollback for 205_stem_pipeline.sql (AUDIO-05). Run by hand only.
-- The stem pipeline then falls back to its reduced mode (status-only claim,
-- created_at as the lock age, no stored error); no stem row or file is lost.

DROP INDEX IF EXISTS public.idx_stems_work;
ALTER TABLE public.stems DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.stems DROP COLUMN IF EXISTS locked_at;
ALTER TABLE public.stems DROP COLUMN IF EXISTS last_error;
ALTER TABLE public.stems DROP COLUMN IF EXISTS attempts;

NOTIFY pgrst, 'reload schema';
