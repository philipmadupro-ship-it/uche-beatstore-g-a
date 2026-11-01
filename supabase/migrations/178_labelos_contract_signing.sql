-- 178_labelos_contract_signing.sql
-- Label OS (LABEL-60): in-app signatures and the contract store.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 176 (contracts) and 174 (parties). Never part of
-- supabase/apply/pending.sql.
--
-- What this adds (all org-only, no user_id, service-role writes, and NO
-- policy that lets an API role read: a signature carries the hash of an
-- address and a reference to a drawn image, so a party reads their
-- signature through the route, which applies mayReadContract, or not at all):
--
--   contract_signers     one row per (contract, party) once a signing link
--                        was issued for that party. Only the HASH of the link
--                        token is stored. Revoking sets revoked_at; issuing
--                        again replaces the hash and the expiry.
--   contract_signatures  APPEND-ONLY. One row per signature: who (the party),
--                        the typed name, typed|drawn, the private-bucket
--                        reference of a drawn image (never a URL), via member|
--                        link, the SHA-256 of the exact document that was on
--                        the screen, the contract version, the time, and a
--                        one-way hash of the address. A trigger refuses every
--                        UPDATE and every direct DELETE; no API role holds
--                        any privilege. The org's own hard delete cascades
--                        (the nested delete passes), nothing else can remove a row.
--                        Whether a signature STILL COUNTS is not stored: it is
--                        derived on read from the document hash now against the
--                        hash on the row (lib/labelos/contract-signing.ts).
--   contracts            + esign_provider_url (https only; the address of an
--                        external e-signature, no integration), + supersedes_id /
--                        superseded_by (the chain a supersede leaves).
--
-- Functions (service_role only; each writes the change AND its audit event in
-- one transaction, the 146 / 155 pattern):
--   labelos_audit_contract_link_issue / _revoke   contract.signer_link_issued | revoked
--   labelos_audit_contract_sign                   contract.signature_added, and in the SAME
--                                                 transaction sent → signed + contract.signed
--                                                 when this was the last party
--   labelos_audit_contract_supersede              voids a sent / signed contract and makes
--                                                 its replacement draft: contract.superseded
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP … IF EXISTS first.

-- ── 1. contracts: provider address and the supersede chain ───────────────

ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS esign_provider_url text;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.contracts(id) ON DELETE SET NULL;

ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_esign_url_check;
ALTER TABLE public.contracts ADD CONSTRAINT contracts_esign_url_check CHECK (
  esign_provider_url IS NULL OR (length(esign_provider_url) <= 500 AND esign_provider_url ~ '^https://[^[:space:]@]+$')
);

CREATE INDEX IF NOT EXISTS idx_contracts_supersedes ON public.contracts (supersedes_id) WHERE supersedes_id IS NOT NULL;

-- The new columns are not in 176's column grant, so an API role cannot read them either.

