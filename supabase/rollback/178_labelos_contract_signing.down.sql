-- Rollback for 178_labelos_contract_signing.sql (LABEL-60).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the signer links, EVERY SIGNATURE (the append-only table is dropped
-- whole: the immutability trigger guards rows, not the table), the audit
-- functions and the three contracts columns. A contract that was `signed`
-- stays signed, but loses the evidence behind it. Export the org first
-- (the owner export lists signatures and the drawn-image references).
-- The signing routes then answer "not set up yet" (GET) / 503 (writes).

DROP FUNCTION IF EXISTS public.labelos_audit_contract_supersede(uuid, uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_contract_sign(uuid, uuid, uuid, uuid, text, int, text, text, text, text, text, boolean, text, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_contract_link_revoke(uuid, uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_contract_link_issue(uuid, uuid, uuid, uuid, text, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.labelos_contract_check_payload(jsonb);
DROP TABLE IF EXISTS public.contract_signatures;
DROP TABLE IF EXISTS public.contract_signers;
DROP FUNCTION IF EXISTS public.contract_signing_guard();
DROP FUNCTION IF EXISTS public.contract_signatures_no_truncate();
DROP FUNCTION IF EXISTS public.contract_signatures_immutable();
ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_esign_url_check;
DROP INDEX IF EXISTS public.idx_contracts_supersedes;
ALTER TABLE public.contracts DROP COLUMN IF EXISTS superseded_by;
ALTER TABLE public.contracts DROP COLUMN IF EXISTS supersedes_id;
ALTER TABLE public.contracts DROP COLUMN IF EXISTS esign_provider_url;

NOTIFY pgrst, 'reload schema';
