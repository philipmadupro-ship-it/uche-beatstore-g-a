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
DROP FUNCTION IF EXISTS public.labelos_audit_contract_sign(uuid, uuid, uuid, uuid, text, int, text, text, text, text, text, boolean, text, text, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_contract_link_revoke(uuid, uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_contract_link_issue(uuid, uuid, uuid, uuid, text, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.labelos_contract_check_payload(jsonb);
DROP TABLE IF EXISTS public.contract_signatures;
DROP TABLE IF EXISTS public.contract_signers;
DROP FUNCTION IF EXISTS public.contract_signing_guard();
DROP FUNCTION IF EXISTS public.contract_signatures_no_truncate();
DROP FUNCTION IF EXISTS public.contract_signatures_immutable();
-- Restore 176's content-freeze trigger (the 178 one names the columns dropped below).
CREATE OR REPLACE FUNCTION public.contracts_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean;
BEGIN
  -- Everything linked belongs to the contract's own org.
  IF NEW.artist_contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.artist_contact_id AND c.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'contracts: the artist is not a contact of this organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.track_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.track_id AND t.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'contracts: the song belongs to another organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.release_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.releases r WHERE r.id = NEW.release_id AND r.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'contracts: the release belongs to another organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.template_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contract_templates t WHERE t.id = NEW.template_id AND t.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'contracts: the template belongs to another organization' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'contracts: a contract is created as a draft' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.org_id <> OLD.org_id THEN
    RAISE EXCEPTION 'contracts: a contract never changes organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    ok := (OLD.status = 'draft' AND NEW.status IN ('sent', 'void'))
       OR (OLD.status = 'sent' AND NEW.status IN ('signed', 'void'))
       OR (OLD.status = 'signed' AND NEW.status = 'void');
    IF NOT ok THEN
      RAISE EXCEPTION 'contracts: % cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD.status <> 'draft' AND (
       NEW.type IS DISTINCT FROM OLD.type
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.clauses IS DISTINCT FROM OLD.clauses
    OR NEW.template_id IS DISTINCT FROM OLD.template_id
    OR NEW.template_source IS DISTINCT FROM OLD.template_source
    OR NEW.template_version IS DISTINCT FROM OLD.template_version
    OR NEW.artist_contact_id IS DISTINCT FROM OLD.artist_contact_id
    OR NEW.track_id IS DISTINCT FROM OLD.track_id
    OR NEW.release_id IS DISTINCT FROM OLD.release_id
    OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
    OR NEW.term_months IS DISTINCT FROM OLD.term_months
    OR NEW.territories IS DISTINCT FROM OLD.territories
    OR NEW.fields IS DISTINCT FROM OLD.fields
  ) THEN
    RAISE EXCEPTION 'contracts: a contract that has left draft is not edited' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.contracts_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contracts_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS contracts_guard ON public.contracts;
CREATE TRIGGER contracts_guard BEFORE INSERT OR UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_guard();
ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_sent_document_check;
ALTER TABLE public.contracts DROP COLUMN IF EXISTS sent_snapshot;
ALTER TABLE public.contracts DROP COLUMN IF EXISTS sent_document_ref;
ALTER TABLE public.contracts DROP COLUMN IF EXISTS sent_document_sha256;
ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_esign_url_check;
DROP INDEX IF EXISTS public.idx_contracts_supersedes;
ALTER TABLE public.contracts DROP COLUMN IF EXISTS superseded_by;
ALTER TABLE public.contracts DROP COLUMN IF EXISTS supersedes_id;
ALTER TABLE public.contracts DROP COLUMN IF EXISTS esign_provider_url;

NOTIFY pgrst, 'reload schema';