-- ── 2. contract_signers ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contract_signers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id         uuid NOT NULL REFERENCES public.parties(id),
  role             text NOT NULL,
  -- sha256 hex of the link token; NULL once revoked. The token itself is never stored.
  token_hash       text,
  link_issued_at   timestamptz,
  link_issued_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  link_expires_at  timestamptz,
  link_revoked_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_signers_hash_check CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT contract_signers_uniq UNIQUE (contract_id, party_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_signers_token ON public.contract_signers (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contract_signers_org ON public.contract_signers (org_id, contract_id);
ALTER TABLE public.contract_signers ENABLE ROW LEVEL SECURITY;

-- ── 3. contract_signatures (append-only) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contract_signatures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id         uuid NOT NULL REFERENCES public.parties(id),
  role             text NOT NULL,
  contract_version int  NOT NULL,
  document_sha256  text NOT NULL,
  signer_name      text NOT NULL,
  method           text NOT NULL,
  -- A drawn signature's PNG, as a private-bucket reference (r2://… or local://…), never a URL.
  signature_image  text,
  via              text NOT NULL,
  -- The account that signed, when there was one. No foreign key: a user's deletion must not UPDATE an append-only row.
  signed_by_user   uuid,
  countersign      boolean NOT NULL DEFAULT false,
  ip_hash          text,
  signed_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_signatures_sha_check CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT contract_signatures_name_check CHECK (length(signer_name) BETWEEN 2 AND 200),
  CONSTRAINT contract_signatures_method_check CHECK (method IN ('typed', 'drawn')),
  CONSTRAINT contract_signatures_via_check CHECK (via IN ('member', 'link')),
  CONSTRAINT contract_signatures_image_check CHECK (
    (method = 'drawn') = (signature_image IS NOT NULL)
    AND (signature_image IS NULL OR signature_image ~ '^(r2|local)://[^[:space:]]+$')
  ),
  CONSTRAINT contract_signatures_ip_check CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{16,64}$'),
  CONSTRAINT contract_signatures_version_check CHECK (contract_version >= 1),
  -- One valid signature per party per document; signing a CHANGED document is a new row.
  CONSTRAINT contract_signatures_uniq UNIQUE (contract_id, party_id, document_sha256)
);

CREATE INDEX IF NOT EXISTS idx_contract_signatures_contract ON public.contract_signatures (contract_id, signed_at);
CREATE INDEX IF NOT EXISTS idx_contract_signatures_org ON public.contract_signatures (org_id);
ALTER TABLE public.contract_signatures ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.contract_signatures_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'contract_signatures: a signature is never changed' USING ERRCODE = 'check_violation';
  END IF;
  -- DELETE: only the cascade of the contract's or the organization's own deletion (nested inside the
  -- foreign key's trigger, pg_trigger_depth() > 1). A DELETE statement is depth 1 and is refused.
  IF pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'contract_signatures: a signature is never deleted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
ALTER FUNCTION public.contract_signatures_immutable() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contract_signatures_immutable() FROM PUBLIC;

DROP TRIGGER IF EXISTS contract_signatures_immutable ON public.contract_signatures;
CREATE TRIGGER contract_signatures_immutable BEFORE UPDATE OR DELETE ON public.contract_signatures
  FOR EACH ROW EXECUTE FUNCTION public.contract_signatures_immutable();

-- TRUNCATE is not a row trigger: close it for everyone but the table owner's maintenance.
CREATE OR REPLACE FUNCTION public.contract_signatures_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'contract_signatures: signatures are never truncated' USING ERRCODE = 'check_violation';
END;
$$;
ALTER FUNCTION public.contract_signatures_no_truncate() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contract_signatures_no_truncate() FROM PUBLIC;
DROP TRIGGER IF EXISTS contract_signatures_no_truncate ON public.contract_signatures;
CREATE TRIGGER contract_signatures_no_truncate BEFORE TRUNCATE ON public.contract_signatures
  FOR EACH STATEMENT EXECUTE FUNCTION public.contract_signatures_no_truncate();

-- A signature and a signer belong to the contract's own org and to one of its parties.
CREATE OR REPLACE FUNCTION public.contract_signing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = NEW.contract_id AND c.org_id = NEW.org_id) THEN
    RAISE EXCEPTION '%: the contract belongs to another organization', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contract_parties cp WHERE cp.contract_id = NEW.contract_id AND cp.party_id = NEW.party_id AND cp.role = NEW.role) THEN
    RAISE EXCEPTION '%: the party is not on this contract in that role', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.contract_signing_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contract_signing_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS contract_signing_guard ON public.contract_signers;
CREATE TRIGGER contract_signing_guard BEFORE INSERT ON public.contract_signers
  FOR EACH ROW EXECUTE FUNCTION public.contract_signing_guard();
DROP TRIGGER IF EXISTS contract_signing_guard ON public.contract_signatures;
CREATE TRIGGER contract_signing_guard BEFORE INSERT ON public.contract_signatures
  FOR EACH ROW EXECUTE FUNCTION public.contract_signing_guard();

