-- 180_labelos_earnings.sql
-- Label OS (LABEL-62): earnings import and royalty calculation.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch into
-- main, after 179 (it extends 179's earnings_lines and uses its guards and
-- policies' shape). Never part of supabase/apply/pending.sql.
--
-- What this adds to 179's finance record:
--   earnings_lines     + song_track_id (the song the matched recording belongs to),
--                      + income_class (master | publishing), + review_reason (why a
--                      line is waiting in the needs-review queue; NULL = fully
--                      allocated). The freeze now lets track_id, song_track_id and
--                      review_reason change (resolving a line); nothing else.
--   earnings_allocations  one row per (line, payee): what the payee is owed
--                      (payable_minor) and on what basis. basis 'split' = gross × the
--                      payee's share on the song's split sheet in force; basis 'rate' =
--                      gross × the royalty rate of a SIGNED contract that covers the
--                      payee and the song, and the split sheet is NOT applied to that
--                      payee (orchestrator decision 2026-11-02, owner may change).
--                      units = the share or the rate (100 % = 1 000 000). The payees of a
--                      line never add up to more than the line, checked here; whatever
--                      is left is retained by the label (gross − Σ payable, derived).
--   earnings_recoupments  how much of an allocation's payable was taken against which
--                      advance. Never more than the advance has left, never more than
--                      the allocation's payable, never from a non-recoupable or void
--                      advance — all checked under a per-org lock.
--   labelos_earnings_import()   the whole import (header, lines, allocations,
--                      recoupments) in ONE transaction, idempotent by file hash.
--   labelos_earnings_resolve()  re-run of lines that were waiting for review.
--
-- Money: bigint minor units + char(3) currency. No numeric / float anywhere. The
-- arithmetic (matching, allocation, rate, recoupment) is done in TypeScript
-- (lib/labelos/finance/earnings-*.ts) with the integer helpers of money.ts; this
-- file stores the result and re-checks the invariants that must never be false.
--
-- Reads (RLS, uncorrelated hashed subplans, R-08): allocations and recoupments:
-- `finance.read` (never role artist) AND (a whole-org member OR the payee's artist
-- is in the member's member_artist_scopes). A roster artist reads none of it
-- (their statements arrive with LABEL-63). Lines and imports keep 179's whole-org
-- rule; the needs-review queue a scoped member sees is built by the route.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP … IF EXISTS first.
-- Rollback: supabase/rollback/180_labelos_earnings.down.sql.

-- ── 1. earnings_lines: income class, song, review reason ─────────────────

ALTER TABLE public.earnings_lines ADD COLUMN IF NOT EXISTS song_track_id uuid REFERENCES public.tracks(id) ON DELETE SET NULL;
ALTER TABLE public.earnings_lines ADD COLUMN IF NOT EXISTS income_class text NOT NULL DEFAULT 'master';
ALTER TABLE public.earnings_lines ADD COLUMN IF NOT EXISTS review_reason text;

ALTER TABLE public.earnings_lines DROP CONSTRAINT IF EXISTS earnings_lines_income_class_check;
ALTER TABLE public.earnings_lines ADD CONSTRAINT earnings_lines_income_class_check CHECK (income_class IN ('master', 'publishing'));
ALTER TABLE public.earnings_lines DROP CONSTRAINT IF EXISTS earnings_lines_review_reason_check;
ALTER TABLE public.earnings_lines ADD CONSTRAINT earnings_lines_review_reason_check CHECK (
  review_reason IS NULL OR review_reason IN (
    'no_identifier', 'no_match', 'ambiguous_match', 'no_song', 'no_sheet', 'bad_split',
    'no_payee', 'payee_inactive', 'currency_mismatch', 'contract_ambiguous', 'terms_exceed_gross'));

CREATE INDEX IF NOT EXISTS idx_earnings_lines_review ON public.earnings_lines (org_id, import_id) WHERE review_reason IS NOT NULL;

-- Only the match and the review reason can change (a recording deleted nulls track_id / song_track_id by FK).
DROP TRIGGER IF EXISTS earnings_lines_frozen ON public.earnings_lines;
CREATE TRIGGER earnings_lines_frozen BEFORE UPDATE OR DELETE ON public.earnings_lines
  FOR EACH ROW EXECUTE FUNCTION public.labelos_finance_frozen('track_id', 'song_track_id', 'review_reason');

CREATE OR REPLACE FUNCTION public.earnings_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_imp public.earnings_imports%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_imp FROM public.earnings_imports i WHERE i.id = NEW.import_id AND i.org_id = NEW.org_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'earnings_lines: the import belongs to another organization' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.currency <> v_imp.currency THEN
      RAISE EXCEPTION 'earnings_lines: a line is in its import''s currency' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.track_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.track_id IS DISTINCT FROM OLD.track_id)
     AND NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.track_id AND t.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'earnings_lines: the recording belongs to another organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.song_track_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.song_track_id IS DISTINCT FROM OLD.song_track_id)
     AND NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.song_track_id AND t.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'earnings_lines: the song belongs to another organization' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.earnings_lines_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.earnings_lines_guard() FROM PUBLIC;

GRANT SELECT (song_track_id, income_class, review_reason) ON public.earnings_lines TO authenticated;

-- ── 2. earnings_allocations ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.earnings_allocations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id         uuid NOT NULL REFERENCES public.earnings_imports(id),
  line_id           uuid NOT NULL REFERENCES public.earnings_lines(id),
  payee_id          uuid NOT NULL REFERENCES public.payees(id),
  party_id          uuid NOT NULL REFERENCES public.parties(id),
  artist_contact_id uuid REFERENCES public.contacts(id),
  song_track_id     uuid NOT NULL REFERENCES public.tracks(id),
  kind              text NOT NULL,
  sheet_id          uuid NOT NULL REFERENCES public.split_sheets(id),
  contract_id       uuid REFERENCES public.contracts(id),
  basis             text NOT NULL,
  units             int NOT NULL,
  payable_minor     bigint NOT NULL,
  currency          char(3) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT earnings_allocations_kind_check CHECK (kind IN ('master', 'composition')),
  CONSTRAINT earnings_allocations_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT earnings_allocations_basis_check CHECK (basis IN ('split', 'rate')),
  CONSTRAINT earnings_allocations_units_check CHECK (units BETWEEN 0 AND 1000000),
  CONSTRAINT earnings_allocations_basis_contract_check CHECK ((basis = 'rate') = (contract_id IS NOT NULL)),
  CONSTRAINT earnings_allocations_one_per_payee UNIQUE (line_id, payee_id)
);

