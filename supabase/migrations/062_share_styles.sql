-- 062_share_styles.sql
--
-- Per-producer template choice for the IG share card and the 9:16
-- vertical preview. Producers wanted the share output to feel
-- "new-gen" — designed, not the default OG-card boilerplate. Each
-- value matches a layout in the renderer (lib/share/styles.ts).
--
-- Both fields are nullable; NULL falls back to the system default.
-- Idempotent.

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS share_card_style text,
  ADD COLUMN IF NOT EXISTS share_video_style text;

NOTIFY pgrst, 'reload schema';
