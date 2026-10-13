-- 152_labelos_creative_direction.sql
-- Label OS (LABEL-26): a per-artist memory of creative direction and
-- references (04 W6, 17 R3: keyed by the roster contact, no `artists` table).
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 151. Never part of supabase/apply/pending.sql.
--
-- 1. `artist_direction (contact_id PK, org_id, direction jsonb, updated_by,
--    updated_at)` — ONE structured document per roster artist. The shape of
--    `direction` (a handful of short text fields) is validated by the route
--    (lib/labelos/direction.ts); the database only insists on a JSON object of
--    sane size. There is no free-form wiki (UX: structured fields + a list).
--
-- 2. `artist_references (id, org_id, contact_id, kind, title, note, url,
--    track_id, asset_id, visibility, position, created_by, …)` — the list.
--    A reference is exactly one of: a track of the org (`track`), a link
--    (`link`, https only), a visual file already on an org project
--    (`file` → project_assets, LABEL-15), or a written note (`note`).
--    `visibility` is 'artist' (default: the artist may read it) or 'internal'
--    (the team only — an A&R's candid read of where the artist should go).
--
--    THE RULE this task exists for: an INTERNAL reference is never readable by
--    a member whose role is `artist`, whatever abilities were switched on for
--    them. Enforced in the RLS policy (their own JWT reads nothing internal)
--    and again by the routes.
--
-- Both tables are org-only (no user_id — the 139/142/143/144/151 rule), RLS on,
-- and written by the service role only (141's labelos_org_rows_service_only;
-- no write policy exists). Reads: a LIVE member of the org with `catalog.read`
-- whose artist scope reaches the contact (a whole-org member, or the contact
-- is in member_artist_scopes). External project members (148) are not org
-- members and read nothing.
--
-- No per-row SECURITY DEFINER call (R-08): every disjunct is an uncorrelated
-- subquery over the caller's own few memberships, hashed once per statement.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS first.

-- ── 1. artist_direction ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.artist_direction (
  contact_id uuid PRIMARY KEY REFERENCES public.contacts(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  direction  jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artist_direction_is_object CHECK (jsonb_typeof(direction) = 'object'),
  CONSTRAINT artist_direction_size CHECK (pg_column_size(direction) <= 16384)
);

CREATE INDEX IF NOT EXISTS idx_artist_direction_org ON public.artist_direction (org_id);

ALTER TABLE public.artist_direction ENABLE ROW LEVEL SECURITY;

-- ── 2. artist_references ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.artist_references (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL,
  note       text,
  url        text,
  track_id   uuid REFERENCES public.tracks(id) ON DELETE CASCADE,
  asset_id   uuid REFERENCES public.project_assets(id) ON DELETE CASCADE,
  visibility text NOT NULL DEFAULT 'artist',
  position   integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artist_references_kind_check CHECK (kind IN ('track', 'link', 'file', 'note')),
  CONSTRAINT artist_references_visibility_check CHECK (visibility IN ('artist', 'internal')),
  CONSTRAINT artist_references_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT artist_references_note_check CHECK (note IS NULL OR length(note) BETWEEN 1 AND 2000),
  CONSTRAINT artist_references_url_check CHECK (url IS NULL OR (url ~* '^https://' AND length(url) <= 2000)),
  -- Each kind carries exactly its own pointer.
  CONSTRAINT artist_references_shape CHECK (
    (kind = 'track' AND track_id IS NOT NULL AND url IS NULL AND asset_id IS NULL)
    OR (kind = 'link' AND url IS NOT NULL AND track_id IS NULL AND asset_id IS NULL)
    OR (kind = 'file' AND asset_id IS NOT NULL AND url IS NULL AND track_id IS NULL)
    OR (kind = 'note' AND note IS NOT NULL AND url IS NULL AND track_id IS NULL AND asset_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_artist_references_contact
  ON public.artist_references (org_id, contact_id, position, created_at);
CREATE INDEX IF NOT EXISTS idx_artist_references_track ON public.artist_references (track_id) WHERE track_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_artist_references_asset ON public.artist_references (asset_id) WHERE asset_id IS NOT NULL;

ALTER TABLE public.artist_references ENABLE ROW LEVEL SECURITY;

-- ── Integrity ────────────────────────────────────────────────────────────
-- The artist is a roster contact of the row's own org; a track reference
-- points at a track of that org; a file reference at a VISUAL, non-restricted
-- file of an org project of that org (a contract or a working stem must not
-- become readable by a team-wide, artist-visible list). The org and the
-- contact never change.

CREATE OR REPLACE FUNCTION public.labelos_direction_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.org_id <> OLD.org_id OR NEW.contact_id <> OLD.contact_id) THEN
    RAISE EXCEPTION '%: the organization and the artist of a row never change', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.org_id = NEW.org_id) THEN
    RAISE EXCEPTION '%: the artist must belong to the same organization', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'artist_references' THEN
    IF NEW.track_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.tracks t WHERE t.id = NEW.track_id AND t.org_id = NEW.org_id
    ) THEN
      RAISE EXCEPTION 'artist_references: the track must belong to the same organization'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.asset_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.project_assets a
      WHERE a.id = NEW.asset_id
        AND a.org_id = NEW.org_id
        AND a.sensitivity = 'normal'
        AND a.kind IN ('artwork', 'photo', 'video', 'lyrics')
    ) THEN
      RAISE EXCEPTION 'artist_references: the file must be a visible artwork, photo, video or lyrics file of the same organization'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.labelos_direction_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_direction_integrity() FROM PUBLIC;

DROP TRIGGER IF EXISTS artist_direction_integrity ON public.artist_direction;
CREATE TRIGGER artist_direction_integrity BEFORE INSERT OR UPDATE ON public.artist_direction
  FOR EACH ROW EXECUTE FUNCTION public.labelos_direction_integrity();
DROP TRIGGER IF EXISTS artist_references_integrity ON public.artist_references;
CREATE TRIGGER artist_references_integrity BEFORE INSERT OR UPDATE ON public.artist_references
  FOR EACH ROW EXECUTE FUNCTION public.labelos_direction_integrity();

-- Writes are the service role's (141): the API roles can neither forge nor edit.
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.artist_direction;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.artist_direction
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.artist_references;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.artist_references
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');

-- ── Policies ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS artist_direction_member_read ON public.artist_direction;
CREATE POLICY artist_direction_member_read ON public.artist_direction
  FOR SELECT
  USING (
    -- catalog.read in the row's org, asked of the caller's few memberships
    org_id IN (
      SELECT cm.org_id FROM public.org_members cm
      WHERE cm.user_id = (SELECT auth.uid()) AND public.has_org_cap(cm.org_id, 'catalog.read')
    )
    AND (
      -- a whole-org member, or an artist the caller's scope reaches
      org_id IN (
        SELECT om.org_id FROM public.org_members om
        WHERE om.user_id = (SELECT auth.uid()) AND om.scope = 'org' AND om.role <> 'artist'
      )
      OR (org_id, contact_id) IN (
        SELECT s.org_id, s.contact_id FROM public.member_artist_scopes s WHERE s.user_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS artist_references_member_read ON public.artist_references;
CREATE POLICY artist_references_member_read ON public.artist_references
  FOR SELECT
  USING (
    org_id IN (
      SELECT cm.org_id FROM public.org_members cm
      WHERE cm.user_id = (SELECT auth.uid()) AND public.has_org_cap(cm.org_id, 'catalog.read')
    )
    AND (
      org_id IN (
        SELECT om.org_id FROM public.org_members om
        WHERE om.user_id = (SELECT auth.uid()) AND om.scope = 'org' AND om.role <> 'artist'
      )
      OR (org_id, contact_id) IN (
        SELECT s.org_id, s.contact_id FROM public.member_artist_scopes s WHERE s.user_id = (SELECT auth.uid())
      )
    )
    AND (
      visibility = 'artist'
      -- internal: the team (owner / admin / member) — never role `artist`
      OR org_id IN (
        SELECT tm.org_id FROM public.org_members tm
        WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'admin', 'member')
      )
    )
  );

NOTIFY pgrst, 'reload schema';
