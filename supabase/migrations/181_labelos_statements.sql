-- 181_labelos_statements.sql
-- Label OS (LABEL-63): statements and payment tracking.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch into
-- main, after 179 and 180. Never part of supabase/apply/pending.sql.
--
-- NO NEW TABLE. 179 already holds statements, statement_lines and payments and 180
-- holds the allocations and recoupments a statement is made of. This file adds the
-- rules and the atomic functions around them. THE APP NEVER MOVES MONEY: a payment
-- is a record of something somebody did elsewhere.
--
-- What a statement is: for ONE payee and ONE period, one 'earning' line per
-- allocation of that payee on an import of that period (not void), and one
-- 'recoupment' line (negative) per recoupment 180 already took against those
-- allocations. Nothing is recomputed and nothing is recouped again: the lines
-- are COPIED from earnings_allocations / earnings_recoupments, and
-- labelos_statement_sources_ok() proves it, on generation and again on
-- approval — the lines are exactly the sources, one to one, amount for amount,
-- and net_minor is their sum. A statement is in the payee's currency; an
-- allocation in another currency cannot exist (180), so none can appear.
--
-- Lifecycle (the guards from 179 stay): draft → approved → issued, any → void.
--   generate  replaces ONLY a draft of the same payee + period; an approved or
--             issued statement is a conflict; a closed period cannot get a draft
--             (179's statements_guard).
--   approve   `finance.approve` (the route). APPEND-ONLY: approved_by / approved_at
--             are written once (179's guard). THE RULE: the approver may not be the
--             person who generated the draft (statements.created_by) — unless that
--             person is an OWNER of the organization. Re-checked here under the row
--             lock. A draft whose sources moved since it was generated (an import
--             voided, lines re-run) is 'stale' and is regenerated, never approved.
--   issue     approved → issued; from then it is frozen (179) and the roster artist
--             whose payee it is can read it (179's policies).
--   void      draft / approved / issued → void, with a reason; refused while a
--             payment is recorded against it. Frees its allocations for a new draft.
--   payments  recorded against an ISSUED statement of the same payee; partial
--             payments are allowed; the sum of live payments never exceeds the
--             statement's net (a trigger, under the statement's row lock). "Paid" is
--             derived (sum of live payments = net), not a status.
--
-- Voiding an import (180's earnings_imports.status = 'void'): only while no
-- APPROVED or ISSUED statement includes one of its lines; it releases the
-- import's allocations and recoupments (so the advances they recouped are
-- available again) and discards the DRAFT statements that included them — all in
-- one transaction with its audit event. 180's rows are normally never deleted;
-- labelos_finance_frozen() learns exactly one exception: this function sets a
-- transaction-local flag naming the import.
--
-- Also: an allocation can no longer be written into a payee + period whose
-- statement has left draft (it would be money owed that no statement carries).
--
-- Events (audit, internal; payloads name ids and counts, never amounts or names):
-- statement.generated | approved | issued | voided, payment.recorded | voided,
-- earnings.import_voided — written by the functions below in the same transaction.
--
-- Idempotent: CREATE OR REPLACE, DROP … IF EXISTS first.
-- Rollback: supabase/rollback/181_labelos_statements.down.sql.

-- ── 0. The one exception to "allocations are never deleted" ──────────────

CREATE OR REPLACE FUNCTION public.labelos_finance_frozen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a jsonb;
  b jsonb;
  u text;
  i int := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- 181: the void-import function releases an import's allocations and recoupments, naming the import in a
    -- transaction-local setting. Nothing else is ever deleted.
    IF TG_TABLE_NAME IN ('earnings_allocations', 'earnings_recoupments')
       AND nullif(current_setting('labelos.voiding_import', true), '') IS NOT NULL
       AND current_setting('labelos.voiding_import', true) = (to_jsonb(OLD) ->> 'import_id') THEN
      RETURN OLD;
    END IF;
    IF NOT public.labelos_finance_org_gone(OLD.org_id) THEN
      RAISE EXCEPTION '%: rows are never deleted (void them instead)', TG_TABLE_NAME USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  a := to_jsonb(OLD);
  b := to_jsonb(NEW);
  FOREACH u IN ARRAY ARRAY['created_by', 'imported_by', 'recorded_by', 'approved_by', 'voided_by', 'closed_by'] LOOP
    IF a ->> u IS NOT NULL AND b ? u AND b ->> u IS NULL THEN
      a := a - u;
      b := b - u;
    END IF;
  END LOOP;
  WHILE i < TG_NARGS LOOP
    a := a - TG_ARGV[i];
    b := b - TG_ARGV[i];
    i := i + 1;
  END LOOP;
  IF a <> b THEN
    RAISE EXCEPTION '%: this record is fixed once written; only % may change', TG_TABLE_NAME, array_to_string(TG_ARGV, ', ')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.labelos_finance_frozen() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_finance_frozen() FROM PUBLIC;

-- ── 1. Guards ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_statement_lines_source ON public.statement_lines (earnings_line_id) WHERE earnings_line_id IS NOT NULL;

-- A source (an allocation, or a recoupment) sits on at most ONE live statement of its payee, so
-- an advance can never be recouped twice and an earning never paid twice.
CREATE OR REPLACE FUNCTION public.statement_lines_source_once()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payee uuid;
BEGIN
  IF NEW.earnings_line_id IS NULL OR NEW.kind NOT IN ('earning', 'recoupment') THEN
    RETURN NEW;
  END IF;
  SELECT s.payee_id INTO v_payee FROM public.statements s WHERE s.id = NEW.statement_id;
  IF EXISTS (
    SELECT 1
    FROM public.statement_lines l2
    JOIN public.statements s2 ON s2.id = l2.statement_id
    WHERE l2.earnings_line_id = NEW.earnings_line_id
      AND l2.kind = NEW.kind
      AND l2.advance_id IS NOT DISTINCT FROM NEW.advance_id
      AND s2.payee_id = v_payee
      AND s2.status <> 'void'
  ) THEN
    RAISE EXCEPTION 'statement_lines: already_on_statement — that earning or recoupment is already on a live statement' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.statement_lines_source_once() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.statement_lines_source_once() FROM PUBLIC;
DROP TRIGGER IF EXISTS statement_lines_source_once ON public.statement_lines;
CREATE TRIGGER statement_lines_source_once BEFORE INSERT ON public.statement_lines
  FOR EACH ROW EXECUTE FUNCTION public.statement_lines_source_once();

-- An allocation is not written into a payee + period whose statement has left draft.
CREATE OR REPLACE FUNCTION public.earnings_allocations_statement_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period uuid;
BEGIN
  SELECT i.period_id INTO v_period FROM public.earnings_imports i WHERE i.id = NEW.import_id;
  IF v_period IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.statements s
    WHERE s.payee_id = NEW.payee_id AND s.period_id = v_period AND s.status IN ('approved', 'issued')
  ) THEN
    RAISE EXCEPTION 'earnings_allocations: statement_exists — this payee already has an approved or issued statement for that reporting window' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.earnings_allocations_statement_lock() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.earnings_allocations_statement_lock() FROM PUBLIC;
DROP TRIGGER IF EXISTS earnings_allocations_statement_lock ON public.earnings_allocations;
CREATE TRIGGER earnings_allocations_statement_lock BEFORE INSERT ON public.earnings_allocations
  FOR EACH ROW EXECUTE FUNCTION public.earnings_allocations_statement_lock();

-- The sum of a statement's live payments never exceeds its net (under the statement's row lock).
CREATE OR REPLACE FUNCTION public.payments_total_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_net  bigint;
  v_paid numeric;