CREATE INDEX IF NOT EXISTS idx_earnings_allocations_import ON public.earnings_allocations (org_id, import_id);
CREATE INDEX IF NOT EXISTS idx_earnings_allocations_payee ON public.earnings_allocations (org_id, payee_id);
ALTER TABLE public.earnings_allocations ENABLE ROW LEVEL SECURITY;

-- ── 3. earnings_recoupments ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.earnings_recoupments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id     uuid NOT NULL REFERENCES public.earnings_imports(id),
  allocation_id uuid NOT NULL REFERENCES public.earnings_allocations(id),
  payee_id      uuid NOT NULL REFERENCES public.payees(id),
  advance_id    uuid NOT NULL REFERENCES public.advances(id),
  amount_minor  bigint NOT NULL,
  currency      char(3) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT earnings_recoupments_amount_check CHECK (amount_minor > 0),
  CONSTRAINT earnings_recoupments_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT earnings_recoupments_one UNIQUE (allocation_id, advance_id)
);

CREATE INDEX IF NOT EXISTS idx_earnings_recoupments_advance ON public.earnings_recoupments (advance_id);
CREATE INDEX IF NOT EXISTS idx_earnings_recoupments_import ON public.earnings_recoupments (org_id, import_id);
ALTER TABLE public.earnings_recoupments ENABLE ROW LEVEL SECURITY;

-- ── 4. Integrity triggers ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.earnings_allocations_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line  public.earnings_lines%ROWTYPE;
  v_payee public.payees%ROWTYPE;
