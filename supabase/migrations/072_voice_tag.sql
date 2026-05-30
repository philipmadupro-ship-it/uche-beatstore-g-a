-- 072_voice_tag.sql
-- Producer voice/producer-tag for store previews. The producer uploads ONE
-- reusable tag (their "drop") and chooses, per beat, whether it overlays on
-- the public preview. The purchased download is always clean — the overlay is
-- client-side, preview-only (anti-rip). Idempotent.

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS voice_tag_url text,
  ADD COLUMN IF NOT EXISTS voice_tag_interval_seconds integer NOT NULL DEFAULT 20;

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS voice_tag_enabled boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
