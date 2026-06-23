-- Public playback uses a derivative while audio_url points at the private
-- full-resolution source. Existing rows remain compatible until backfilled.
ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS preview_url text;

ALTER TABLE public.track_versions
  ADD COLUMN IF NOT EXISTS preview_url text;

COMMENT ON COLUMN public.tracks.preview_url IS
  'Public low-bitrate listening derivative. Never use for licensed delivery.';

NOTIFY pgrst, 'reload schema';
