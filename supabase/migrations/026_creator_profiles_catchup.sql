-- 026_creator_profiles_catchup.sql
-- Idempotent catch-up: ensures creator_profiles exists with all columns
-- (including license_agreement + default_discount_percent from 024).
-- Safe to run even if the table already exists.

CREATE TABLE IF NOT EXISTS public.creator_profiles (
  user_id                     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name                text,
  bio                         text,
  hero_image_url              text,
  credits                     text,
  license_lease_price_usd     numeric,
  license_exclusive_price_usd numeric,
  license_notes               text,
  license_agreement           text,
  default_discount_percent    numeric(5,2) CHECK (default_discount_percent >= 0 AND default_discount_percent <= 100),
  instagram_handle            text,
  twitter_handle              text,
  spotify_url                 text,
  soundcloud_url              text,
  website_url                 text,
  contact_email               text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- Add columns that may be missing if table was created by an earlier migration
ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS license_agreement           text,
  ADD COLUMN IF NOT EXISTS default_discount_percent    numeric(5,2)
    CHECK (default_discount_percent >= 0 AND default_discount_percent <= 100);

-- RLS
ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS creator_profiles_select  ON public.creator_profiles;
DROP POLICY IF EXISTS creator_profiles_insert  ON public.creator_profiles;
DROP POLICY IF EXISTS creator_profiles_update  ON public.creator_profiles;
DROP POLICY IF EXISTS creator_profiles_delete  ON public.creator_profiles;

CREATE POLICY creator_profiles_select ON public.creator_profiles
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY creator_profiles_insert ON public.creator_profiles
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY creator_profiles_update ON public.creator_profiles
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY creator_profiles_delete ON public.creator_profiles
  FOR DELETE USING (user_id = auth.uid());

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.creator_profiles_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS creator_profiles_touch ON public.creator_profiles;
CREATE TRIGGER creator_profiles_touch
  BEFORE UPDATE ON public.creator_profiles
  FOR EACH ROW EXECUTE FUNCTION public.creator_profiles_touch_updated_at();

-- share_links columns from 025 (role, label, invited_email, revoked_at)
ALTER TABLE public.share_links
  ADD COLUMN IF NOT EXISTS role          text NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('viewer', 'commenter', 'editor')),
  ADD COLUMN IF NOT EXISTS label         text,
  ADD COLUMN IF NOT EXISTS invited_email text,
  ADD COLUMN IF NOT EXISTS revoked_at    timestamptz;

NOTIFY pgrst, 'reload schema';
