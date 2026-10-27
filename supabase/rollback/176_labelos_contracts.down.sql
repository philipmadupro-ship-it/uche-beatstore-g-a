-- Rollback for 176_labelos_contracts.sql (LABEL-57).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the three tables and their functions. EVERY CONTRACT AND EVERY
-- ORGANIZATION TEMPLATE VERSION IS LOST. The contract routes then answer
-- "not set up yet" (GET) / 503 (writes) until 176 is applied again.

DROP FUNCTION IF EXISTS public.labelos_contract_save(uuid, uuid, uuid, jsonb, jsonb);
DROP TABLE IF EXISTS public.contract_parties;
DROP TABLE IF EXISTS public.contracts;
DROP TABLE IF EXISTS public.contract_templates;
DROP FUNCTION IF EXISTS public.labelos_my_contracts();
DROP FUNCTION IF EXISTS public.contract_parties_guard();
DROP FUNCTION IF EXISTS public.contracts_guard();
DROP FUNCTION IF EXISTS public.contract_templates_immutable();

NOTIFY pgrst, 'reload schema';
