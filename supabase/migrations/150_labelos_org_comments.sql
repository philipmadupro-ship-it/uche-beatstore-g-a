-- 150_labelos_org_comments.sql
-- LABEL-22: org comments on `project_comments` (17 R5). No new comments table.
--
-- A comment on an org project is a `project_comments` row, exactly like a
-- share-page or portal one, with three new columns:
--   org_id       the project's org, FIXED BY A TRIGGER from the project (never
--                by the caller) and NULL on every producer project;
--   visibility   'artist' (default: what the project's artist may read, as
--                before) | 'internal' (the team only);
--   resolved_at  set when a thread is resolved (on the thread's root);
--   resolved_by  who resolved it.
-- Every existing row is a producer / share / portal comment: org_id NULL,
-- visibility 'artist', not resolved. Nothing is backfilled.
--
-- The rule the whole task exists for: an `internal` comment NEVER reaches a
-- portal, a share page, a roster-artist member (role `artist`) or an external
-- project member. Enforced in four places, each sufficient on its own:
--   1. CHECK: an internal comment has no share_token and no contact_id (so no
--      portal thread and no share-link thread can ever hold one) and belongs
--      to an org project;
--   2. trigger: a reply to an internal comment is internal;
--   3. RLS: 141's org_member_read / org_member_guard on project_comments gain
--      `visibility = 'artist' OR labelos_can_read_internal_comments(org)`, so
--      a role-`artist` member's own JWT cannot read one. An external project
--      member has no policy on this table at all (148);
--   4. the routes (portal, share, org) filter on visibility as well.
--
-- Writes stay service-role only (141's labelos_org_rows_service_only is
-- already on this table); no write policy is added.

-- ── 1. Columns ──────────────────────────────────────────────────────────

ALTER TABLE public.project_comments
  ADD COLUMN IF NOT EXISTS org_id      uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS visibility  text NOT NULL DEFAULT 'artist',
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_comments_visibility_check') THEN
    ALTER TABLE public.project_comments
      ADD CONSTRAINT project_comments_visibility_check CHECK (visibility IN ('internal', 'artist'));
  END IF;
  -- Internal comments are org-team notes: never a share-link or portal thread.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_comments_internal_private') THEN
    ALTER TABLE public.project_comments
      ADD CONSTRAINT project_comments_internal_private
      CHECK (visibility = 'artist' OR (org_id IS NOT NULL AND share_token IS NULL AND contact_id IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_comments_org_project
  ON public.project_comments (org_id, project_id, created_at)
  WHERE org_id IS NOT NULL;

-- ── 2. org_id comes from the project; thread integrity ──────────────────

CREATE OR REPLACE FUNCTION public.project_comments_org_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  parent record;
BEGIN
  -- The org is the project's, whatever the caller wrote.
  SELECT p.org_id INTO NEW.org_id FROM public.projects p WHERE p.id = NEW.project_id;

  IF NEW.parent_id IS NOT NULL AND NEW.org_id IS NOT NULL THEN
    SELECT c.project_id, c.visibility INTO parent FROM public.project_comments c WHERE c.id = NEW.parent_id;
    IF NOT FOUND OR parent.project_id <> NEW.project_id THEN
      RAISE EXCEPTION 'project_comments: parent % is not a comment of project %', NEW.parent_id, NEW.project_id;
    END IF;
    -- A reply under a team-only comment is team-only: the artist must not
    -- see an answer to something they cannot read.
    IF parent.visibility = 'internal' AND NEW.visibility <> 'internal' THEN
      RAISE EXCEPTION 'project_comments: a reply to an internal comment is internal';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_comments_org_fields ON public.project_comments;
CREATE TRIGGER project_comments_org_fields
  BEFORE INSERT OR UPDATE OF project_id, org_id, parent_id, visibility ON public.project_comments
  FOR EACH ROW EXECUTE FUNCTION public.project_comments_org_fields();

-- ── 3. Who reads an internal comment ────────────────────────────────────
-- Everyone in the org's team (owner / admin / member). A roster artist (role
-- `artist`) never does (D5: no business-internal notes), whatever overrides
-- they hold; an external project member is not an org member at all.

CREATE OR REPLACE FUNCTION public.labelos_can_read_internal_comments(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(public.org_role(p_org) IN ('owner', 'admin', 'member'), false);
$$;

ALTER FUNCTION public.labelos_can_read_internal_comments(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_can_read_internal_comments(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.labelos_can_read_internal_comments(uuid) TO authenticated, anon;

-- 141's two policies, unchanged but for the visibility line.
DROP POLICY IF EXISTS org_member_read ON public.project_comments;
CREATE POLICY org_member_read ON public.project_comments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_comments.project_id
        AND p.org_id IS NOT NULL
        AND public.has_org_cap(p.org_id, 'catalog.read')
        AND public.can_see_org_project(p.org_id, p.id)
        AND (project_comments.track_id IS NULL OR public.can_read_org_track(p.org_id, project_comments.track_id))
        AND (project_comments.contact_id IS NULL OR public.can_see_artist(p.org_id, project_comments.contact_id))
        AND (project_comments.share_token IS NULL OR public.has_org_cap(p.org_id, 'share.external'))
        AND (project_comments.visibility = 'artist' OR public.labelos_can_read_internal_comments(p.org_id))
    )
  );

DROP POLICY IF EXISTS org_member_guard ON public.project_comments;
CREATE POLICY org_member_guard ON public.project_comments
  AS RESTRICTIVE
  FOR SELECT
  USING (
    NOT public.labelos_is_org_project(project_id)
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_comments.project_id
        AND p.org_id IS NOT NULL
        AND public.has_org_cap(p.org_id, 'catalog.read')
        AND public.can_see_org_project(p.org_id, p.id)
        AND (project_comments.track_id IS NULL OR public.can_read_org_track(p.org_id, project_comments.track_id))
        AND (project_comments.contact_id IS NULL OR public.can_see_artist(p.org_id, project_comments.contact_id))
        AND (project_comments.share_token IS NULL OR public.has_org_cap(p.org_id, 'share.external'))
        AND (project_comments.visibility = 'artist' OR public.labelos_can_read_internal_comments(p.org_id))
    )
  );

NOTIFY pgrst, 'reload schema';
