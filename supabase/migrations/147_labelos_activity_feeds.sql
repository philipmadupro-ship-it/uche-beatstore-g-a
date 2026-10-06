-- 147_labelos_activity_feeds.sql
-- Label OS (LABEL-20): the activity feeds, and the artist-scope predicate the
-- activity_events read policy was missing.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 146 (docs/bstudio-label-os/16-execution-runbook.md).
-- Never part of supabase/apply/pending.sql.
--
-- What changes:
--
--  1. user_profiles.last_seen_overview_at — already created by 136 (it is
--     in the table's CREATE). The ADD COLUMN IF NOT EXISTS below is a no-op
--     there and only keeps this migration true on its own. It is written by
--     the member's own session through the service-role route that
--     `POST /api/org/[orgId]/overview/seen` is, never through PostgREST:
--     136 gave user_profiles a SELECT policy and no write policy, and this
--     migration adds none. Who may READ it is unchanged: the user, and
--     co-members under 136's existing policy.
--
--  2. activity_events_member_read gains the artist-scope predicate (carried
--     from LABEL-19: 136's policy had none, so a member limited to some
--     artists — or a roster artist — reading the table with their own JWT saw
--     `artist` events of artists outside their scope, `song.created` carries
--     a title). The rule (the SQL twin of
--     lib/labelos/activity-feed.ts#eventVisibleTo, held equal by the local
--     check and by `can_see_artist` / `can_see_org_project`):
--
--       whole-org member                       → every event of the org
--       event names an artist (artist_id)      → that artist is in the scope
--       else event names a project (project_id)→ that project is in the scope
--       else                                   → NOBODY scoped
--
--     An event naming neither — member and invitation changes, org settings,
--     contact removals — is the organization's own business and is read by
--     whole-org members only. A song_id alone does not place an event (the
--     song events carry their artist or project). When an event names an
--     artist the artist alone decides, so a project the member can see does
--     not widen it.
--     Capability and visibility are unchanged from 136: catalog.read, and
--     business.read.internal for `internal` rows. Producer-era behaviour is
--     untouched: no producer table, policy or function is edited.
--
--     Cost (R-08). The policy adds NO per-row SECURITY DEFINER call. Every
--     scope disjunct is an uncorrelated subquery the planner hashes once per
--     statement: the caller's whole-org memberships, their own
--     member_artist_scopes rows (readable under 139's policy), and
--     `labelos_scoped_projects()` — the projects their scope reaches, one
--     set-returning call per statement — instead of can_see_artist /
--     can_see_org_project once per event. 139's trigger keeps a scope row's
--     contact inside its org, which is what lets the artist test stay a
--     plain lookup. (A per-row version measured 816 ms against 13 ms for the
--     newest 100 events of a scoped member at 100k events.)
--
--  3. Two partial indexes so the project and song feeds filter by index
--     (08 §B3) like the artist feed already does.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF
-- EXISTS before CREATE POLICY, CREATE INDEX IF NOT EXISTS.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS last_seen_overview_at timestamptz;

-- ── labelos_scoped_projects ──────────────────────────────────────────────
-- The org projects the caller's artist scope reaches: a project that is an
-- in-scope artist's Inbox, or that links an in-scope artist through
-- project_contacts, and only a project OF THE ORG the scope row names — the
-- rule of can_see_org_project (141) for a member limited to some artists,
-- written as one set instead of a per-project test. Empty for a whole-org
-- member (who needs no scope). Scope only: capabilities are has_org_cap's job.
-- SECURITY DEFINER because project_contacts has no member policy.
-- EXECUTE for authenticated and anon, like can_see_artist / can_see_org_project:
-- the policy runs as the invoker for every role, and anon must evaluate it to
-- an empty result, not a permission error.

CREATE OR REPLACE FUNCTION public.labelos_scoped_projects()
RETURNS TABLE (org_id uuid, project_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.org_id, p.id
  FROM public.member_artist_scopes s
  JOIN public.projects p ON p.org_id = s.org_id AND p.inbox_for_contact_id = s.contact_id
  WHERE s.user_id = auth.uid()
  UNION
  SELECT p.org_id, p.id
  FROM public.member_artist_scopes s
  JOIN public.project_contacts pc ON pc.contact_id = s.contact_id
  JOIN public.projects p ON p.id = pc.project_id AND p.org_id = s.org_id
  WHERE s.user_id = auth.uid();
$$;

ALTER FUNCTION public.labelos_scoped_projects() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_scoped_projects() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.labelos_scoped_projects() TO authenticated, anon;

-- ── The policy ───────────────────────────────────────────────────────────
-- 136's two conditions, unchanged, plus scope. Each scope disjunct is
-- uncorrelated (no reference to the outer row inside its subquery), so each
-- is planned as a hashed subplan evaluated once.

DROP POLICY IF EXISTS activity_events_member_read ON public.activity_events;
CREATE POLICY activity_events_member_read ON public.activity_events
  FOR SELECT
  USING (
    (SELECT public.has_org_cap(org_id, 'catalog.read'))
    AND (visibility = 'artist' OR (SELECT public.has_org_cap(org_id, 'business.read.internal')))
    AND (
      org_id IN (
        SELECT om.org_id
        FROM public.org_members om
        WHERE om.user_id = (SELECT auth.uid())
          AND om.scope = 'org'
          AND om.role <> 'artist'
      )
      OR (
        artist_id IS NOT NULL
        AND (org_id, artist_id) IN (
          SELECT s.org_id, s.contact_id
          FROM public.member_artist_scopes s
          WHERE s.user_id = (SELECT auth.uid())
        )
      )
      OR (
        artist_id IS NULL
        AND project_id IS NOT NULL
        AND (org_id, project_id) IN (SELECT sp.org_id, sp.project_id FROM public.labelos_scoped_projects() sp)
      )
    )
  );

-- ── Feed indexes ─────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_activity_events_project_created
  ON public.activity_events (project_id, created_at DESC)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_events_song_created
  ON public.activity_events (song_id, created_at DESC)
  WHERE song_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
