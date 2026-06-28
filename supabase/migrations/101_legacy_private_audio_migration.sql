ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS legacy_audio_url text,
  ADD COLUMN IF NOT EXISTS private_audio_migrated_at timestamptz;

COMMENT ON COLUMN public.tracks.legacy_audio_url IS
  'Previous public source URL retained after migrating audio_url to private R2.';

COMMENT ON COLUMN public.tracks.private_audio_migrated_at IS
  'Timestamp when a legacy public master was copied into private R2.';

NOTIFY pgrst, 'reload schema';
