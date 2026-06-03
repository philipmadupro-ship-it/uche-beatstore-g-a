-- 093_creator_dither_style.sql
-- Per-producer audio-reactive dither style preference.
-- The producer chooses their visual aesthetic once in the store editor;
-- buyers see that style rendered on cover art with full audio reactivity.
-- Keeping the style off the store UI (no viewer-facing selector) makes it
-- part of the producer's brand identity rather than a viewer toggle.

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS dither_mode        text NOT NULL DEFAULT 'bayer',
  ADD COLUMN IF NOT EXISTS dither_color_mode  text NOT NULL DEFAULT 'original',
  ADD COLUMN IF NOT EXISTS dither_texture     text NOT NULL DEFAULT 'paper';

NOTIFY pgrst, 'reload schema';
