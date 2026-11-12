-- 184_labelos_press.sql
-- Label OS (LABEL-66): PR and press — a press kit per release, shareable by token,
-- and an outreach tracker per press contact.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 144 (releases), 143 (project_assets.sensitivity) and 139
-- (org contacts). Never part of supabase/apply/pending.sql.
--
-- Everything here is org-only (no user_id, ON DELETE CASCADE from organizations so
-- the org's hard delete leaves nothing), written by the service role only (141's
-- trigger) and read through the routes only: each table has a deny-all policy and
-- no API-role privilege, like 183's marketing tables. What a caller may read is
-- decided in the route (pr.read / pr.write + the release's artist scope). The PUBLIC
-- press page is a route too: it reaches these tables with the service role after
-- checking a token, never through RLS.
--
--   press_kits          one per release: headline, bio, the line shown before the embargo
--                       (`pre_embargo_note`), and `embargo_at` (NULL = no embargo).
--   press_kit_links     the kit's links (label + https URL).
--   press_kit_photos    photos: a reference to a visual, NON-restricted project file of the
--                       release's own project (a trigger holds that). `pre_embargo` marks the
--                       few a page may show before the embargo lifts; nothing else is shown.
--   press_kit_shares    the grants: only the SHA-256 of an opaque token is stored, a label,
--                       an optional expiry, a revoke stamp and a rough view counter.
--   press_outreach      one row per press contact per release: sent / opened / replied stamps
--                       and a coverage URL (https only). `opened` is set by hand: nothing here
--                       sends mail, so there is no signal to read it from.
--
-- A press contact is an org contact (139) whose category or secondary category is
-- `press`; no people table is added. The outreach trigger holds that at insert time
-- and that the contact and the release belong to the same org.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP … IF EXISTS first.
-- Rollback: supabase/rollback/184_labelos_press.down.sql.

-- ── press_kits ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.press_kits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  release_id        uuid NOT NULL REFERENCES public.releases(id) ON DELETE CASCADE,
  headline          text CHECK (headline IS NULL OR char_length(btrim(headline)) BETWEEN 1 AND 140),
  bio               text CHECK (bio IS NULL OR char_length(btrim(bio)) BETWEEN 1 AND 3000),
  pre_embargo_note  text CHECK (pre_embargo_note IS NULL OR char_length(btrim(pre_embargo_note)) BETWEEN 1 AND 200),
  embargo_at        timestamptz,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT press_kits_one_per_release UNIQUE (release_id),
  CONSTRAINT press_kits_id_org UNIQUE (id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_press_kits_org ON public.press_kits (org_id);

CREATE OR REPLACE FUNCTION public.press_kits_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.org_id <> OLD.org_id OR NEW.release_id <> OLD.release_id) THEN
    RAISE EXCEPTION 'press_kits: a kit keeps its organization and its release' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM public.releases r WHERE r.id = NEW.release_id AND r.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'press_kits: the release must belong to the same organization' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.press_kits_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.press_kits_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS press_kits_guard ON public.press_kits;
CREATE TRIGGER press_kits_guard BEFORE INSERT OR UPDATE ON public.press_kits
  FOR EACH ROW EXECUTE FUNCTION public.press_kits_guard();

-- ── press_kit_links ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.press_kit_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kit_id      uuid NOT NULL,
  label       text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  url         text NOT NULL CHECK (url ~ '^https://[^[:space:]]+$' AND char_length(url) <= 500),
  position    int NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT press_kit_links_kit FOREIGN KEY (kit_id, org_id)
    REFERENCES public.press_kits (id, org_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_press_kit_links_kit ON public.press_kit_links (kit_id, position);

-- ── press_kit_photos ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.press_kit_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kit_id       uuid NOT NULL,
  asset_id     uuid NOT NULL REFERENCES public.project_assets(id) ON DELETE CASCADE,
  caption      text CHECK (caption IS NULL OR char_length(btrim(caption)) BETWEEN 1 AND 120),
  pre_embargo  boolean NOT NULL DEFAULT false,
  position     int NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT press_kit_photos_kit FOREIGN KEY (kit_id, org_id)
    REFERENCES public.press_kits (id, org_id) ON DELETE CASCADE,
  CONSTRAINT press_kit_photos_once UNIQUE (kit_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_press_kit_photos_kit ON public.press_kit_photos (kit_id, position);

-- The file is a visual, not restricted, file of the RELEASE'S OWN project and of the kit's org.
CREATE OR REPLACE FUNCTION public.press_kit_photos_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.org_id <> OLD.org_id OR NEW.kit_id <> OLD.kit_id OR NEW.asset_id <> OLD.asset_id) THEN
    RAISE EXCEPTION 'press_kit_photos: a photo keeps its kit and its file' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1
    FROM public.press_kits k
    JOIN public.releases r ON r.id = k.release_id
    JOIN public.project_assets a ON a.project_id = r.project_id AND a.org_id = k.org_id
    WHERE k.id = NEW.kit_id AND k.org_id = NEW.org_id AND a.id = NEW.asset_id
      AND a.kind IN ('artwork', 'photo') AND a.sensitivity = 'normal'
  ) THEN
    RAISE EXCEPTION 'press_kit_photos: the file must be an unrestricted artwork or photo of the release''s own project' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.press_kit_photos_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.press_kit_photos_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS press_kit_photos_guard ON public.press_kit_photos;
CREATE TRIGGER press_kit_photos_guard BEFORE INSERT OR UPDATE ON public.press_kit_photos
  FOR EACH ROW EXECUTE FUNCTION public.press_kit_photos_guard();

-- ── press_kit_shares ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.press_kit_shares (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kit_id           uuid NOT NULL,
  token_hash       text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  label            text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  revoked_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  view_count       int NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  last_viewed_at   timestamptz,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT press_kit_shares_kit FOREIGN KEY (kit_id, org_id)
    REFERENCES public.press_kits (id, org_id) ON DELETE CASCADE,
  CONSTRAINT press_kit_shares_token UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS idx_press_kit_shares_kit ON public.press_kit_shares (kit_id, created_at);

-- A grant keeps its kit and its token; only the revoke stamp and the counters move.
CREATE OR REPLACE FUNCTION public.press_kit_shares_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.org_id <> OLD.org_id OR NEW.kit_id <> OLD.kit_id OR NEW.token_hash <> OLD.token_hash THEN
    RAISE EXCEPTION 'press_kit_shares: a share keeps its kit and its token' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.press_kit_shares_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.press_kit_shares_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS press_kit_shares_guard ON public.press_kit_shares;
CREATE TRIGGER press_kit_shares_guard BEFORE UPDATE ON public.press_kit_shares
  FOR EACH ROW EXECUTE FUNCTION public.press_kit_shares_guard();

-- ── press_outreach ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.press_outreach (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  release_id    uuid NOT NULL REFERENCES public.releases(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  sent_at       timestamptz,
  opened_at     timestamptz,
  replied_at    timestamptz,
  coverage_url  text CHECK (coverage_url IS NULL OR (coverage_url ~ '^https://[^[:space:]]+$' AND char_length(coverage_url) <= 500)),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT press_outreach_once UNIQUE (release_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_press_outreach_release ON public.press_outreach (release_id, created_at);
CREATE INDEX IF NOT EXISTS idx_press_outreach_org ON public.press_outreach (org_id);

CREATE OR REPLACE FUNCTION public.press_outreach_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.org_id <> OLD.org_id OR NEW.release_id <> OLD.release_id OR NEW.contact_id <> OLD.contact_id) THEN
    RAISE EXCEPTION 'press_outreach: a row keeps its release and its contact' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.releases r WHERE r.id = NEW.release_id AND r.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'press_outreach: the release must belong to the same organization' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = NEW.contact_id AND c.org_id = NEW.org_id
        AND (lower(coalesce(c.category, '')) = 'press' OR lower(coalesce(c.secondary_category, '')) = 'press')
    ) THEN
      RAISE EXCEPTION 'press_outreach: the contact must be a press contact of the same organization' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.press_outreach_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.press_outreach_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS press_outreach_guard ON public.press_outreach;
CREATE TRIGGER press_outreach_guard BEFORE INSERT OR UPDATE ON public.press_outreach
  FOR EACH ROW EXECUTE FUNCTION public.press_outreach_guard();

-- ── Access: service role only, deny-all for the API roles ────────────────

ALTER TABLE public.press_kits ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.press_kits;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.press_kits
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP POLICY IF EXISTS press_kits_no_direct_access ON public.press_kits;
CREATE POLICY press_kits_no_direct_access ON public.press_kits
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
REVOKE ALL ON public.press_kits FROM anon, authenticated;

ALTER TABLE public.press_kit_links ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.press_kit_links;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.press_kit_links
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP POLICY IF EXISTS press_kit_links_no_direct_access ON public.press_kit_links;
CREATE POLICY press_kit_links_no_direct_access ON public.press_kit_links
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
REVOKE ALL ON public.press_kit_links FROM anon, authenticated;

ALTER TABLE public.press_kit_photos ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.press_kit_photos;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.press_kit_photos
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP POLICY IF EXISTS press_kit_photos_no_direct_access ON public.press_kit_photos;
CREATE POLICY press_kit_photos_no_direct_access ON public.press_kit_photos
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
REVOKE ALL ON public.press_kit_photos FROM anon, authenticated;

ALTER TABLE public.press_kit_shares ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.press_kit_shares;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.press_kit_shares
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP POLICY IF EXISTS press_kit_shares_no_direct_access ON public.press_kit_shares;
CREATE POLICY press_kit_shares_no_direct_access ON public.press_kit_shares
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
REVOKE ALL ON public.press_kit_shares FROM anon, authenticated;

ALTER TABLE public.press_outreach ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.press_outreach;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.press_outreach
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP POLICY IF EXISTS press_outreach_no_direct_access ON public.press_outreach;
CREATE POLICY press_outreach_no_direct_access ON public.press_outreach
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
REVOKE ALL ON public.press_outreach FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