BEGIN
  IF NEW.statement_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT s.net_minor INTO v_net FROM public.statements s WHERE s.id = NEW.statement_id FOR UPDATE;
  SELECT coalesce(sum(p.amount_minor), 0) INTO v_paid FROM public.payments p WHERE p.statement_id = NEW.statement_id AND p.voided_at IS NULL;
  IF v_paid + NEW.amount_minor > v_net THEN
    RAISE EXCEPTION 'payments: exceeds_net — payments cannot add up to more than the statement' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.payments_total_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.payments_total_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS payments_total_guard ON public.payments;
CREATE TRIGGER payments_total_guard BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_total_guard();

-- A statement with a live payment is not voided: void the payment first.
CREATE OR REPLACE FUNCTION public.statements_void_needs_no_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'void' AND OLD.status <> 'void'
     AND EXISTS (SELECT 1 FROM public.payments p WHERE p.statement_id = OLD.id AND p.voided_at IS NULL) THEN
    RAISE EXCEPTION 'statements: has_payments — void the recorded payments first' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.statements_void_needs_no_payments() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.statements_void_needs_no_payments() FROM PUBLIC;
DROP TRIGGER IF EXISTS statements_void_needs_no_payments ON public.statements;
CREATE TRIGGER statements_void_needs_no_payments BEFORE UPDATE ON public.statements
  FOR EACH ROW EXECUTE FUNCTION public.statements_void_needs_no_payments();

