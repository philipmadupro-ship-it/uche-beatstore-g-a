-- ── 034_creator_storefront_theme.sql ─────────────────────────────────────────
-- Adds storefront theming fields to creator_profiles so creators can
-- customise the accent color and font style of their public store without
-- touching code.
--
-- accent_color  text  default '#D4BFA0'
--   A valid CSS hex color string. The store pages apply this via a CSS
--   custom property (--store-accent) on the layout wrapper.
--
-- font_style  text  default 'default'
--   One of: 'default' | 'modern' | 'minimal'
--   'default'  — Akira Expanded (current)
--   'modern'   — Inter / system sans-serif
--   'minimal'  — Mono-only (Space Mono fallback)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS accent_color  text NOT NULL DEFAULT '#D4BFA0',
  ADD COLUMN IF NOT EXISTS font_style    text NOT NULL DEFAULT 'default';

NOTIFY pgrst, 'reload schema';
