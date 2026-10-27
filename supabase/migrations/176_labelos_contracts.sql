-- 176_labelos_contracts.sql
-- Label OS (LABEL-57): the contract record and the org's editable templates.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 175 (it uses 175's labelos_territories_ok). Never part of
-- supabase/apply/pending.sql.
--
-- Three tables, all org-only (no user_id; service-role writes):
--
--   contract_templates  an organization's OWN copies of a contract template,
--                       versioned: a row is never rewritten (trigger), an edit
--                       is the next version of (org, type). The PLATFORM
--                       defaults are not rows — they ship in code
--                       (src/lib/labelos/contracts/templates/*) — so there is
--                       no NULL-org row to leak or to forget in a purge.
--   contracts           type, title, status draft|sent|signed|void, links to the
--                       artist (a roster contact), a song and a release, term,
--                       territories, typed merge `fields`, and a SNAPSHOT of the
--                       clauses it was made from (`clauses`, `template_*`): a
--                       template edit never rewrites a contract's text.
--   contract_parties    which `parties` (LABEL-27/54: the one legal-identity
--                       table) take which role in a contract. No identity field
--                       is copied here; tax id and payment instructions stay
--                       finance-only on `parties` and are never merged into a
--                       document.
--
-- Rules the DATABASE holds (not only the routes):
--   · contracts_same_org / contract_parties_guard: the artist contact, song,
--     release, template and every party belong to the contract's own org;
--     parties can be added only to a draft.
--   · contracts_guard: a contract is created as a draft; status moves only
--     draft→sent|void, sent→signed|void, signed→void (void is final); once it
--     has left draft its content never changes (LABEL-58 makes versions), only
--     the internal note and the status.
--   · contract_templates_immutable: no UPDATE of a template row.
--   · labelos_org_rows_service_only on all three: API roles cannot write.
--
-- Reads (RLS, hashed uncorrelated subplans only — R-08):
--   · contracts: `contracts.read` (never role artist) AND (whole-org member OR
--     the contract's artist is in the caller's member_artist_scopes), OR
--     labelos_my_contracts(): a contract that has LEFT DRAFT and names the
--     caller — they are a party (parties.user_id), or a roster artist whose own
--     contact is the contract's artist — in an org licensed for contracts.
--     An artist never reads another artist's contract, nor a draft.
--   · contract_templates: `contracts.read`, role other than artist.
--   · contract_parties: exactly the contracts the caller can read.
--
-- Voiding: labelos_audit_contract_void changes the status and records the audit
-- event `contract.voided` in one transaction.
--
-- Atomic write: labelos_contract_save(org, actor, id, row, parties) creates
-- or edits a DRAFT and replaces its parties in one transaction. service_role
-- only. Everything else (void, templates) is one statement.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP … IF EXISTS first.

-- The links to a contact, song, release and party are plain (NO ACTION, like
-- split_sheets): deleting one that a contract names is refused at the end of the
-- statement, but the org's own hard delete (one DELETE on organizations,
-- cascading to all of these) still goes through. RESTRICT would be checked per
-- row and could fail the purge depending on cascade order.

-- ── 1. contract_templates ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contract_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type       text NOT NULL,
  version    int  NOT NULL,
  name       text NOT NULL,
  clauses    jsonb NOT NULL,
  -- The version this was edited from: 'platform:<type>@<n>' or 'org:<n>'.
  based_on   text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_templates_type_check CHECK (type IN (
    'recording', 'distribution', 'licence', 'deal_360', 'producer', 'beat_licence', 'feature',
    'co_publishing', 'management', 'collaboration', 'session', 'work_for_hire', 'mixing_mastering', 'nda')),
  CONSTRAINT contract_templates_version_check CHECK (version >= 1),
  CONSTRAINT contract_templates_name_check CHECK (length(name) BETWEEN 1 AND 120),
  CONSTRAINT contract_templates_clauses_check CHECK (
    jsonb_typeof(clauses) = 'array' AND jsonb_array_length(clauses) BETWEEN 1 AND 60 AND length(clauses::text) <= 400000),
  CONSTRAINT contract_templates_version_uniq UNIQUE (org_id, type, version)
);

CREATE INDEX IF NOT EXISTS idx_contract_templates_org_type ON public.contract_templates (org_id, type, version DESC);
ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.contract_templates_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'contract_templates: a template version is never changed; save a new version'
    USING ERRCODE = 'check_violation';
END;
$$;
REVOKE ALL ON FUNCTION public.contract_templates_immutable() FROM PUBLIC;

DROP TRIGGER IF EXISTS contract_templates_immutable ON public.contract_templates;
CREATE TRIGGER contract_templates_immutable BEFORE UPDATE ON public.contract_templates
  FOR EACH ROW EXECUTE FUNCTION public.contract_templates_immutable();

-- ── 2. contracts ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contracts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type              text NOT NULL,
  title             text NOT NULL,
  status            text NOT NULL DEFAULT 'draft',
  -- The template snapshot: where the clauses came from, and the clauses themselves.
  template_id       uuid REFERENCES public.contract_templates(id) ON DELETE SET NULL,
  template_source   text NOT NULL,
  template_version  int  NOT NULL DEFAULT 1,
  clauses           jsonb NOT NULL,
  artist_contact_id uuid REFERENCES public.contacts(id),
  track_id          uuid REFERENCES public.tracks(id),
  release_id        uuid REFERENCES public.releases(id),
  effective_date    date,
  term_months       int,
  territories       text[],
  fields            jsonb NOT NULL DEFAULT '{}'::jsonb,
  internal_note     text,
  -- Revision of the contract itself (LABEL-58 bumps it); the template's is template_version.
  version           int  NOT NULL DEFAULT 1,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at         timestamptz,
  void_reason       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contracts_type_check CHECK (type IN (
    'recording', 'distribution', 'licence', 'deal_360', 'producer', 'beat_licence', 'feature',
    'co_publishing', 'management', 'collaboration', 'session', 'work_for_hire', 'mixing_mastering', 'nda')),
  CONSTRAINT contracts_status_check CHECK (status IN ('draft', 'sent', 'signed', 'void')),
  CONSTRAINT contracts_title_check CHECK (length(title) BETWEEN 1 AND 200),
  CONSTRAINT contracts_clauses_check CHECK (
    jsonb_typeof(clauses) = 'array' AND jsonb_array_length(clauses) BETWEEN 1 AND 60 AND length(clauses::text) <= 400000),
  CONSTRAINT contracts_fields_check CHECK (jsonb_typeof(fields) = 'object' AND length(fields::text) <= 20000),
  CONSTRAINT contracts_term_check CHECK (term_months IS NULL OR term_months BETWEEN 1 AND 1200),
  CONSTRAINT contracts_territories_check CHECK (public.labelos_territories_ok(territories)),
  CONSTRAINT contracts_note_check CHECK (internal_note IS NULL OR length(internal_note) <= 2000),
  CONSTRAINT contracts_reason_check CHECK (void_reason IS NULL OR length(void_reason) <= 500),
  CONSTRAINT contracts_version_check CHECK (version >= 1 AND template_version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_contracts_org_created ON public.contracts (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_artist ON public.contracts (org_id, artist_contact_id) WHERE artist_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_track ON public.contracts (track_id) WHERE track_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_release ON public.contracts (release_id) WHERE release_id IS NOT NULL;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

-- ── 3. contract_parties ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contract_parties (
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  party_id    uuid NOT NULL REFERENCES public.parties(id),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role        text NOT NULL,
  position    int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, party_id, role),
  CONSTRAINT contract_parties_role_check CHECK (role IN (
    'label', 'artist', 'featured', 'producer', 'manager', 'publisher', 'licensor', 'licensee',
    'collaborator', 'engineer', 'client', 'provider', 'disclosing', 'receiving'))
);

CREATE INDEX IF NOT EXISTS idx_contract_parties_party ON public.contract_parties (party_id);
CREATE INDEX IF NOT EXISTS idx_contract_parties_org ON public.contract_parties (org_id, contract_id);
ALTER TABLE public.contract_parties ENABLE ROW LEVEL SECURITY;

-- ── 4. Integrity triggers ────────────────────────────────────────────────

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

CREATE OR REPLACE FUNCTION public.contract_parties_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = NEW.contract_id AND c.org_id = NEW.org_id AND c.status = 'draft') THEN
    RAISE EXCEPTION 'contract_parties: parties are added to a draft contract of the same organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.parties p WHERE p.id = NEW.party_id AND p.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'contract_parties: the party belongs to another organization' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.contract_parties_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contract_parties_guard() FROM PUBLIC;

-- Once the contract has left draft its parties are as frozen as the rest of it:
-- no update, no delete. A cascade (the contract's or the org's deletion) runs
-- nested in the foreign key's own trigger (pg_trigger_depth() > 1) and passes.
CREATE OR REPLACE FUNCTION public.contract_parties_freeze()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() = 1 AND EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = OLD.contract_id AND c.status <> 'draft') THEN
    RAISE EXCEPTION 'contract_parties: the parties of a contract that has left draft are not changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
ALTER FUNCTION public.contract_parties_freeze() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contract_parties_freeze() FROM PUBLIC;

DROP TRIGGER IF EXISTS contract_parties_freeze ON public.contract_parties;
CREATE TRIGGER contract_parties_freeze BEFORE UPDATE OR DELETE ON public.contract_parties
  FOR EACH ROW EXECUTE FUNCTION public.contract_parties_freeze();

DROP TRIGGER IF EXISTS contract_parties_guard ON public.contract_parties;
CREATE TRIGGER contract_parties_guard BEFORE INSERT OR UPDATE ON public.contract_parties
  FOR EACH ROW EXECUTE FUNCTION public.contract_parties_guard();

-- API roles never write an org row; the routes use the service role.
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.contract_templates;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.contract_templates
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.contracts;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.contract_parties;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.contract_parties
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');

-- ── 5. Reads ─────────────────────────────────────────────────────────────
-- The caller's own contracts: ones that have left draft and name them, in an
-- org licensed for contracts. One call, no argument that varies by row.

CREATE OR REPLACE FUNCTION public.labelos_my_contracts()
RETURNS TABLE (contract_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.contracts c
  JOIN public.organizations o ON o.id = c.org_id AND o.deleted_at IS NULL AND o.kind IN ('label', 'artist')
  WHERE c.status <> 'draft'
    AND c.org_id IN (SELECT m.org_id FROM public.org_members m WHERE m.user_id = auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.org_entitlements e
      WHERE e.org_id = c.org_id AND NOT ('contracts' = ANY (coalesce(e.modules, '{}')))
    )
    AND (
      c.id IN (
        SELECT cp.contract_id
        FROM public.contract_parties cp
        JOIN public.parties p ON p.id = cp.party_id
        WHERE p.user_id = auth.uid()
      )
      OR (
        c.artist_contact_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = c.org_id AND m.user_id = auth.uid() AND m.role = 'artist')
        AND (c.org_id, c.artist_contact_id) IN (SELECT s.org_id, s.contact_id FROM public.member_artist_scopes s WHERE s.user_id = auth.uid())
      )
    );
$$;

ALTER FUNCTION public.labelos_my_contracts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_my_contracts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.labelos_my_contracts() TO authenticated, anon;

DROP POLICY IF EXISTS contract_templates_member_read ON public.contract_templates;
CREATE POLICY contract_templates_member_read ON public.contract_templates
  FOR SELECT
  USING (
    org_id IN (
      SELECT cm.org_id
      FROM public.org_members cm
      WHERE cm.user_id = (SELECT auth.uid())
        AND cm.role <> 'artist'
        AND public.has_org_cap(cm.org_id, 'contracts.read')
    )
  );

DROP POLICY IF EXISTS contracts_member_read ON public.contracts;
CREATE POLICY contracts_member_read ON public.contracts
  FOR SELECT
  USING (
    (
      org_id IN (
        SELECT cm.org_id
        FROM public.org_members cm
        WHERE cm.user_id = (SELECT auth.uid())
          AND cm.role <> 'artist'
          AND public.has_org_cap(cm.org_id, 'contracts.read')
      )
      AND (
        org_id IN (
          SELECT om.org_id
          FROM public.org_members om
          WHERE om.user_id = (SELECT auth.uid())
            AND om.scope = 'org'
            AND om.role <> 'artist'
        )
        OR (org_id, artist_contact_id) IN (SELECT s.org_id, s.contact_id FROM public.member_artist_scopes s WHERE s.user_id = (SELECT auth.uid()))
      )
    )
    OR id IN (SELECT mc.contract_id FROM public.labelos_my_contracts() mc)
  );

-- A contract's parties are readable exactly where the contract is.
DROP POLICY IF EXISTS contract_parties_member_read ON public.contract_parties;
CREATE POLICY contract_parties_member_read ON public.contract_parties
  FOR SELECT
  USING (
    org_id IN (SELECT mm.org_id FROM public.org_members mm WHERE mm.user_id = (SELECT auth.uid()))
    AND (org_id, contract_id) IN (SELECT c.org_id, c.id FROM public.contracts c)
  );

-- ── 6. Atomic create / edit of a draft ───────────────────────────────────
-- p_id NULL = create. p_row names only the columns to set (edit) or all of
-- them (create). p_parties NULL = leave the parties alone, else
-- [{ "party_id": uuid, "role": text, "position": int }, …] replaces them.
-- Errors: 'not_found' (no such contract in the org), 'not_draft'.

CREATE OR REPLACE FUNCTION public.labelos_contract_save(
  p_org uuid,
  p_actor uuid,
  p_id uuid,
  p_row jsonb,
  p_parties jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  v_status text;
  v_terr text[];
BEGIN
  IF v_id IS NULL THEN
    INSERT INTO public.contracts (org_id, type, title, template_id, template_source, template_version, clauses, created_by)
    VALUES (p_org, p_row ->> 'type', p_row ->> 'title', nullif(p_row ->> 'template_id', '')::uuid,
            p_row ->> 'template_source', coalesce((p_row ->> 'template_version')::int, 1), p_row -> 'clauses', p_actor)
    RETURNING id INTO v_id;
  ELSE
    SELECT c.status INTO v_status FROM public.contracts c WHERE c.id = v_id AND c.org_id = p_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    IF v_status <> 'draft' THEN RAISE EXCEPTION 'not_draft' USING ERRCODE = 'check_violation'; END IF;
  END IF;

  IF p_row ? 'territories' THEN
    v_terr := CASE WHEN jsonb_typeof(p_row -> 'territories') = 'array'
                   THEN ARRAY(SELECT jsonb_array_elements_text(p_row -> 'territories')) END;
  END IF;

  UPDATE public.contracts c SET
    title             = CASE WHEN p_row ? 'title' THEN p_row ->> 'title' ELSE c.title END,
    artist_contact_id = CASE WHEN p_row ? 'artist_contact_id' THEN nullif(p_row ->> 'artist_contact_id', '')::uuid ELSE c.artist_contact_id END,
    track_id          = CASE WHEN p_row ? 'track_id' THEN nullif(p_row ->> 'track_id', '')::uuid ELSE c.track_id END,
    release_id        = CASE WHEN p_row ? 'release_id' THEN nullif(p_row ->> 'release_id', '')::uuid ELSE c.release_id END,
    effective_date    = CASE WHEN p_row ? 'effective_date' THEN nullif(p_row ->> 'effective_date', '')::date ELSE c.effective_date END,
    term_months       = CASE WHEN p_row ? 'term_months' THEN nullif(p_row ->> 'term_months', '')::int ELSE c.term_months END,
    territories       = CASE WHEN p_row ? 'territories' THEN v_terr ELSE c.territories END,
    fields            = CASE WHEN p_row ? 'fields' THEN coalesce(p_row -> 'fields', '{}'::jsonb) ELSE c.fields END,
    internal_note     = CASE WHEN p_row ? 'internal_note' THEN nullif(p_row ->> 'internal_note', '') ELSE c.internal_note END,
    updated_at        = now()
  WHERE c.id = v_id AND c.org_id = p_org;

  IF p_parties IS NOT NULL THEN
    DELETE FROM public.contract_parties WHERE contract_id = v_id AND org_id = p_org;
    INSERT INTO public.contract_parties (contract_id, party_id, org_id, role, position)
    SELECT v_id, (e ->> 'party_id')::uuid, p_org, e ->> 'role', coalesce((e ->> 'position')::int, 0)
    FROM jsonb_array_elements(p_parties) AS e;
  END IF;

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.labelos_contract_save(uuid, uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_contract_save(uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_contract_save(uuid, uuid, uuid, jsonb, jsonb) TO service_role;

-- ── 7. Voiding is an audit act ───────────────────────────────────────────
-- A void contract is final and a signed one may be voided: the status change
-- and its `contract.voided` event commit together (the 146 pattern).
-- Answers { error: 'not_found' | 'already_void' } or { voided: true, from }.

CREATE OR REPLACE FUNCTION public.labelos_audit_contract_void(
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
  v_row public.contracts%ROWTYPE;
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

  SELECT * INTO v_row FROM public.contracts WHERE id = p_contract AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_row.status = 'void' THEN
    RETURN jsonb_build_object('error', 'already_void');
  END IF;

  UPDATE public.contracts
  SET status = 'void', voided_by = p_actor, voided_at = now(), void_reason = NULLIF(p_reason, '')
  WHERE id = p_contract;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, song_id, release_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'contract.voided', 'contract', v_row.id, v_row.artist_contact_id, v_row.track_id, v_row.release_id,
          p_payload || jsonb_build_object('from', v_row.status), true, 'internal');

  RETURN jsonb_build_object('voided', true, 'from', v_row.status);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_contract_void(uuid, uuid, uuid, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_contract_void(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_contract_void(uuid, uuid, uuid, text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
