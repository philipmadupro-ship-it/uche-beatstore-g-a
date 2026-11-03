-- 182_labelos_finance_advances_close.sql
-- Label OS (LABEL-64): the advances ledger and the close of a finance period.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch into
-- main, after 179, 180 and 181. Never part of supabase/apply/pending.sql.
--
-- NO NEW TABLE. 179 already holds `advances` and `finance_periods`, 180 the
-- recoupments that draw advances down and 181 the statements that carry them. This
-- file gives the two of them their atomic, audited write functions, and loosens the
-- ONE rule 179 had no way to express yet: an advance that nothing has drawn on is
-- still a draft of a fact and may be corrected; the moment a recoupment or a
-- statement line names it, it is frozen — the same row facts LABEL-62/63 freeze,
-- not a parallel flag.
--
-- THE APP NEVER MOVES MONEY. An advance is a record of money the label paid out
-- elsewhere; nothing here sends, schedules or reconciles a payment.
--
-- ── Advances ─────────────────────────────────────────────────────────────
--   create   a payee's advance, recoupable or not, in the payee's currency
--            (179's guard checks the currency). Takes 181's per-organization
--            advisory lock so it is ordered against an import's recoupment pass.
--   update   kind / amount / paid date / note. `kind`, `amount_minor` and
--            `paid_on` change only while NOTHING references the advance (no
--            earnings_recoupments row, no statement_lines row): then the numbers
--            a statement was built from can never move under it. The note stays
--            editable. Enforced by a trigger on the table too, so a direct
--            service-role UPDATE meets the same rule.
--   void     only an unreferenced advance (a mistaken entry). One that has been
--            drawn on is not voided: its recoupments are history on statements.
--   Events (audit, internal): advance.created | advance.updated | advance.voided —
--   written by the function in the same transaction. Payloads name ids, the kind
--   and the NAMES of changed fields, never an amount (the finance convention).
--
-- ── Period close ─────────────────────────────────────────────────────────
--   close    open → closed, under the SAME advisory lock that imports, re-runs,
--            statement generation and approval take (hashtextextended
--            ('labelos.earnings:'||org)). A period with a DRAFT statement does not
--            close (`drafts_open`): approve or void it first, so nothing half-made
--            is left behind a closed door. Closing needs `finance.approve` (route).
--   reopen   closed → open. OWNER ONLY, checked again here. 179 made "closed stays
--            closed" a hard rule; this function is the one exception, through a
--            transaction-local flag that 179's guard learns below.
--   A closed period refuses a new import (180's function checks, under the lock)
--   and a new statement (179). On top of that, two BEFORE INSERT triggers lock the
--   period row FOR SHARE and re-check it, so a close that commits first can never
--   be followed by an import or a statement in that period, with or without the
--   advisory lock: close's UPDATE needs the row exclusively and waits for a
--   half-finished insert, and an insert that starts after sees the closed row.
--   Events: period.closed | period.reopened (audit, internal).
--
-- Functions 182 does NOT redefine: labelos_finance_frozen (181), the 180/181
-- earnings and statement functions. finance_periods_guard and advances' freeze
-- trigger are defined only in 179 and no later migration touches them.
--
-- Idempotent: CREATE OR REPLACE, DROP … IF EXISTS first.
-- Rollback: supabase/rollback/182_labelos_finance_advances_close.down.sql.

-- ── 1. An advance is fixed once anything references it ───────────────────

CREATE OR REPLACE FUNCTION public.labelos_advance_referenced(p_advance uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.earnings_recoupments r WHERE r.advance_id = p_advance)
      OR EXISTS (SELECT 1 FROM public.statement_lines l WHERE l.advance_id = p_advance);
$$;

ALTER FUNCTION public.labelos_advance_referenced(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_advance_referenced(uuid) FROM PUBLIC, anon, authenticated;

-- Replaces 179's generic freeze on advances. UPDATE: `note` always; `voided_at` / `voided_by` (once, only while
-- unreferenced); `kind`, `amount_minor`, `paid_on` only while unreferenced. Everything else never changes.
-- DELETE: only the organization's own purge.
CREATE OR REPLACE FUNCTION public.advances_edit_frozen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a jsonb;
  b jsonb;
  u text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT public.labelos_finance_org_gone(OLD.org_id) THEN
      RAISE EXCEPTION 'advances: rows are never deleted (void them instead)' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  a := to_jsonb(OLD);
  b := to_jsonb(NEW);
  -- A deleted account nulls the account columns (ON DELETE SET NULL); that, and only that, may change on any row.
  FOREACH u IN ARRAY ARRAY['created_by', 'voided_by'] LOOP
    IF a ->> u IS NOT NULL AND b ->> u IS NULL AND (u <> 'voided_by' OR b ->> 'voided_at' IS NOT NULL) THEN
      a := a - u;
      b := b - u;
    END IF;
  END LOOP;
  a := a - 'note' - 'voided_at' - 'voided_by';
  b := b - 'note' - 'voided_at' - 'voided_by';
  IF NEW.voided_at IS DISTINCT FROM OLD.voided_at OR NEW.voided_by IS DISTINCT FROM OLD.voided_by THEN
    IF OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL AND public.labelos_advance_referenced(OLD.id) THEN
      RAISE EXCEPTION 'advances: advance_referenced — a recoupment or a statement already uses this advance' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF a ->> 'kind' IS DISTINCT FROM b ->> 'kind'
     OR a ->> 'amount_minor' IS DISTINCT FROM b ->> 'amount_minor'
     OR a ->> 'paid_on' IS DISTINCT FROM b ->> 'paid_on' THEN
    IF public.labelos_advance_referenced(OLD.id) THEN
      RAISE EXCEPTION 'advances: advance_referenced — a recoupment or a statement already uses this advance' USING ERRCODE = 'check_violation';
    END IF;
    a := a - 'kind' - 'amount_minor' - 'paid_on';
    b := b - 'kind' - 'amount_minor' - 'paid_on';
  END IF;
  IF a <> b THEN
    RAISE EXCEPTION 'advances: the payee, currency and organization of an advance never change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.advances_edit_frozen() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.advances_edit_frozen() FROM PUBLIC;
DROP TRIGGER IF EXISTS advances_frozen ON public.advances;
CREATE TRIGGER advances_frozen BEFORE UPDATE OR DELETE ON public.advances
  FOR EACH ROW EXECUTE FUNCTION public.advances_edit_frozen();

-- ── 2. Period close: the guard learns the one exception ──────────────────

CREATE OR REPLACE FUNCTION public.finance_periods_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'finance_periods: a period starts open' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.status = 'closed' AND NEW.status <> 'closed' THEN
    -- 182: labelos_audit_period_reopen names this period in a transaction-local setting; nothing else reopens.
    IF nullif(current_setting('labelos.reopening_period', true), '') IS DISTINCT FROM OLD.id::text THEN
      RAISE EXCEPTION 'finance_periods: a closed period stays closed' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.finance_periods_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finance_periods_guard() FROM PUBLIC;

-- A new import or statement locks the period row FOR SHARE and re-reads it. A close that commits first is seen
-- (READ COMMITTED re-evaluates the locked row); a close that arrives later waits for this insert to finish.
CREATE OR REPLACE FUNCTION public.finance_period_open_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.period_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT fp.status INTO v_status FROM public.finance_periods fp WHERE fp.id = NEW.period_id AND fp.org_id = NEW.org_id FOR SHARE;
  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION '%: period_closed — that period is not open', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.finance_period_open_lock() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finance_period_open_lock() FROM PUBLIC;

DROP TRIGGER IF EXISTS earnings_imports_period_open ON public.earnings_imports;
CREATE TRIGGER earnings_imports_period_open BEFORE INSERT ON public.earnings_imports
  FOR EACH ROW EXECUTE FUNCTION public.finance_period_open_lock();
DROP TRIGGER IF EXISTS statements_period_open ON public.statements;
CREATE TRIGGER statements_period_open BEFORE INSERT ON public.statements
  FOR EACH ROW EXECUTE FUNCTION public.finance_period_open_lock();

-- ── 3. Advance functions (service role only) ─────────────────────────────

-- Answers { id } or { error: not_found | payee_inactive }.
CREATE OR REPLACE FUNCTION public.labelos_audit_advance_create(
  p_org uuid, p_actor uuid, p_payee uuid, p_kind text, p_amount bigint, p_paid_on date, p_note text, p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payee public.payees%ROWTYPE;
  v_id    uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.earnings:' || p_org::text, 0));
  SELECT * INTO v_payee FROM public.payees WHERE id = p_payee AND org_id = p_org;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_payee.status <> 'active' THEN RETURN jsonb_build_object('error', 'payee_inactive'); END IF;

  INSERT INTO public.advances (org_id, payee_id, kind, amount_minor, currency, paid_on, note, created_by)
  VALUES (p_org, p_payee, p_kind, p_amount, v_payee.currency, p_paid_on, nullif(p_note, ''), p_actor)
  RETURNING id INTO v_id;

  PERFORM public.labelos_finance_event(p_org, p_actor, 'advance.created', 'advance', v_id, v_payee.artist_contact_id,
    p_payload || jsonb_build_object('advanceId', v_id, 'payeeId', p_payee, 'kind', p_kind));
  RETURN jsonb_build_object('id', v_id);
END;
$$;

ALTER FUNCTION public.labelos_audit_advance_create(uuid, uuid, uuid, text, bigint, date, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_advance_create(uuid, uuid, uuid, text, bigint, date, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_advance_create(uuid, uuid, uuid, text, bigint, date, text, jsonb) TO service_role;

-- p_patch: any of { kind, amount_minor, paid_on (null clears), note (null clears) }; a key that is absent is not touched.
-- Answers { updated: true, fields } or { error: not_found | advance_void | advance_referenced | no_change }.
CREATE OR REPLACE FUNCTION public.labelos_audit_advance_update(
  p_org uuid, p_actor uuid, p_advance uuid, p_patch jsonb, p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d        public.advances%ROWTYPE;
  v_new    public.advances%ROWTYPE;
  v_fields text[] := ARRAY[]::text[];
  v_kind   text;
  v_amount bigint;
  v_paid   date;
  v_note   text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.earnings:' || p_org::text, 0));
  SELECT * INTO d FROM public.advances WHERE id = p_advance AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF d.voided_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'advance_void'); END IF;

  v_kind := d.kind; v_amount := d.amount_minor; v_paid := d.paid_on; v_note := d.note;
  IF p_patch ? 'kind' AND p_patch ->> 'kind' IS DISTINCT FROM d.kind THEN
    v_kind := p_patch ->> 'kind'; v_fields := array_append(v_fields, 'kind'::text);
  END IF;
  IF p_patch ? 'amount_minor' AND (p_patch ->> 'amount_minor')::bigint IS DISTINCT FROM d.amount_minor THEN
    v_amount := (p_patch ->> 'amount_minor')::bigint; v_fields := array_append(v_fields, 'amount'::text);
  END IF;
  IF p_patch ? 'paid_on' AND nullif(p_patch ->> 'paid_on', '')::date IS DISTINCT FROM d.paid_on THEN
    v_paid := nullif(p_patch ->> 'paid_on', '')::date; v_fields := array_append(v_fields, 'paid_on'::text);
  END IF;
  IF p_patch ? 'note' AND nullif(p_patch ->> 'note', '') IS DISTINCT FROM d.note THEN
    v_note := nullif(p_patch ->> 'note', ''); v_fields := array_append(v_fields, 'note'::text);
  END IF;
  IF cardinality(v_fields) = 0 THEN RETURN jsonb_build_object('error', 'no_change'); END IF;
  IF v_fields && ARRAY['kind', 'amount', 'paid_on'] AND public.labelos_advance_referenced(d.id) THEN
    RETURN jsonb_build_object('error', 'advance_referenced');
  END IF;

  UPDATE public.advances SET kind = v_kind, amount_minor = v_amount, paid_on = v_paid, note = v_note WHERE id = d.id RETURNING * INTO v_new;

  PERFORM public.labelos_finance_event(p_org, p_actor, 'advance.updated', 'advance', d.id, d.artist_contact_id,
    p_payload || jsonb_build_object('advanceId', d.id, 'payeeId', d.payee_id, 'kind', v_new.kind, 'fields', to_jsonb(v_fields)));
  RETURN jsonb_build_object('updated', true, 'fields', to_jsonb(v_fields));
END;
$$;

ALTER FUNCTION public.labelos_audit_advance_update(uuid, uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_advance_update(uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_advance_update(uuid, uuid, uuid, jsonb, jsonb) TO service_role;

-- Answers { voided: true } or { error: not_found | already_void | advance_referenced }.
CREATE OR REPLACE FUNCTION public.labelos_audit_advance_void(p_org uuid, p_actor uuid, p_advance uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.advances%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.earnings:' || p_org::text, 0));
  SELECT * INTO d FROM public.advances WHERE id = p_advance AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF d.voided_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'already_void'); END IF;
  IF public.labelos_advance_referenced(d.id) THEN RETURN jsonb_build_object('error', 'advance_referenced'); END IF;
  UPDATE public.advances SET voided_at = now(), voided_by = p_actor WHERE id = d.id;
  PERFORM public.labelos_finance_event(p_org, p_actor, 'advance.voided', 'advance', d.id, d.artist_contact_id,
    p_payload || jsonb_build_object('advanceId', d.id, 'payeeId', d.payee_id, 'kind', d.kind));
  RETURN jsonb_build_object('voided', true);
END;
$$;

ALTER FUNCTION public.labelos_audit_advance_void(uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_advance_void(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_advance_void(uuid, uuid, uuid, jsonb) TO service_role;

-- ── 4. Period close / reopen ─────────────────────────────────────────────

-- Answers { closed: true } or { error: not_found | already_closed | drafts_open }.
CREATE OR REPLACE FUNCTION public.labelos_audit_period_close(p_org uuid, p_actor uuid, p_period uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fp public.finance_periods%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.earnings:' || p_org::text, 0));
  SELECT * INTO fp FROM public.finance_periods WHERE id = p_period AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF fp.status = 'closed' THEN RETURN jsonb_build_object('error', 'already_closed'); END IF;
  IF EXISTS (SELECT 1 FROM public.statements s WHERE s.period_id = fp.id AND s.status = 'draft') THEN
    RETURN jsonb_build_object('error', 'drafts_open');
  END IF;
  -- clock_timestamp(): the moment the lock was won, not the start of the transaction.
  UPDATE public.finance_periods SET status = 'closed', closed_by = p_actor, closed_at = clock_timestamp() WHERE id = fp.id;
  PERFORM public.labelos_finance_event(p_org, p_actor, 'period.closed', 'finance_period', fp.id, NULL,
    p_payload || jsonb_build_object('periodId', fp.id));
  RETURN jsonb_build_object('closed', true);
END;
$$;

ALTER FUNCTION public.labelos_audit_period_close(uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_period_close(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_period_close(uuid, uuid, uuid, jsonb) TO service_role;

-- OWNER ONLY (checked here as well as in the route). Answers { reopened: true } or { error: not_found | not_owner | not_closed }.
CREATE OR REPLACE FUNCTION public.labelos_audit_period_reopen(p_org uuid, p_actor uuid, p_period uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fp public.finance_periods%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.earnings:' || p_org::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p_org AND m.user_id = p_actor AND m.role = 'owner') THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;
  SELECT * INTO fp FROM public.finance_periods WHERE id = p_period AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF fp.status <> 'closed' THEN RETURN jsonb_build_object('error', 'not_closed'); END IF;
  PERFORM set_config('labelos.reopening_period', fp.id::text, true);
  UPDATE public.finance_periods SET status = 'open', closed_by = NULL, closed_at = NULL WHERE id = fp.id;
  PERFORM set_config('labelos.reopening_period', '', true);
  PERFORM public.labelos_finance_event(p_org, p_actor, 'period.reopened', 'finance_period', fp.id, NULL,
    p_payload || jsonb_build_object('periodId', fp.id));
  RETURN jsonb_build_object('reopened', true);
END;
$$;

ALTER FUNCTION public.labelos_audit_period_reopen(uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_period_reopen(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_period_reopen(uuid, uuid, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