-- ── 2. Helpers ───────────────────────────────────────────────────────────

-- The audit event of a finance function. Validates the payload the way every audit function does.
CREATE OR REPLACE FUNCTION public.labelos_finance_event(
  p_org uuid, p_actor uuid, p_verb text, p_subject_type text, p_subject uuid, p_artist uuid, p_payload jsonb
) RETURNS void
LANGUAGE plpgsql
VOLATILE
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
  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, payload, audit, visibility)
  VALUES (p_org, p_actor, p_verb, p_subject_type, p_subject, p_artist, p_payload, true, 'internal');
END;
$$;

ALTER FUNCTION public.labelos_finance_event(uuid, uuid, text, text, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_finance_event(uuid, uuid, text, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- True when the statement's lines are EXACTLY the sources of its payee + period: every allocation of the payee on a
-- (non-void) import of the period as one 'earning' line of the same amount, every recoupment against them as one
-- 'recoupment' line of the same amount negated, nothing else, and net_minor the sum. Internal.
CREATE OR REPLACE FUNCTION public.labelos_statement_sources_ok(p_statement uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s         public.statements%ROWTYPE;
  v_alloc_n bigint;
  v_rec_n   bigint;
  v_line_e  bigint;
  v_line_r  bigint;
  v_match_e bigint;
  v_match_r bigint;
  v_sum     numeric;
BEGIN
  SELECT * INTO s FROM public.statements WHERE id = p_statement;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT count(*) INTO v_alloc_n
  FROM public.earnings_allocations a JOIN public.earnings_imports i ON i.id = a.import_id
  WHERE a.org_id = s.org_id AND a.payee_id = s.payee_id AND i.period_id = s.period_id AND i.status = 'imported';
  SELECT count(*) INTO v_rec_n
  FROM public.earnings_recoupments r JOIN public.earnings_imports i ON i.id = r.import_id
  WHERE r.org_id = s.org_id AND r.payee_id = s.payee_id AND i.period_id = s.period_id AND i.status = 'imported';

  SELECT count(*) FILTER (WHERE l.kind = 'earning'), count(*) FILTER (WHERE l.kind = 'recoupment'), coalesce(sum(l.amount_minor), 0)
    INTO v_line_e, v_line_r, v_sum
  FROM public.statement_lines l WHERE l.statement_id = s.id;
  IF (SELECT count(*) FROM public.statement_lines l WHERE l.statement_id = s.id AND l.kind NOT IN ('earning', 'recoupment')) > 0 THEN
    RETURN false; -- no manual adjustment lines in this version
  END IF;
  IF v_line_e <> v_alloc_n OR v_line_r <> v_rec_n OR v_sum <> s.net_minor THEN
    RETURN false;
  END IF;

  SELECT count(*) INTO v_match_e
  FROM public.statement_lines l
  JOIN public.earnings_allocations a ON a.line_id = l.earnings_line_id AND a.payee_id = s.payee_id AND a.org_id = s.org_id
  JOIN public.earnings_imports i ON i.id = a.import_id AND i.period_id = s.period_id AND i.status = 'imported'
  WHERE l.statement_id = s.id AND l.kind = 'earning' AND l.amount_minor = a.payable_minor AND l.currency = s.currency;

  SELECT count(*) INTO v_match_r
  FROM public.statement_lines l
  JOIN public.earnings_recoupments r ON r.advance_id = l.advance_id AND r.payee_id = s.payee_id AND r.org_id = s.org_id
  JOIN public.earnings_allocations a ON a.id = r.allocation_id AND a.line_id = l.earnings_line_id
  JOIN public.earnings_imports i ON i.id = r.import_id AND i.period_id = s.period_id AND i.status = 'imported'
  WHERE l.statement_id = s.id AND l.kind = 'recoupment' AND l.amount_minor = -r.amount_minor AND l.currency = s.currency;

  RETURN v_match_e = v_alloc_n AND v_match_r = v_rec_n;
END;
$$;

ALTER FUNCTION public.labelos_statement_sources_ok(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_statement_sources_ok(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Generate ──────────────────────────────────────────────────────────
-- p_lines: [{kind: 'earning'|'recoupment', earnings_line_id, advance_id?, track_id?, description?, share_units?,
-- amount_minor (string), position}] — built by lib/labelos/finance/statement-calc.ts from the allocations and
-- recoupments. The function re-proves them against the tables (labelos_statement_sources_ok) and aborts on any
-- difference: a statement that does not equal its sources is never written.
-- Answers { id, lines } or { error: not_found | payee_inactive | period_closed | statement_exists | nothing_to_include }.

CREATE OR REPLACE FUNCTION public.labelos_audit_statement_generate(
  p_org uuid, p_actor uuid, p_payee uuid, p_period uuid, p_lines jsonb, p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payee  public.payees%ROWTYPE;
  v_period public.finance_periods%ROWTYPE;
  v_old    public.statements%ROWTYPE;
  v_id     uuid;
  v_n      int;
  v_net    numeric;
  v_alloc  bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.earnings:' || p_org::text, 0));
  SELECT * INTO v_payee FROM public.payees WHERE id = p_payee AND org_id = p_org;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_payee.status <> 'active' THEN RETURN jsonb_build_object('error', 'payee_inactive'); END IF;
  SELECT * INTO v_period FROM public.finance_periods WHERE id = p_period AND org_id = p_org;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_period.status <> 'open' THEN RETURN jsonb_build_object('error', 'period_closed'); END IF;

  SELECT count(*) INTO v_alloc
  FROM public.earnings_allocations a JOIN public.earnings_imports i ON i.id = a.import_id
  WHERE a.org_id = p_org AND a.payee_id = p_payee AND i.period_id = p_period AND i.status = 'imported';
  IF v_alloc = 0 THEN RETURN jsonb_build_object('error', 'nothing_to_include'); END IF;

  SELECT * INTO v_old FROM public.statements WHERE payee_id = p_payee AND period_id = p_period AND status <> 'void' FOR UPDATE;
  IF FOUND THEN
    IF v_old.status <> 'draft' THEN
      RETURN jsonb_build_object('error', 'statement_exists', 'status', v_old.status);
    END IF;
    DELETE FROM public.statements WHERE id = v_old.id; -- only a draft is replaced; its lines go with it
  END IF;

  INSERT INTO public.statements (org_id, payee_id, period_id, currency, created_by)
  VALUES (p_org, p_payee, p_period, v_payee.currency, p_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.statement_lines (org_id, statement_id, kind, track_id, earnings_line_id, advance_id, description, share_units, amount_minor, currency, position)
  SELECT p_org, v_id, x.kind, x.track_id, x.earnings_line_id, x.advance_id, x.description, x.share_units, x.amount_minor, v_payee.currency, x.position
  FROM jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) AS x(
    kind text, earnings_line_id uuid, advance_id uuid, track_id uuid, description text, share_units int, amount_minor bigint, position int);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) THEN
    RAISE EXCEPTION 'statements: a line was not written' USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(l.amount_minor), 0) INTO v_net FROM public.statement_lines l WHERE l.statement_id = v_id;
  UPDATE public.statements SET net_minor = v_net WHERE id = v_id;

  IF NOT public.labelos_statement_sources_ok(v_id) THEN
    RAISE EXCEPTION 'statements: sources_mismatch — the lines are not exactly the allocations and recoupments of this payee and period' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.labelos_finance_event(p_org, p_actor, 'statement.generated', 'statement', v_id, v_payee.artist_contact_id,
    p_payload || jsonb_build_object('statementId', v_id, 'lines', v_n, 'replacedDraft', v_old.id IS NOT NULL));
  RETURN jsonb_build_object('id', v_id, 'lines', v_n);
END;
$$;

ALTER FUNCTION public.labelos_audit_statement_generate(uuid, uuid, uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_statement_generate(uuid, uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_statement_generate(uuid, uuid, uuid, uuid, jsonb, jsonb) TO service_role;

-- ── 4. Approve (append-only) ─────────────────────────────────────────────
-- Answers { approved: true } or { error: not_found | not_draft | self_approval | stale }.

CREATE OR REPLACE FUNCTION public.labelos_audit_statement_approve(p_org uuid, p_actor uuid, p_statement uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.statements%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.earnings:' || p_org::text, 0));
  SELECT * INTO s FROM public.statements WHERE id = p_statement AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF s.status <> 'draft' THEN RETURN jsonb_build_object('error', 'not_draft', 'status', s.status); END IF;
  -- The approver is not the person who generated it, unless that is an owner.
  IF s.created_by IS NOT NULL AND s.created_by = p_actor
     AND NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p_org AND m.user_id = p_actor AND m.role = 'owner') THEN
    RETURN jsonb_build_object('error', 'self_approval');
  END IF;
  IF NOT public.labelos_statement_sources_ok(s.id) THEN
    RETURN jsonb_build_object('error', 'stale');
  END IF;
  UPDATE public.statements SET status = 'approved', approved_by = p_actor, approved_at = now() WHERE id = s.id;
  PERFORM public.labelos_finance_event(p_org, p_actor, 'statement.approved', 'statement', s.id, s.artist_contact_id,
    p_payload || jsonb_build_object('statementId', s.id));
  RETURN jsonb_build_object('approved', true);
END;
$$;

ALTER FUNCTION public.labelos_audit_statement_approve(uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_statement_approve(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_statement_approve(uuid, uuid, uuid, jsonb) TO service_role;

-- ── 5. Issue ─────────────────────────────────────────────────────────────
-- Answers { issued: true } or { error: not_found | not_approved }.

CREATE OR REPLACE FUNCTION public.labelos_audit_statement_issue(p_org uuid, p_actor uuid, p_statement uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.statements%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.statements WHERE id = p_statement AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF s.status <> 'approved' THEN RETURN jsonb_build_object('error', 'not_approved', 'status', s.status); END IF;
  UPDATE public.statements SET status = 'issued', issued_at = now() WHERE id = s.id;
  PERFORM public.labelos_finance_event(p_org, p_actor, 'statement.issued', 'statement', s.id, s.artist_contact_id,
    p_payload || jsonb_build_object('statementId', s.id));
  RETURN jsonb_build_object('issued', true);
END;
$$;

ALTER FUNCTION public.labelos_audit_statement_issue(uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_statement_issue(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_statement_issue(uuid, uuid, uuid, jsonb) TO service_role;

-- ── 6. Void a statement ──────────────────────────────────────────────────
-- Answers { voided: true, from } or { error: not_found | already_void | has_payments }.

CREATE OR REPLACE FUNCTION public.labelos_audit_statement_void(p_org uuid, p_actor uuid, p_statement uuid, p_reason text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.statements%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.earnings:' || p_org::text, 0));
  SELECT * INTO s FROM public.statements WHERE id = p_statement AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF s.status = 'void' THEN RETURN jsonb_build_object('error', 'already_void'); END IF;
  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.statement_id = s.id AND p.voided_at IS NULL) THEN
    RETURN jsonb_build_object('error', 'has_payments');
  END IF;
  UPDATE public.statements SET status = 'void', voided_at = now(), void_reason = nullif(p_reason, '') WHERE id = s.id;
  PERFORM public.labelos_finance_event(p_org, p_actor, 'statement.voided', 'statement', s.id, s.artist_contact_id,
    p_payload || jsonb_build_object('statementId', s.id, 'from', s.status));
  RETURN jsonb_build_object('voided', true, 'from', s.status);
END;
$$;

ALTER FUNCTION public.labelos_audit_statement_void(uuid, uuid, uuid, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_statement_void(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_statement_void(uuid, uuid, uuid, text, jsonb) TO service_role;

-- ── 7. Payments (records only) ───────────────────────────────────────────
-- Answers { id } or { error: not_found | not_issued | exceeds_net, remaining }.

CREATE OR REPLACE FUNCTION public.labelos_audit_payment_record(
  p_org uuid, p_actor uuid, p_statement uuid, p_amount bigint, p_paid_on date, p_reference text, p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s      public.statements%ROWTYPE;
  v_paid numeric;
  v_id   uuid;
BEGIN
  SELECT * INTO s FROM public.statements WHERE id = p_statement AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF s.status <> 'issued' THEN RETURN jsonb_build_object('error', 'not_issued', 'status', s.status); END IF;
  SELECT coalesce(sum(p.amount_minor), 0) INTO v_paid FROM public.payments p WHERE p.statement_id = s.id AND p.voided_at IS NULL;
  IF v_paid + p_amount > s.net_minor THEN
    RETURN jsonb_build_object('error', 'exceeds_net', 'remaining', greatest(s.net_minor - v_paid, 0)::text);
  END IF;
  INSERT INTO public.payments (org_id, payee_id, statement_id, amount_minor, currency, paid_on, reference, recorded_by)
  VALUES (p_org, s.payee_id, s.id, p_amount, s.currency, p_paid_on, nullif(p_reference, ''), p_actor)
  RETURNING id INTO v_id;
  PERFORM public.labelos_finance_event(p_org, p_actor, 'payment.recorded', 'payment', v_id, s.artist_contact_id,
    p_payload || jsonb_build_object('statementId', s.id, 'paymentId', v_id));
  RETURN jsonb_build_object('id', v_id);
END;
$$;

ALTER FUNCTION public.labelos_audit_payment_record(uuid, uuid, uuid, bigint, date, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_payment_record(uuid, uuid, uuid, bigint, date, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_payment_record(uuid, uuid, uuid, bigint, date, text, jsonb) TO service_role;

-- Answers { voided: true } or { error: not_found | already_void }.
CREATE OR REPLACE FUNCTION public.labelos_audit_payment_void(p_org uuid, p_actor uuid, p_payment uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.payments%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id = p_payment AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF p.voided_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'already_void'); END IF;
  UPDATE public.payments SET voided_at = now(), voided_by = p_actor WHERE id = p.id;
  PERFORM public.labelos_finance_event(p_org, p_actor, 'payment.voided', 'payment', p.id, p.artist_contact_id,
    p_payload || jsonb_build_object('statementId', p.statement_id, 'paymentId', p.id));
  RETURN jsonb_build_object('voided', true);
END;
$$;

ALTER FUNCTION public.labelos_audit_payment_void(uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_payment_void(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_payment_void(uuid, uuid, uuid, jsonb) TO service_role;

-- ── 8. Void an import ────────────────────────────────────────────────────
-- Only while no APPROVED or ISSUED statement includes one of its lines. Releases the import's allocations and
-- recoupments (the advances they recouped have that much left again) and discards the DRAFT statements that
-- included them; the lines stay, flagged by the import's status. Answers { voided: true, allocations, recoupments,
-- drafts } or { error: not_found | already_void | statement_exists }.

CREATE OR REPLACE FUNCTION public.labelos_audit_earnings_import_void(p_org uuid, p_actor uuid, p_import uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i public.earnings_imports%ROWTYPE;
  v_allocs int;
  v_recoups int;
  v_drafts int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.earnings:' || p_org::text, 0));
  SELECT * INTO i FROM public.earnings_imports WHERE id = p_import AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF i.status = 'void' THEN RETURN jsonb_build_object('error', 'already_void'); END IF;

  IF EXISTS (
    SELECT 1 FROM public.statement_lines l
    JOIN public.statements s ON s.id = l.statement_id
    JOIN public.earnings_lines el ON el.id = l.earnings_line_id
    WHERE el.import_id = i.id AND s.status IN ('approved', 'issued')
  ) THEN
    RETURN jsonb_build_object('error', 'statement_exists');
  END IF;

  DELETE FROM public.statements s
  WHERE s.org_id = p_org AND s.status = 'draft'
    AND EXISTS (SELECT 1 FROM public.statement_lines l JOIN public.earnings_lines el ON el.id = l.earnings_line_id WHERE l.statement_id = s.id AND el.import_id = i.id);
  GET DIAGNOSTICS v_drafts = ROW_COUNT;

  PERFORM set_config('labelos.voiding_import', i.id::text, true);
  DELETE FROM public.earnings_recoupments WHERE import_id = i.id;
  GET DIAGNOSTICS v_recoups = ROW_COUNT;
  DELETE FROM public.earnings_allocations WHERE import_id = i.id;
  GET DIAGNOSTICS v_allocs = ROW_COUNT;
  PERFORM set_config('labelos.voiding_import', '', true);

  UPDATE public.earnings_imports SET status = 'void' WHERE id = i.id;

  PERFORM public.labelos_finance_event(p_org, p_actor, 'earnings.import_voided', 'earnings_import', i.id, NULL,
    p_payload || jsonb_build_object('importId', i.id, 'allocations', v_allocs, 'recoupments', v_recoups, 'draftsDiscarded', v_drafts));
  RETURN jsonb_build_object('voided', true, 'allocations', v_allocs, 'recoupments', v_recoups, 'drafts', v_drafts);
END;
$$;

ALTER FUNCTION public.labelos_audit_earnings_import_void(uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_earnings_import_void(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_earnings_import_void(uuid, uuid, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