BEGIN
  SELECT * INTO v_line FROM public.earnings_lines l WHERE l.id = NEW.line_id AND l.org_id = NEW.org_id AND l.import_id = NEW.import_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'earnings_allocations: the line belongs to another organization or import' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_payee FROM public.payees p WHERE p.id = NEW.payee_id AND p.org_id = NEW.org_id AND p.party_id = NEW.party_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'earnings_allocations: the payee belongs to another organization or is not that party''s' USING ERRCODE = 'check_violation';
  END IF;
  -- Never mixed currencies: the payee is paid in one currency, the line arrived in one, and they are the same.
  IF NEW.currency <> v_line.currency OR NEW.currency <> v_payee.currency THEN
    RAISE EXCEPTION 'earnings_allocations: currencies are never mixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.song_track_id AND t.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'earnings_allocations: the song belongs to another organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.split_sheets s WHERE s.id = NEW.sheet_id AND s.org_id = NEW.org_id AND s.track_id = NEW.song_track_id AND s.kind = NEW.kind) THEN
    RAISE EXCEPTION 'earnings_allocations: the split sheet is not this song''s % sheet', NEW.kind USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.contract_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = NEW.contract_id AND c.org_id = NEW.org_id AND c.status = 'signed') THEN
    RAISE EXCEPTION 'earnings_allocations: only a signed contract of this organization sets a rate' USING ERRCODE = 'check_violation';
  END IF;
  NEW.artist_contact_id := v_payee.artist_contact_id;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.earnings_allocations_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.earnings_allocations_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS earnings_allocations_guard ON public.earnings_allocations;
CREATE TRIGGER earnings_allocations_guard BEFORE INSERT ON public.earnings_allocations
  FOR EACH ROW EXECUTE FUNCTION public.earnings_allocations_guard();
DROP TRIGGER IF EXISTS earnings_allocations_frozen ON public.earnings_allocations;
CREATE TRIGGER earnings_allocations_frozen BEFORE UPDATE OR DELETE ON public.earnings_allocations
  FOR EACH ROW EXECUTE FUNCTION public.labelos_finance_frozen();

CREATE OR REPLACE FUNCTION public.earnings_recoupments_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alloc public.earnings_allocations%ROWTYPE;
  v_adv   public.advances%ROWTYPE;
BEGIN
  SELECT * INTO v_alloc FROM public.earnings_allocations a WHERE a.id = NEW.allocation_id AND a.org_id = NEW.org_id AND a.import_id = NEW.import_id AND a.payee_id = NEW.payee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'earnings_recoupments: the allocation is not this payee''s in this organization' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_adv FROM public.advances d WHERE d.id = NEW.advance_id AND d.org_id = NEW.org_id AND d.payee_id = NEW.payee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'earnings_recoupments: the advance is not this payee''s in this organization' USING ERRCODE = 'check_violation';
  END IF;
  IF v_adv.kind <> 'recoupable' OR v_adv.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'earnings_recoupments: only a live recoupable advance is recouped' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.currency <> v_adv.currency OR NEW.currency <> v_alloc.currency THEN
    RAISE EXCEPTION 'earnings_recoupments: currencies are never mixed' USING ERRCODE = 'check_violation';
  END IF;
  IF v_alloc.payable_minor <= 0 THEN
    RAISE EXCEPTION 'earnings_recoupments: only positive earnings are recouped' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount_minor + coalesce((SELECT sum(r.amount_minor) FROM public.earnings_recoupments r WHERE r.allocation_id = NEW.allocation_id), 0) > v_alloc.payable_minor THEN
    RAISE EXCEPTION 'earnings_recoupments: recoup_exceeds_earnings' USING ERRCODE = 'serialization_failure';
  END IF;
  IF NEW.amount_minor + coalesce((SELECT sum(r.amount_minor) FROM public.earnings_recoupments r WHERE r.advance_id = NEW.advance_id), 0) > v_adv.amount_minor THEN
    RAISE EXCEPTION 'earnings_recoupments: recoup_exceeds_advance' USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.earnings_recoupments_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.earnings_recoupments_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS earnings_recoupments_guard ON public.earnings_recoupments;
CREATE TRIGGER earnings_recoupments_guard BEFORE INSERT ON public.earnings_recoupments
  FOR EACH ROW EXECUTE FUNCTION public.earnings_recoupments_guard();
DROP TRIGGER IF EXISTS earnings_recoupments_frozen ON public.earnings_recoupments;
CREATE TRIGGER earnings_recoupments_frozen BEFORE UPDATE OR DELETE ON public.earnings_recoupments
  FOR EACH ROW EXECUTE FUNCTION public.labelos_finance_frozen();

DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.earnings_allocations;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.earnings_allocations
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.earnings_recoupments;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.earnings_recoupments
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');

-- ── 5. Reads ─────────────────────────────────────────────────────────────

REVOKE ALL ON public.earnings_allocations, public.earnings_recoupments FROM anon, authenticated;
GRANT SELECT (id, org_id, import_id, line_id, payee_id, party_id, artist_contact_id, song_track_id, kind, sheet_id, contract_id, basis, units, payable_minor, currency, created_at)
  ON public.earnings_allocations TO authenticated;
GRANT SELECT (id, org_id, import_id, allocation_id, payee_id, advance_id, amount_minor, currency, created_at)
  ON public.earnings_recoupments TO authenticated;

DROP POLICY IF EXISTS earnings_allocations_member_read ON public.earnings_allocations;
CREATE POLICY earnings_allocations_member_read ON public.earnings_allocations
  FOR SELECT
  USING (
    org_id IN (
      SELECT cm.org_id FROM public.org_members cm
      WHERE cm.user_id = (SELECT auth.uid()) AND cm.role <> 'artist' AND public.has_org_cap(cm.org_id, 'finance.read')
    )
    AND (
      org_id IN (SELECT om.org_id FROM public.org_members om WHERE om.user_id = (SELECT auth.uid()) AND om.scope = 'org' AND om.role <> 'artist')
      OR (org_id, artist_contact_id) IN (SELECT s.org_id, s.contact_id FROM public.member_artist_scopes s WHERE s.user_id = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS earnings_recoupments_member_read ON public.earnings_recoupments;
CREATE POLICY earnings_recoupments_member_read ON public.earnings_recoupments
  FOR SELECT
  USING (
    org_id IN (
      SELECT cm.org_id FROM public.org_members cm
      WHERE cm.user_id = (SELECT auth.uid()) AND cm.role <> 'artist' AND public.has_org_cap(cm.org_id, 'finance.read')
    )
    AND (
      org_id IN (SELECT om.org_id FROM public.org_members om WHERE om.user_id = (SELECT auth.uid()) AND om.scope = 'org' AND om.role <> 'artist')
      OR payee_id IN (
        SELECT p.id FROM public.payees p
        WHERE (p.org_id, p.artist_contact_id) IN (SELECT s.org_id, s.contact_id FROM public.member_artist_scopes s WHERE s.user_id = (SELECT auth.uid())))
    )
  );

-- ── 6. The write functions (service role only) ───────────────────────────

-- Allocations and recoupments of lines that already exist. Both arrays name `line_id`.
-- Re-checks the two invariants that must never be false: the allocations of a line sum to
-- the line's gross, and an allocation's payable never exceeds its share (the CHECKs).
CREATE OR REPLACE FUNCTION public.labelos_earnings_write(p_org uuid, p_import uuid, p_allocs jsonb, p_recoups jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bad uuid;
  v_n   int;
BEGIN
  INSERT INTO public.earnings_allocations
    (org_id, import_id, line_id, payee_id, party_id, song_track_id, kind, sheet_id, contract_id, basis, units, payable_minor, currency)
  SELECT p_org, p_import, x.line_id, x.payee_id, x.party_id, x.song_track_id, x.kind, x.sheet_id, x.contract_id, x.basis, x.units, x.payable_minor, l.currency
  FROM jsonb_to_recordset(coalesce(p_allocs, '[]'::jsonb)) AS x(
    line_id uuid, payee_id uuid, party_id uuid, song_track_id uuid, kind text, sheet_id uuid, contract_id uuid,
    basis text, units int, payable_minor bigint)
  JOIN public.earnings_lines l ON l.id = x.line_id AND l.org_id = p_org AND l.import_id = p_import;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- An entry that names no line of this import is a caller bug, never silently dropped.
  IF v_n <> jsonb_array_length(coalesce(p_allocs, '[]'::jsonb)) THEN
    RAISE EXCEPTION 'earnings: an allocation names a line that is not in this import' USING ERRCODE = 'check_violation';
  END IF;

  -- The payees of a line are never paid more than the line, and never with the opposite sign. What is left is
  -- the label's. (Orchestrator decision: a line whose terms exceed 100 % waits in the review queue instead.)
  SELECT l.id INTO v_bad
  FROM public.earnings_lines l
  JOIN (SELECT a.line_id, sum(a.payable_minor) AS s, min(a.payable_minor) AS lo, max(a.payable_minor) AS hi
          FROM public.earnings_allocations a WHERE a.import_id = p_import GROUP BY a.line_id) t ON t.line_id = l.id
  WHERE l.import_id = p_import
    AND (abs(t.s) > abs(l.gross_minor)
         OR (l.gross_minor >= 0 AND t.lo < 0)
         OR (l.gross_minor <= 0 AND t.hi > 0))
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'earnings: allocation_mismatch — the payees of a line are owed more than the line' USING ERRCODE = 'check_violation';
  END IF;
  -- A line is either waiting for review or allocated, never both.
  IF EXISTS (SELECT 1 FROM public.earnings_lines l WHERE l.import_id = p_import AND l.review_reason IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.earnings_allocations a WHERE a.line_id = l.id)) THEN
    RAISE EXCEPTION 'earnings: a line waiting for review cannot be allocated' USING ERRCODE = 'check_violation';
  END IF;

  -- A line that is not waiting for review is allocated: at least one allocation (a zero line has zero shares, but rows).
  IF EXISTS (SELECT 1 FROM public.earnings_lines l WHERE l.import_id = p_import AND l.org_id = p_org AND l.review_reason IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.earnings_allocations a WHERE a.line_id = l.id)) THEN
    RAISE EXCEPTION 'earnings: a line with no review reason has no allocation' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.earnings_recoupments (org_id, import_id, allocation_id, payee_id, advance_id, amount_minor, currency)
  SELECT p_org, p_import, a.id, a.payee_id, x.advance_id, x.amount_minor, a.currency
  FROM jsonb_to_recordset(coalesce(p_recoups, '[]'::jsonb)) AS x(line_id uuid, payee_id uuid, advance_id uuid, amount_minor bigint)
  JOIN public.earnings_allocations a ON a.line_id = x.line_id AND a.payee_id = x.payee_id AND a.import_id = p_import AND a.org_id = p_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> jsonb_array_length(coalesce(p_recoups, '[]'::jsonb)) THEN
    RAISE EXCEPTION 'earnings: a recoupment names an allocation that does not exist' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

ALTER FUNCTION public.labelos_earnings_write(uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_earnings_write(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- The whole import in one transaction. Returns {id, created}: created=false means this file
-- (this org + SHA-256) was imported before and NOTHING was written.
CREATE OR REPLACE FUNCTION public.labelos_earnings_import(p_org uuid, p_user uuid, p_import jsonb, p_lines jsonb, p_allocs jsonb, p_recoups jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    uuid;
  v_total bigint;
  v_n     int;
  v_allocs  jsonb;
  v_recoups jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_org AND o.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'earnings: the organization does not exist' USING ERRCODE = 'check_violation';
  END IF;
  -- One import or re-run at a time per organization: recoupment reads what earlier imports already took.
  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.earnings:' || p_org::text, 0));

  SELECT i.id INTO v_id FROM public.earnings_imports i WHERE i.org_id = p_org AND i.file_sha256 = p_import ->> 'file_sha256';
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_id, 'created', false);
  END IF;

  IF nullif(p_import ->> 'period_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.finance_periods fp WHERE fp.id = (p_import ->> 'period_id')::uuid AND fp.org_id = p_org AND fp.status = 'open') THEN
    RAISE EXCEPTION 'earnings: period_closed — that period is not open' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.earnings_imports (org_id, period_id, source, file_name, file_sha256, currency, row_count, total_minor, imported_by)
  VALUES (p_org, nullif(p_import ->> 'period_id', '')::uuid, p_import ->> 'source', nullif(p_import ->> 'file_name', ''), p_import ->> 'file_sha256',
          p_import ->> 'currency', (p_import ->> 'row_count')::int, (p_import ->> 'total_minor')::bigint, p_user)
  RETURNING id INTO v_id;

  INSERT INTO public.earnings_lines
    (org_id, import_id, line_no, isrc, upc, track_id, song_track_id, title, store, territory, units, gross_minor, currency, period_start, period_end, income_class, review_reason)
  SELECT p_org, v_id, x.line_no, x.isrc, x.upc, x.track_id, x.song_track_id, x.title, x.store, x.territory, x.units, x.gross_minor, x.currency, x.period_start, x.period_end, x.income_class, x.review_reason
  FROM jsonb_to_recordset(p_lines) AS x(
    line_no int, isrc text, upc text, track_id uuid, song_track_id uuid, title text, store text, territory text, units bigint,
    gross_minor bigint, currency text, period_start date, period_end date, income_class text, review_reason text);

  SELECT count(*), coalesce(sum(l.gross_minor), 0) INTO v_n, v_total FROM public.earnings_lines l WHERE l.import_id = v_id;
  IF v_n <> (p_import ->> 'row_count')::int OR v_total <> (p_import ->> 'total_minor')::bigint THEN
    RAISE EXCEPTION 'earnings: the lines do not add up to the import header' USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(jsonb_agg(a.value || jsonb_build_object('line_id', l.id)), '[]'::jsonb) INTO v_allocs
  FROM jsonb_array_elements(coalesce(p_allocs, '[]'::jsonb)) a(value)
  JOIN public.earnings_lines l ON l.import_id = v_id AND l.line_no = (a.value ->> 'line_no')::int;
  SELECT coalesce(jsonb_agg(a.value || jsonb_build_object('line_id', l.id)), '[]'::jsonb) INTO v_recoups
  FROM jsonb_array_elements(coalesce(p_recoups, '[]'::jsonb)) a(value)
  JOIN public.earnings_lines l ON l.import_id = v_id AND l.line_no = (a.value ->> 'line_no')::int;

  -- A line number that is not in the file is a caller bug: refuse it rather than drop it.
  IF jsonb_array_length(v_allocs) <> jsonb_array_length(coalesce(p_allocs, '[]'::jsonb))
     OR jsonb_array_length(v_recoups) <> jsonb_array_length(coalesce(p_recoups, '[]'::jsonb)) THEN
    RAISE EXCEPTION 'earnings: an allocation names a line that is not in this import' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.labelos_earnings_write(p_org, v_id, v_allocs, v_recoups);
  RETURN jsonb_build_object('id', v_id, 'created', true);
END;
$$;

ALTER FUNCTION public.labelos_earnings_import(uuid, uuid, jsonb, jsonb, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_earnings_import(uuid, uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_earnings_import(uuid, uuid, jsonb, jsonb, jsonb, jsonb) TO service_role;

-- Re-run of lines that were waiting for review: p_lines = [{line_id, track_id, song_track_id, review_reason}].
-- Only a line that still has a review reason can be touched.
CREATE OR REPLACE FUNCTION public.labelos_earnings_resolve(p_org uuid, p_import uuid, p_lines jsonb, p_allocs jsonb, p_recoups jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  x record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.earnings:' || p_org::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.earnings_imports i WHERE i.id = p_import AND i.org_id = p_org) THEN
    RAISE EXCEPTION 'earnings: the import belongs to another organization' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.earnings_imports i WHERE i.id = p_import AND i.status <> 'imported') THEN
    RAISE EXCEPTION 'earnings: import_void — a void import takes no allocations' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.earnings_imports i JOIN public.finance_periods fp ON fp.id = i.period_id WHERE i.id = p_import AND fp.status <> 'open') THEN
    RAISE EXCEPTION 'earnings: period_closed — that period is not open' USING ERRCODE = 'check_violation';
  END IF;
  FOR x IN SELECT * FROM jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) AS t(line_id uuid, track_id uuid, song_track_id uuid, review_reason text) LOOP
    UPDATE public.earnings_lines l
       SET track_id = x.track_id, song_track_id = x.song_track_id, review_reason = x.review_reason
     WHERE l.id = x.line_id AND l.org_id = p_org AND l.import_id = p_import AND l.review_reason IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'earnings: line_not_waiting — that line is no longer waiting for review' USING ERRCODE = 'serialization_failure';
    END IF;
  END LOOP;
  PERFORM public.labelos_earnings_write(p_org, p_import, p_allocs, p_recoups);
END;
$$;

ALTER FUNCTION public.labelos_earnings_resolve(uuid, uuid, jsonb, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_earnings_resolve(uuid, uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_earnings_resolve(uuid, uuid, jsonb, jsonb, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
