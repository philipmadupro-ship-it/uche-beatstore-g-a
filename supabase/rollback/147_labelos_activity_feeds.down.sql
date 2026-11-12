-- Rollback for 147_labelos_activity_feeds.sql (LABEL-20).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Restores 136's activity_events read policy (catalog.read + visibility, no
-- artist scope), drops the scoped-projects function and the two feed indexes. The
-- user_profiles.last_seen_overview_at column stays: 136 created it, and
-- dropping it here would remove a column this migration never added.
-- Rolling back reopens the gap LABEL-20 closed (a scoped member reading with
-- their own JWT sees other artists' `artist` events); the feeds themselves
-- go dark with the flag, not with this file.

DROP POLICY IF EXISTS activity_events_member_read ON public.activity_events;
CREATE POLICY activity_events_member_read ON public.activity_events
  FOR SELECT
  USING (
    (SELECT public.has_org_cap(org_id, 'catalog.read'))
    AND (visibility = 'artist' OR (SELECT public.has_org_cap(org_id, 'business.read.internal')))
  );

DROP FUNCTION IF EXISTS public.labelos_scoped_projects();
DROP INDEX IF EXISTS public.idx_activity_events_project_created;
DROP INDEX IF EXISTS public.idx_activity_events_song_created;

NOTIFY pgrst, 'reload schema';
