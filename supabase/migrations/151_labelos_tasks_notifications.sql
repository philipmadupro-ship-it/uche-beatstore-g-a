-- 151_labelos_tasks_notifications.sql
-- Label OS (LABEL-23): assignable org tasks, and org-scoped direct-ask
-- notifications (04 W5, 08 §B6, 13 R-19).
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 149 (150 is LABEL-22's). Never part of
-- supabase/apply/pending.sql.
--
-- 1. `tasks` — org-only (no user_id, the 139/142/143/144 rule). A task hangs
--    on AT MOST ONE of an artist (a roster contact), a project, a song (a
--    track) or a release, through four typed nullable foreign keys — never a
--    polymorphic (type, id) pair, so each key is a real FK and cascades with
--    its object. None set = an org-level task. `contact_tasks` (095) is the
--    producer's CRM follow-up and is untouched.
--
--    Who reads a task (D1: "each side its own tasks"):
--      - its creator and its assignee,
--      - an owner or admin of the org (they hold everything),
--      and always only while the caller is STILL a member of the task's org
--      and, for a member limited to some artists, still reaches the task's
--      object (the same scope the rest of Label OS applies). An external
--      project member (LABEL-21) is not an org member, so reads nothing.
--    Writes: service role only (141's labelos_org_rows_service_only; no write
--    policy). Routes decide who may create / complete / delete.
--
--    No per-row SECURITY DEFINER call (R-08): every disjunct is an
--    uncorrelated subquery over the caller's own few memberships or over a
--    set-returning scope function evaluated once per statement.
--
-- 2. `notifications.org_id` — nullable. NULL = a producer notification
--    (064), which behaves exactly as before. Set = an org notification, a
--    direct ask addressed to one recipient (`user_id`) within one org:
--      - a RESTRICTIVE SELECT policy: an org notification is readable only
--        while its recipient is still a member of that org (a removed member
--        loses the history, the title of a task they were given included);
--      - 141's service-only trigger: only the service role writes a row with
--        an org_id (the API roles keep their producer-era rights over rows
--        without one), so nobody can forge an org notification for themself
--        or mark one read through PostgREST — reading goes through the route.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS first.

-- ── 1. tasks ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title       text NOT NULL,
  notes       text,
  due_at      timestamptz,
  done_at     timestamptz,
  done_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- At most one object (a roster artist is a contact — 17 R3).
  artist_id   uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  project_id  uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  song_id     uuid REFERENCES public.tracks(id) ON DELETE CASCADE,
  release_id  uuid REFERENCES public.releases(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT tasks_notes_check CHECK (notes IS NULL OR length(notes) BETWEEN 1 AND 2000),
  CONSTRAINT tasks_one_object CHECK (num_nonnulls(artist_id, project_id, song_id, release_id) <= 1)
);

-- "My work": the open tasks assigned to me, soonest first.
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_open
  ON public.tasks (org_id, assignee_id, due_at NULLS LAST)
  WHERE done_at IS NULL;
-- Tasks inline on an object.
CREATE INDEX IF NOT EXISTS idx_tasks_song ON public.tasks (song_id) WHERE song_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_release ON public.tasks (release_id) WHERE release_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_project ON public.tasks (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_artist ON public.tasks (artist_id) WHERE artist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_org_created ON public.tasks (org_id, created_at DESC);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- ── Integrity ────────────────────────────────────────────────────────────
-- The object is of the task's own org (a task never points at a producer row
-- or another org's), the assignee is a member of the org when assigned, and a
-- task's org never changes. The assignee test runs only when the assignee is
-- set or changed, so a member who left does not make their old tasks
-- uneditable.

CREATE OR REPLACE FUNCTION public.tasks_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.org_id <> OLD.org_id THEN
    RAISE EXCEPTION 'tasks: a task keeps its organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.artist_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.contacts c WHERE c.id = NEW.artist_id AND c.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'tasks: the artist must belong to the same organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'tasks: the project must belong to the same organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.song_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tracks t WHERE t.id = NEW.song_id AND t.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'tasks: the song must belong to the same organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.release_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.releases r WHERE r.id = NEW.release_id AND r.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'tasks: the release must belong to the same organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.assignee_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.org_members m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.assignee_id
     ) THEN
    RAISE EXCEPTION 'tasks: the assignee must be a member of the organization' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.tasks_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tasks_integrity() FROM PUBLIC;

DROP TRIGGER IF EXISTS tasks_integrity ON public.tasks;
CREATE TRIGGER tasks_integrity BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_integrity();

DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.tasks;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');

-- ── labelos_scoped_releases ──────────────────────────────────────────────
-- The org releases whose project the caller's artist scope reaches
-- (labelos_scoped_projects, 147): a release is read through its project, as
-- 144's policy does. Written as one set so the tasks policy stays a hashed
-- subplan instead of running releases' own policy once per row. Empty for a
-- whole-org member. SECURITY DEFINER because releases' own policy is
-- per-row; EXECUTE like its two siblings (anon must evaluate to empty).

CREATE OR REPLACE FUNCTION public.labelos_scoped_releases()
RETURNS TABLE (org_id uuid, release_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sp.org_id, r.id
  FROM public.labelos_scoped_projects() sp
  JOIN public.releases r ON r.project_id = sp.project_id AND r.org_id = sp.org_id;
$$;

ALTER FUNCTION public.labelos_scoped_releases() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_scoped_releases() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.labelos_scoped_releases() TO authenticated, anon;

-- ── The policy ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS tasks_member_read ON public.tasks;
CREATE POLICY tasks_member_read ON public.tasks
  FOR SELECT
  USING (
    -- a LIVE member of the task's org (asked of the caller's few memberships)
    org_id IN (
      SELECT m.org_id FROM public.org_members m WHERE m.user_id = (SELECT auth.uid())
    )
    AND (
      -- whose own task it is …
      assignee_id = (SELECT auth.uid())
      OR created_by = (SELECT auth.uid())
      -- … or who holds everything
      OR org_id IN (
        SELECT m.org_id FROM public.org_members m
        WHERE m.user_id = (SELECT auth.uid()) AND m.role IN ('owner', 'admin')
      )
    )
    AND (
      -- scope: a whole-org member, or a task with no object, or an object the
      -- caller's artist scope reaches
      org_id IN (
        SELECT m.org_id FROM public.org_members m
        WHERE m.user_id = (SELECT auth.uid()) AND m.scope = 'org' AND m.role <> 'artist'
      )
      OR (artist_id IS NULL AND project_id IS NULL AND song_id IS NULL AND release_id IS NULL)
      OR (org_id, artist_id) IN (
        SELECT s.org_id, s.contact_id FROM public.member_artist_scopes s WHERE s.user_id = (SELECT auth.uid())
      )
      OR (org_id, project_id) IN (SELECT sp.org_id, sp.project_id FROM public.labelos_scoped_projects() sp)
      OR (org_id, song_id) IN (SELECT st.org_id, st.track_id FROM public.labelos_scoped_tracks() st)
      OR (org_id, release_id) IN (SELECT sr.org_id, sr.release_id FROM public.labelos_scoped_releases() sr)
    )
  );

-- ── 2. notifications.org_id ──────────────────────────────────────────────

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- The bell under an org: this user's rows of that org, newest first.
CREATE INDEX IF NOT EXISTS idx_notifications_user_org
  ON public.notifications (user_id, org_id, created_at DESC)
  WHERE org_id IS NOT NULL;

-- Producer rows (org_id IS NULL) are untouched. An org row is also readable
-- only by a LIVE member of its org. RESTRICTIVE: ANDed with the owner policy
-- (064), which keeps keying the row on its recipient.
DROP POLICY IF EXISTS notifications_org_member_only ON public.notifications;
CREATE POLICY notifications_org_member_only ON public.notifications
  AS RESTRICTIVE
  FOR SELECT
  USING (
    org_id IS NULL
    OR org_id IN (SELECT m.org_id FROM public.org_members m WHERE m.user_id = (SELECT auth.uid()))
  );

DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.notifications;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');

NOTIFY pgrst, 'reload schema';
