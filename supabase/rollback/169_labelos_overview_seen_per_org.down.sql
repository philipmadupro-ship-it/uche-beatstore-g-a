-- Rollback for 169_labelos_overview_seen_per_org.sql (LABEL-46).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the per-org marks. The code then falls back to the user-level
-- user_profiles.last_seen_overview_at (left in place by 169, as of its
-- backfill), so each member's digests reopen from that older value.

DROP TRIGGER IF EXISTS org_overview_seen_forget ON public.org_members;
DROP FUNCTION IF EXISTS public.org_overview_seen_forget();
DROP TABLE IF EXISTS public.org_overview_seen;

NOTIFY pgrst, 'reload schema';
