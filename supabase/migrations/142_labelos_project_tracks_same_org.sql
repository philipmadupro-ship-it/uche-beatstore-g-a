-- 142_labelos_project_tracks_same_org.sql
-- Label OS (LABEL-14): org rows carry NO user_id on tracks, projects and
-- track_links (the rule 139 set for contacts), and `project_tracks` gets the
-- same-owner / same-org trigger every #44 junction already has (141 §4).
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 141 (docs/bstudio-label-os/16-execution-runbook.md).
--
-- Why now: LABEL-14's org upload writes the first org `project_tracks` rows
-- (a demo into its artist's Inbox, a master into its song's projects). The
-- table never had a parent check (pre-existing, carried from LABEL-12 #68):
-- its RLS policy (097 `owner_via_project`) checks only the PROJECT's owner,
-- and the service-role routes check nothing about the track. 141's scope
-- path (`can_see_org_track`) already ignores a row joining an org track to
-- another org's project, but a row joining an org track to a PRODUCER
-- project (or the reverse) is what puts Label OS material into the
-- producer's library views — the exact boundary 141 §4 holds everywhere
-- else.
--
-- The rule, 141 §4's shape:
--   org case   — project and track in the same non-null org (org rows have
--                no user_id, see below);
--   owner case — project and track owned by the same user, both producer
--                rows (org_id IS NULL). The project's owner is the row's
--                owner: project_tracks has no user_id of its own.
-- Anything else raises. "Different owner, no org" is refused too, which the
-- producer app never does (one producer; every producer route adds the
-- producer's own tracks to the producer's own projects).
--
-- Only INSERT and an UPDATE that MOVES a row (project_id / track_id) are
-- checked. A reorder (position / role) of an existing row is not, so no
-- row written before this migration can start failing an ordinary edit.
--
-- Proven as anon / authenticated / service_role in
-- supabase/local/checks/142_labelos_project_tracks_same_org.sql.
--
-- Org rows have no owner (orchestrator decision on #70, 2026-10-02). Every
-- producer route — the service-role ones included — filters on user_id, so an
-- org row whose user_id is the uploading member would reach that member's
-- producer library, search, store editor and /api/audio whenever the member
-- is the producer. With user_id NULL it matches none of them, the same rule
-- as 139's contacts_org_or_owner. The uploader is recorded in created_by.
--   - projects.user_id DROP NOT NULL + CHECK projects_org_or_owner
--     ((org_id IS NULL) = (user_id IS NOT NULL)): a producer project still
--     must have its owner (every existing row has one since 049 and org_id
--     NULL, so it validates on production);
--   - tracks.user_id is already nullable (002; production may hold legacy
--     NULL-owner producer tracks), so only CHECK tracks_org_or_owner
--     (org_id IS NULL OR user_id IS NULL);
--   - track_links.user_id DROP NOT NULL; its same-owner trigger's org path
--     now requires NEW.user_id IS NULL, the owner path is unchanged (both
--     tracks owned by NEW.user_id, both producer rows), so a producer link
--     without a user_id is refused.
-- The other #44 tables keep their NOT NULL user_id until a task first writes
-- org rows there.
--
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS first, CHECKs guarded
-- by a pg_constraint lookup (as 139 does).

-- ── Org rows have no owner ──────────────────────────────────────────────

ALTER TABLE public.projects ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.track_links ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_org_or_owner' AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_org_or_owner CHECK ((org_id IS NULL) = (user_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tracks_org_or_owner' AND conrelid = 'public.tracks'::regclass
  ) THEN
    ALTER TABLE public.tracks
      ADD CONSTRAINT tracks_org_or_owner CHECK (org_id IS NULL OR user_id IS NULL);
  END IF;
END $$;

-- 133 / 141 §4: same org, and then no owner; or the unchanged owner case.
CREATE OR REPLACE FUNCTION public.track_links_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NULL AND EXISTS (
    SELECT 1 FROM public.tracks f
    JOIN public.tracks t ON t.id = NEW.to_track_id AND t.org_id = f.org_id
    WHERE f.id = NEW.from_track_id AND f.org_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.from_track_id AND t.user_id = NEW.user_id AND t.org_id IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.to_track_id AND t.user_id = NEW.user_id AND t.org_id IS NULL) THEN
    RAISE EXCEPTION 'track_links: both tracks must be owned by %', NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- ── project_tracks: same owner or same org ──────────────────────────────

CREATE OR REPLACE FUNCTION public.project_tracks_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.tracks t ON t.id = NEW.track_id AND t.org_id = p.org_id
    WHERE p.id = NEW.project_id AND p.org_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.tracks t ON t.id = NEW.track_id AND t.user_id = p.user_id AND t.org_id IS NULL
    WHERE p.id = NEW.project_id AND p.org_id IS NULL AND p.user_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'project_tracks: track % and project % must have the same owner or the same organization',
      NEW.track_id, NEW.project_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION public.project_tracks_same_owner() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.project_tracks_same_owner() FROM PUBLIC;

DROP TRIGGER IF EXISTS project_tracks_same_owner ON public.project_tracks;
CREATE TRIGGER project_tracks_same_owner
  BEFORE INSERT OR UPDATE OF project_id, track_id ON public.project_tracks
  FOR EACH ROW EXECUTE FUNCTION public.project_tracks_same_owner();

NOTIFY pgrst, 'reload schema';
