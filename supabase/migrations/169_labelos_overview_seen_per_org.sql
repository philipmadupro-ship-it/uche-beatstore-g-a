-- 169_labelos_overview_seen_per_org.sql
-- Label OS (LABEL-46, review finding G5): "since your last visit" per org.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main. Never part of supabase/apply/pending.sql.
--
-- 136 put `last_seen_overview_at` on user_profiles: ONE value per user, so
-- opening org A's Overview marked every other org's digest seen as well.
-- This table holds one mark per (org, user).
--
--  * Read by the member on their own JWT (their own rows, live orgs they
--    still belong to); written ONLY by POST /api/org/[orgId]/overview/seen
--    through the service role. The API roles hold no INSERT / UPDATE /
--    DELETE privilege and there is no write policy.
--  * Cascades from the organization (LABEL-39's hard delete) and from the
--    user. A personal read marker: not in the org export.
--  * Backfill: every existing membership starts from the member's user-level
--    value, so nobody's feed reopens to a week of already-read events. The
--    user-level column stays (it is that backfill's source and the fallback
--    the code uses while this migration is unapplied); it is no longer written.
--
-- Idempotent: IF NOT EXISTS, DROP POLICY/TRIGGER IF EXISTS, ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS public.org_overview_seen (
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS org_overview_seen_user_idx ON public.org_overview_seen (user_id);

ALTER TABLE public.org_overview_seen ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.org_overview_seen FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.org_overview_seen TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_overview_seen TO service_role;

DROP POLICY IF EXISTS org_overview_seen_self_read ON public.org_overview_seen;
CREATE POLICY org_overview_seen_self_read ON public.org_overview_seen
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND (SELECT public.org_role(org_overview_seen.org_id)) IS NOT NULL
  );

-- A mark does not outlive the membership: leaving an org removes it, so a
-- member who is invited back starts from the default window, not from a
-- months-old mark. (The cascade from organizations needs no trigger.)
CREATE OR REPLACE FUNCTION public.org_overview_seen_forget()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.org_overview_seen WHERE org_id = OLD.org_id AND user_id = OLD.user_id;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.org_overview_seen_forget() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS org_overview_seen_forget ON public.org_members;
CREATE TRIGGER org_overview_seen_forget
  AFTER DELETE ON public.org_members
  FOR EACH ROW EXECUTE FUNCTION public.org_overview_seen_forget();

-- Backfill from the user-level value. (One value per user is all that was
-- stored, so every membership starts from it: that is what the member had
-- "seen" under the old scheme, and it cannot be told apart per org.)
INSERT INTO public.org_overview_seen (org_id, user_id, last_seen_at)
SELECT om.org_id, om.user_id, up.last_seen_overview_at
FROM public.org_members om
JOIN public.user_profiles up ON up.user_id = om.user_id
WHERE up.last_seen_overview_at IS NOT NULL
ON CONFLICT (org_id, user_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
