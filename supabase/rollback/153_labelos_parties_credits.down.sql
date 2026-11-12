-- Rollback for 153_labelos_parties_credits.sql (LABEL-27).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only, after the rollbacks
-- of every later migration.
--
-- Removes every credit that exists only in Label OS (org credits), drops
-- `parties` and the new columns of `track_collaborators`, and puts 141's
-- guard back. Producer credits (org_id IS NULL) are untouched: they never
-- carried a party, a scope or a status other than 'confirmed'.

DROP FUNCTION IF EXISTS public.labelos_audit_credit_decide(uuid, uuid, uuid, text, text, jsonb, jsonb);

DROP POLICY IF EXISTS track_collaborators_org_member_read ON public.track_collaborators;
DROP TRIGGER IF EXISTS track_collaborators_org_integrity ON public.track_collaborators;
DROP FUNCTION IF EXISTS public.track_collaborators_org_integrity();

DELETE FROM public.track_collaborators WHERE org_id IS NOT NULL;

DROP POLICY IF EXISTS org_member_guard ON public.track_collaborators;
CREATE POLICY org_member_guard ON public.track_collaborators
  AS RESTRICTIVE FOR SELECT
  USING (NOT public.labelos_is_org_track(track_id));

ALTER TABLE public.track_collaborators DROP CONSTRAINT IF EXISTS track_collaborators_org_columns;
ALTER TABLE public.track_collaborators DROP CONSTRAINT IF EXISTS track_collaborators_scope_check;
ALTER TABLE public.track_collaborators DROP CONSTRAINT IF EXISTS track_collaborators_status_check;
ALTER TABLE public.track_collaborators DROP CONSTRAINT IF EXISTS track_collaborators_role_detail_check;
ALTER TABLE public.track_collaborators DROP CONSTRAINT IF EXISTS track_collaborators_dispute_note_check;
DROP INDEX IF EXISTS public.idx_track_collaborators_org_track;
DROP INDEX IF EXISTS public.idx_track_collaborators_party;
ALTER TABLE public.track_collaborators DROP COLUMN IF EXISTS org_id;
ALTER TABLE public.track_collaborators DROP COLUMN IF EXISTS party_id;
ALTER TABLE public.track_collaborators DROP COLUMN IF EXISTS scope;
ALTER TABLE public.track_collaborators DROP COLUMN IF EXISTS status;
ALTER TABLE public.track_collaborators DROP COLUMN IF EXISTS role_detail;
ALTER TABLE public.track_collaborators DROP COLUMN IF EXISTS created_by;
ALTER TABLE public.track_collaborators DROP COLUMN IF EXISTS confirmed_by;
ALTER TABLE public.track_collaborators DROP COLUMN IF EXISTS confirmed_at;
ALTER TABLE public.track_collaborators DROP COLUMN IF EXISTS dispute_note;

DROP TABLE IF EXISTS public.parties;
DROP FUNCTION IF EXISTS public.labelos_scoped_parties();
DROP FUNCTION IF EXISTS public.parties_integrity();

NOTIFY pgrst, 'reload schema';
