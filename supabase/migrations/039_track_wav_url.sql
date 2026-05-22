-- 039_track_wav_url.sql
-- Adds a separate WAV upload slot on tracks.
-- When a producer uploads a WAV version of a beat, the path is stored here.
-- Delivery routes check wav_url first (if license.file_types includes 'WAV'),
-- then fall back to audio_url.

ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS wav_url text DEFAULT NULL;

NOTIFY pgrst, 'reload schema';
