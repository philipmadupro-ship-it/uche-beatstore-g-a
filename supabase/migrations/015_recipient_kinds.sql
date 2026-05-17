-- 015_recipient_kinds.sql
--
-- Each share link now carries a `recipient_kind` so the share page can
-- render a layout tailored to who's looking at it:
--
--   client   — A&R / label / commercial intent. Bio + curated tracks +
--              license card. Focus on commercial appeal.
--   producer — Engineer / mix collaborator. Full metadata + per-stem
--              download. Focus on technical detail.
--   rapper   — Topliner / featured artist. Vocal-friendly preview +
--              reply tools. Focus on lyrical fit.
--   friend   — Casual share. Minimal chrome, just play.
--
-- Default is `client` because the historical share UI was effectively a
-- "send to a label rep" pitch deck — keeping that as the fallback
-- preserves the current shape for any legacy share row.

ALTER TABLE project_shares
  ADD COLUMN IF NOT EXISTS recipient_kind text NOT NULL DEFAULT 'client'
    CHECK (recipient_kind IN ('client', 'producer', 'rapper', 'friend'));

-- share_links (legacy single-track + ad-hoc multi-track shares) gets
-- the same column for consistency. UI later checks both.
ALTER TABLE share_links
  ADD COLUMN IF NOT EXISTS recipient_kind text NOT NULL DEFAULT 'client'
    CHECK (recipient_kind IN ('client', 'producer', 'rapper', 'friend'));

-- ────────────────────────────────────────────────────────────────────────
-- creator_profiles — one row per user. Holds the "intro to my universe"
-- assets the client variant uses: bio, hero photo, credits, license
-- terms, social links. Per-user (not per-share) because the producer
-- doesn't want to retype the same bio for every send.
--
-- Each field is nullable so a user can fill the profile incrementally.
-- The client variant degrades gracefully when fields are missing —
-- empty bio just hides the bio section, empty license card just hides
-- the pricing block, etc.
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_profiles (
  user_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name       text,
  bio                text,
  hero_image_url     text,
  credits            text,                 -- multi-line list of notable placements / collabs
  license_lease_price_usd      numeric,    -- displayed in the client variant's price card
  license_exclusive_price_usd  numeric,
  license_notes      text,                 -- e.g. "All beats come with WAV trackouts. Sample clearance is buyer's responsibility."
  instagram_handle   text,
  twitter_handle     text,
  spotify_url        text,
  soundcloud_url     text,
  website_url        text,
  contact_email      text,                 -- public-facing contact (separate from auth email)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- updated_at trigger so the settings page can show "last edited Nm ago"
-- without the client having to manage it manually.
CREATE OR REPLACE FUNCTION creator_profiles_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS creator_profiles_touch ON creator_profiles;
CREATE TRIGGER creator_profiles_touch
  BEFORE UPDATE ON creator_profiles
  FOR EACH ROW EXECUTE FUNCTION creator_profiles_touch_updated_at();

-- RLS — same owner-or-legacy-null pattern as other owned tables.
-- creator_profiles is per-user so legacy-null doesn't apply: any
-- non-null user_id row must belong to the caller.
ALTER TABLE creator_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS creator_profiles_select ON creator_profiles;
CREATE POLICY creator_profiles_select ON creator_profiles
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS creator_profiles_insert ON creator_profiles;
CREATE POLICY creator_profiles_insert ON creator_profiles
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS creator_profiles_update ON creator_profiles;
CREATE POLICY creator_profiles_update ON creator_profiles
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS creator_profiles_delete ON creator_profiles;
CREATE POLICY creator_profiles_delete ON creator_profiles
  FOR DELETE USING (user_id = auth.uid());

-- Read access for share-page rendering: any authenticated user who
-- already holds a valid share token can read the OWNER's creator
-- profile. We can't enforce token-validation in RLS, so the
-- /api/share/[token] route reads with the service-role client and
-- returns only the fields needed by the client variant.
