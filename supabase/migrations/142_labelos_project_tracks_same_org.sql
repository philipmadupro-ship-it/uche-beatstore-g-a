-- 142_labelos_project_tracks_same_org.sql
-- Label OS (LABEL-14): `project_tracks` gets the same-owner / same-org
-- trigger every #44 junction already has (141 §4).
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
--   org case   — project and track in the same non-null org;
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
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS first.

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
