-- Renumbered from 106: another branch landed its own 106 concurrently
-- (106_license_purchases_refund_review). Two files sharing a number makes a
-- clean replay order filesystem-dependent, which is the one thing an
-- append-only migration set must not be. Content is unchanged and both
-- statements are idempotent, so an environment that already ran this as 106
-- re-runs it here as a no-op.

-- Default artwork + brand palette
--
-- Two related problems. First, most beats are uploaded without a cover, and
-- the store's own diagnostics say a missing cover is the second-largest reason
-- a listed beat does not sell — "the first thing a buyer sees is empty."
-- Producers do have brand art; they just do not attach it to every upload.
--
-- So: one image, set once, used whenever new content is created without its
-- own artwork. Per-item covers still win; this is a fallback, not a policy.
--
-- Second, a single repeated logo across forty cards is its own kind of empty.
-- Storing the image's dominant colours lets each cover render a gradient
-- derived from the producer's brand but varied per track. The palette is
-- cached here rather than recomputed because extraction needs a canvas — it
-- can only run in the browser, and the storefront renders on the server.

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS default_artwork_url TEXT;

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS default_artwork_palette JSONB;

COMMENT ON COLUMN creator_profiles.default_artwork_url IS
  'Producer logo / brand image used as the fallback cover for content created without one. Null = fall back to a generated gradient only.';

COMMENT ON COLUMN creator_profiles.default_artwork_palette IS
  'Dominant colours extracted from default_artwork_url, as a JSON array of {hex,weight}, most dominant first. Cached because extraction is canvas-only (browser-side) and the storefront renders server-side. Null = use the theme accent.';

NOTIFY pgrst, 'reload schema';
