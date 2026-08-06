-- Brand logo + per-kind default artwork
--
-- Two related pieces of producer branding.
--
-- LOGO. The dashboard's top-left mark is hard-coded "U2C". For the one
-- producer this app currently serves that is merely wrong-ish; for anyone
-- else it is someone else's brand on their own workspace. A stored logo
-- replaces it.
--
-- Kept separate from default_artwork_url even though both are images: a logo
-- is a mark meant to be read at 24px against chrome, while default artwork is
-- a full-bleed image meant to be tinted and cropped square. Sharing one column
-- would force one of the two to be the wrong shape.
--
-- PER-KIND ARTWORK. One default image made every coverless beat, project and
-- playlist share a base picture, so a mixed grid differed only by hue. Three
-- images — one per kind — let a producer give projects a different look from
-- singles, which is how they already think about their catalogue.
--
-- Each kind carries its own palette because the palette is extracted FROM the
-- image: a project photo with different colours should tint its gradients with
-- those colours, not with the track image's. Tracks keep the existing
-- default_artwork_url/palette pair so nothing has to be migrated or re-uploaded.

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS default_artwork_project_url TEXT;

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS default_artwork_project_palette JSONB;

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS default_artwork_playlist_url TEXT;

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS default_artwork_playlist_palette JSONB;

COMMENT ON COLUMN creator_profiles.logo_url IS
  'Producer logo shown as the dashboard brand mark. Cropped and stored square; rendered contained so a wide mark is not cut off. Null = the built-in wordmark.';

COMMENT ON COLUMN creator_profiles.default_artwork_project_url IS
  'Fallback cover image for projects without artwork. Null = fall back to the track default, then to a gradient alone.';

COMMENT ON COLUMN creator_profiles.default_artwork_project_palette IS
  'Dominant colours of default_artwork_project_url, as [{hex,weight}]. Extraction is canvas-only so it is cached here for server rendering.';

COMMENT ON COLUMN creator_profiles.default_artwork_playlist_url IS
  'Fallback cover image for playlists without artwork. Null = fall back to the track default, then to a gradient alone.';

COMMENT ON COLUMN creator_profiles.default_artwork_playlist_palette IS
  'Dominant colours of default_artwork_playlist_url, as [{hex,weight}].';

NOTIFY pgrst, 'reload schema';
