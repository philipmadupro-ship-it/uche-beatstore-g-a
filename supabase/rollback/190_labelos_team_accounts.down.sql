-- Rollback for 190_labelos_team_accounts.sql (team accounts, doc 25 phase 1).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the functions and the record of which accounts an org created. The
-- accounts and their memberships stay: they become ordinary members, and the
-- team-account routes answer 503.

DROP FUNCTION IF EXISTS public.labelos_team_account_password_changed(uuid);
DROP FUNCTION IF EXISTS public.labelos_audit_team_account_set_disabled(uuid, uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.labelos_audit_team_account_reset(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.labelos_team_account_target(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.labelos_audit_team_account_create(uuid, uuid, uuid, text, text[], uuid[], jsonb);
DROP TABLE IF EXISTS public.org_managed_accounts;

NOTIFY pgrst, 'reload schema';
