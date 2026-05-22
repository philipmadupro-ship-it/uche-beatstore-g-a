-- supabase/migrations/030_track_store_listed.sql
-- Add store_listed column to the tracks table to specify if it is visible on the public beat store.
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS store_listed boolean NOT NULL DEFAULT false;
NOTIFY pgrst, 'reload schema';