-- API roles never write an org row; the routes use the service role.
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.contract_signers;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.contract_signers
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.contract_signatures;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.contract_signatures
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');

-- ── 4. No direct access ──────────────────────────────────────────────────

DROP POLICY IF EXISTS contract_signers_no_direct_access ON public.contract_signers;
CREATE POLICY contract_signers_no_direct_access ON public.contract_signers
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
REVOKE ALL ON public.contract_signers FROM anon, authenticated;

DROP POLICY IF EXISTS contract_signatures_no_direct_access ON public.contract_signatures;
CREATE POLICY contract_signatures_no_direct_access ON public.contract_signatures
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
REVOKE ALL ON public.contract_signatures FROM anon, authenticated;

-- ── 5. The audit functions ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.labelos_contract_check_payload(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'audit payload must be an object' USING ERRCODE = '22023';
  END IF;
  IF p_payload::text ~* '"[^"]*(token|password|secret)[^"]*"\s*:' THEN
    RAISE EXCEPTION 'audit payload carries a secret-looking key' USING ERRCODE = '22023';
  END IF;
  IF pg_column_size(p_payload) > 16384 THEN
    RAISE EXCEPTION 'audit payload is too large' USING ERRCODE = '22023';
  END IF;
END;
$$;
ALTER FUNCTION public.labelos_contract_check_payload(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_contract_check_payload(jsonb) FROM PUBLIC;

-- Issue (or rotate) the signing link of one party. A link exists only for a contract that is out for
-- signature. Answers { issued: true } or { error: 'not_found' | 'not_sent' | 'not_party' }.
CREATE OR REPLACE FUNCTION public.labelos_audit_contract_link_issue(
  p_org uuid,
  p_actor uuid,
  p_contract uuid,
  p_party uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row  public.contracts%ROWTYPE;
  v_role text;
BEGIN
  PERFORM public.labelos_contract_check_payload(p_payload);
  SELECT * INTO v_row FROM public.contracts WHERE id = p_contract AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_row.status <> 'sent' THEN RETURN jsonb_build_object('error', 'not_sent'); END IF;
  SELECT cp.role INTO v_role FROM public.contract_parties cp
    WHERE cp.contract_id = p_contract AND cp.party_id = p_party ORDER BY cp.position, cp.role LIMIT 1;
  IF v_role IS NULL THEN RETURN jsonb_build_object('error', 'not_party'); END IF;

  INSERT INTO public.contract_signers (contract_id, org_id, party_id, role, token_hash, link_issued_at, link_issued_by, link_expires_at, link_revoked_at)
  VALUES (p_contract, p_org, p_party, v_role, p_token_hash, now(), p_actor, p_expires_at, NULL)
  ON CONFLICT (contract_id, party_id) DO UPDATE
    SET token_hash = EXCLUDED.token_hash, link_issued_at = now(), link_issued_by = p_actor,
        link_expires_at = EXCLUDED.link_expires_at, link_revoked_at = NULL;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, song_id, release_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'contract.signer_link_issued', 'contract', p_contract, v_row.artist_contact_id, v_row.track_id, v_row.release_id,
          p_payload || jsonb_build_object('role', v_role), true, 'internal');
  RETURN jsonb_build_object('issued', true, 'role', v_role);
END;
$fn$;
ALTER FUNCTION public.labelos_audit_contract_link_issue(uuid, uuid, uuid, uuid, text, timestamptz, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_contract_link_issue(uuid, uuid, uuid, uuid, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_contract_link_issue(uuid, uuid, uuid, uuid, text, timestamptz, jsonb) TO service_role;

-- Revoke it. Answers { revoked: true } or { error: 'not_found' | 'no_link' }.
CREATE OR REPLACE FUNCTION public.labelos_audit_contract_link_revoke(
  p_org uuid,
  p_actor uuid,
  p_contract uuid,
  p_party uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row public.contracts%ROWTYPE;
  v_role text;
BEGIN
  PERFORM public.labelos_contract_check_payload(p_payload);
  SELECT * INTO v_row FROM public.contracts WHERE id = p_contract AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  UPDATE public.contract_signers SET token_hash = NULL, link_revoked_at = now()
    WHERE contract_id = p_contract AND org_id = p_org AND party_id = p_party AND token_hash IS NOT NULL
    RETURNING role INTO v_role;
  IF v_role IS NULL THEN RETURN jsonb_build_object('error', 'no_link'); END IF;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, song_id, release_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'contract.signer_link_revoked', 'contract', p_contract, v_row.artist_contact_id, v_row.track_id, v_row.release_id,
          p_payload || jsonb_build_object('role', v_role), true, 'internal');
  RETURN jsonb_build_object('revoked', true);
END;
$fn$;
ALTER FUNCTION public.labelos_audit_contract_link_revoke(uuid, uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_contract_link_revoke(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_contract_link_revoke(uuid, uuid, uuid, uuid, jsonb) TO service_role;

-- Record one signature. The route has checked WHO may sign for the party and read the document;
-- the database checks what only it can know under the contract's row lock:
--   · the contract is still `sent` and still at the version the signer read;
--   · the party is on it in that role;
--   · this party has no signature on this document yet (unique key).
-- If the signature leaves every party with a valid signature on THIS document hash, the contract
-- becomes `signed` in the same transaction and `contract.signed` is recorded after
-- `contract.signature_added`. p_sha is the hash of the document as it is now; the route computed it
-- from the same rendering the signer read.
-- Answers { signed: true, signature_id, completed } or
--   { error: 'not_found' | 'void' | 'already_signed' | 'not_sent' | 'changed' | 'not_party' | 'duplicate' }.
CREATE OR REPLACE FUNCTION public.labelos_audit_contract_sign(
  p_org uuid,
  p_actor uuid,
  p_contract uuid,
  p_party uuid,
  p_role text,
  p_version int,
  p_sha text,
  p_name text,
  p_method text,
  p_image text,
  p_via text,
  p_countersign boolean,
  p_ip_hash text,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row     public.contracts%ROWTYPE;
  v_id      uuid;
  v_missing int;
  v_done    boolean := false;
BEGIN
  PERFORM public.labelos_contract_check_payload(p_payload);
  SELECT * INTO v_row FROM public.contracts WHERE id = p_contract AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_row.status = 'void' THEN RETURN jsonb_build_object('error', 'void'); END IF;
  IF v_row.status = 'signed' THEN RETURN jsonb_build_object('error', 'already_signed'); END IF;
  IF v_row.status <> 'sent' THEN RETURN jsonb_build_object('error', 'not_sent'); END IF;
  IF v_row.version <> p_version THEN RETURN jsonb_build_object('error', 'changed'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contract_parties cp WHERE cp.contract_id = p_contract AND cp.party_id = p_party AND cp.role = p_role) THEN
    RETURN jsonb_build_object('error', 'not_party');
  END IF;

  BEGIN
    INSERT INTO public.contract_signatures (contract_id, org_id, party_id, role, contract_version, document_sha256, signer_name, method,
                                            signature_image, via, signed_by_user, countersign, ip_hash)
    VALUES (p_contract, p_org, p_party, p_role, p_version, p_sha, p_name, p_method, p_image, p_via, p_actor, p_countersign, p_ip_hash)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error', 'duplicate');
  END;

  -- Every distinct party of the contract has a signature on this document?
  SELECT count(*) INTO v_missing
  FROM (SELECT DISTINCT cp.party_id FROM public.contract_parties cp WHERE cp.contract_id = p_contract) req
  WHERE NOT EXISTS (
    SELECT 1 FROM public.contract_signatures s
    WHERE s.contract_id = p_contract AND s.party_id = req.party_id AND s.document_sha256 = p_sha
  );
  v_done := v_missing = 0;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, song_id, release_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'contract.signature_added', 'contract', p_contract, v_row.artist_contact_id, v_row.track_id, v_row.release_id,
          p_payload || jsonb_build_object('role', p_role, 'method', p_method, 'via', p_via, 'countersign', p_countersign, 'completes', v_done), true, 'internal');

  IF v_done THEN
    UPDATE public.contracts SET status = 'signed' WHERE id = p_contract;
    INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, song_id, release_id, payload, audit, visibility)
    VALUES (p_org, p_actor, 'contract.signed', 'contract', p_contract, v_row.artist_contact_id, v_row.track_id, v_row.release_id,
            jsonb_build_object('version', p_version), true, 'internal');
  END IF;
  RETURN jsonb_build_object('signed', true, 'signature_id', v_id, 'completed', v_done);
END;
$fn$;
ALTER FUNCTION public.labelos_audit_contract_sign(uuid, uuid, uuid, uuid, text, int, text, text, text, text, text, boolean, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_contract_sign(uuid, uuid, uuid, uuid, text, int, text, text, text, text, text, boolean, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_contract_sign(uuid, uuid, uuid, uuid, text, int, text, text, text, text, text, boolean, text, jsonb) TO service_role;

-- Supersede: the replacement is a new DRAFT copy of a sent or signed contract (clauses, fields, links,
-- parties; never the internal note), and the old one is voided and points at it. Its signatures stay on
-- the old contract as the record. Answers { new_id } or { error: 'not_found' | 'not_sent' }.
CREATE OR REPLACE FUNCTION public.labelos_audit_contract_supersede(
  p_org uuid,
  p_actor uuid,
  p_contract uuid,
  p_reason text,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_old public.contracts%ROWTYPE;
  v_new uuid;
BEGIN
  PERFORM public.labelos_contract_check_payload(p_payload);
  SELECT * INTO v_old FROM public.contracts WHERE id = p_contract AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_old.status NOT IN ('sent', 'signed') OR v_old.superseded_by IS NOT NULL THEN RETURN jsonb_build_object('error', 'not_sent'); END IF;

  INSERT INTO public.contracts (org_id, type, title, template_id, template_source, template_version, clauses, artist_contact_id, track_id,
                                release_id, effective_date, term_months, territories, fields, created_by, supersedes_id)
  VALUES (p_org, v_old.type, v_old.title, v_old.template_id, v_old.template_source, v_old.template_version, v_old.clauses, v_old.artist_contact_id,
          v_old.track_id, v_old.release_id, v_old.effective_date, v_old.term_months, v_old.territories, v_old.fields, p_actor, v_old.id)
  RETURNING id INTO v_new;

  INSERT INTO public.contract_parties (contract_id, party_id, org_id, role, position)
  SELECT v_new, cp.party_id, p_org, cp.role, cp.position FROM public.contract_parties cp WHERE cp.contract_id = v_old.id;

  UPDATE public.contracts
  SET status = 'void', voided_by = p_actor, voided_at = now(), void_reason = coalesce(nullif(p_reason, ''), 'Superseded'), superseded_by = v_new
  WHERE id = v_old.id;
  -- Its links stop working with it.
  UPDATE public.contract_signers SET token_hash = NULL, link_revoked_at = now() WHERE contract_id = v_old.id AND token_hash IS NOT NULL;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, song_id, release_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'contract.superseded', 'contract', v_old.id, v_old.artist_contact_id, v_old.track_id, v_old.release_id,
          p_payload || jsonb_build_object('from', v_old.status, 'replacement', v_new), true, 'internal');
  RETURN jsonb_build_object('new_id', v_new, 'from', v_old.status);
END;
$fn$;
ALTER FUNCTION public.labelos_audit_contract_supersede(uuid, uuid, uuid, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_contract_supersede(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_contract_supersede(uuid, uuid, uuid, text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
