-- 036_store_theme_text_color.sql
-- Add primary text colour override for the public store.
-- Complement to 034 (accent_color, font_style) — lets the creator
-- pick their preferred body-text colour in the Store Editor.

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS text_color_primary text DEFAULT NULL;

NOTIFY pgrst, 'reload schema';
