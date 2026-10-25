-- 174_labelos_parties_payee.sql
-- Label OS (LABEL-54): the Parties page's data — address, country, tax id,
-- payment instructions, "confirmed by the person" — plus the three rules the
-- page needs the DATABASE to hold, not only the routes: payee data is not
-- readable on a member's own JWT, a roster artist reads no co-writer's
-- contact data, and a name that a circulated split sheet shows cannot be
-- changed underneath it. And the audit function for withdrawing a credit.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 173. Never part of supabase/apply/pending.sql.
--
-- Builds on 153 (`parties`, `track_collaborators`, the credit decision
-- function) and 155 (`split_sheets`, `split_lines`). No new table: `parties`
-- is the one people-of-rights table (17 R8).
--
-- 1. Columns on `parties`: address, country (ISO 3166-1 alpha-2), tax_id,
--    payment_instructions, details_confirmed_by / details_confirmed_at.
--    The app NEVER stores a bank number: `payment_instructions` is free text
--    for finance, and a value that looks like an IBAN or a card number is
--    refused by a CHECK (`labelos_looks_like_bank_number`, the same two
--    patterns as lib/labelos/payee.ts), so a writer that skips the route is
--    stopped too.
--
-- 2. Who reads what:
--      · tax_id, payment_instructions — NO API role may read them. They are
--        taken out of the column grants (the 162 pattern), so `select=*`,
--        a named column, a filter or an ORDER BY on them is `permission
--        denied` for every member, a whole-org rights reader included. The
--        service-role routes serve them to `rights.write` / `finance.read`
--        only (lib/labelos/credits#mayReadPayee). A column grant cannot ask
--        for a capability, so the capability test lives in the route and the
--        grant guarantees nothing else can bypass it.
--      · everything else on a party (legal name, e-mail, codes, address…)
--        is contact and identity data. 153 let any member with `rights.read`
--        in scope read it; a roster artist (role `artist`) has `rights.read`
--        so they could read a CO-WRITER's. Doc 21 decision 4 and LABEL-54:
--        names, roles and shares only. The parties policy is replaced so a
--        member whose role is `artist` reads only the party that is THEM
--        (user_id = auth.uid()). Staff keep what they had.
--
-- 3. The lock (review G6 D-c): `parties_identity_lock` refuses a change of
--    `display_name`, or a change/removal of an already-linked `user_id`,
--    once any split sheet that left draft names the party. Chosen over
--    snapshotting names onto lines because the sheet only ever stored the
--    party id: a snapshot would add a column to a table whose guard (155)
--    freezes lines, a backfill, and a second source of the same name; the
--    lock is one trigger and the fix for a wrong name is already the
--    product's own flow (a new version of the sheet). Linking an account to
--    a party that has none stays allowed — it names no one new and is how the
--    person gets to see and acknowledge their own line. Legal data (legal
--    name, codes, address) is not identity and stays editable.
--
-- 4. `labelos_audit_credit_withdraw`: the credited person, or a rights
--    writer (the route decides who — `planWithdraw`), removes a credit; the
--    row goes and the `credit.withdrawn` audit event is written in the same
--    transaction (the 146 / 153 pattern). service_role only.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP … IF EXISTS.

-- ── 1. Columns ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.labelos_looks_like_bank_number(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_text IS NOT NULL AND (
    -- an IBAN: two letters, two digits, a short bank code, then the account digits (single spaces allowed)
    p_text ~ '(^|[^A-Za-z0-9])[A-Za-z]{2}[0-9]{2}( ?[A-Za-z0-9]){3,7}( ?[0-9]){6,}'
    -- a card number: 13 to 19 digits, single spaces or dashes between them
    OR p_text ~ '(^|[^0-9])([0-9][ -]?){12,18}[0-9]([^0-9]|$)'
  );
$$;

ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS address              text;
ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS country              text;
ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS tax_id               text;
ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS payment_instructions text;
ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS details_confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS details_confirmed_at timestamptz;

ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_address_check;
ALTER TABLE public.parties ADD CONSTRAINT parties_address_check CHECK (address IS NULL OR length(address) BETWEEN 1 AND 500);
ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_country_check;
ALTER TABLE public.parties ADD CONSTRAINT parties_country_check CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_tax_id_check;
ALTER TABLE public.parties ADD CONSTRAINT parties_tax_id_check CHECK (tax_id IS NULL OR length(tax_id) BETWEEN 1 AND 64);
ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_payment_instructions_check;
ALTER TABLE public.parties ADD CONSTRAINT parties_payment_instructions_check
  CHECK (payment_instructions IS NULL OR (length(payment_instructions) BETWEEN 1 AND 500 AND NOT public.labelos_looks_like_bank_number(payment_instructions)));

-- ── 2a. Payee data is not readable on any API role's JWT ─────────────────
-- REVOKE on the table also revokes its column grants, so a replay starts from
-- nothing and grants the same list again. Writes are service-role only (153's
-- trigger), untouched here.

REVOKE SELECT ON public.parties FROM anon, authenticated;
GRANT SELECT (id, org_id, kind, display_name, legal_name, email, ipi, isni, pro, pro_affiliation, publisher_name, publisher_ipi,
              contact_id, user_id, created_by, created_at, updated_at, address, country, details_confirmed_by, details_confirmed_at)
  ON public.parties TO authenticated;
GRANT SELECT (id, org_id, kind, display_name, legal_name, email, ipi, isni, pro, pro_affiliation, publisher_name, publisher_ipi,
              contact_id, user_id, created_by, created_at, updated_at, address, country, details_confirmed_by, details_confirmed_at)
  ON public.parties TO anon;

-- ── 2b. A roster artist reads only the party that is them ────────────────
-- 153's policy with one added condition on the capability branch:
-- `cm.role <> 'artist'`. Same shape otherwise (uncorrelated subplans, R-08).

DROP POLICY IF EXISTS parties_member_read ON public.parties;
CREATE POLICY parties_member_read ON public.parties
  FOR SELECT
  USING (
    (
      org_id IN (
        SELECT cm.org_id
        FROM public.org_members cm
        WHERE cm.user_id = (SELECT auth.uid())
          AND cm.role <> 'artist'
          AND public.has_org_cap(cm.org_id, 'rights.read')
      )
      AND (
        org_id IN (
          SELECT om.org_id
          FROM public.org_members om
          WHERE om.user_id = (SELECT auth.uid())
            AND om.scope = 'org'
            AND om.role <> 'artist'
        )
        OR (org_id, id) IN (SELECT sp.org_id, sp.party_id FROM public.labelos_scoped_parties() sp)
      )
    )
    OR (
      user_id = (SELECT auth.uid())
      AND org_id IN (SELECT mm.org_id FROM public.org_members mm WHERE mm.user_id = (SELECT auth.uid()))
    )
  );

-- ── 3. The lock ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.parties_identity_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.display_name IS DISTINCT FROM OLD.display_name
      OR (OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id))
     AND EXISTS (
       SELECT 1
       FROM public.split_lines l
       JOIN public.split_sheets s ON s.id = l.split_sheet_id
       WHERE l.party_id = OLD.id AND s.status <> 'draft'
     )
  THEN
    RAISE EXCEPTION 'parties: the name and account of a party on a circulated split sheet are locked'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.parties_identity_lock() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.parties_identity_lock() FROM PUBLIC;

DROP TRIGGER IF EXISTS parties_identity_lock ON public.parties;
CREATE TRIGGER parties_identity_lock BEFORE UPDATE ON public.parties
  FOR EACH ROW EXECUTE FUNCTION public.parties_identity_lock();

-- ── 4. Withdraw a credit, with its audit event ───────────────────────────
-- The route has decided WHO (planWithdraw). This does what the database can
-- know for itself: the credit is a credit of the org, and the event is
-- written in the same transaction as the removal (146 pattern). The event
-- keeps the fact for the life of the org (audit = true) after the row is gone.
-- Answers {"withdrawn": true} or {"error": "not_found"}.

CREATE OR REPLACE FUNCTION public.labelos_audit_credit_withdraw(
  p_org uuid,
  p_actor uuid,
  p_credit uuid,
  p_subject jsonb,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row  public.track_collaborators%ROWTYPE;
  v_art  uuid;
  v_proj uuid;
  v_song uuid;
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

  SELECT * INTO v_row FROM public.track_collaborators
  WHERE id = p_credit AND org_id = p_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  DELETE FROM public.track_collaborators WHERE id = p_credit;

  v_art  := NULLIF(p_subject->>'artist_id', '')::uuid;
  v_proj := NULLIF(p_subject->>'project_id', '')::uuid;
  v_song := NULLIF(p_subject->>'song_id', '')::uuid;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, song_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'credit.withdrawn', 'credit', v_row.id, v_art, v_proj, v_song, p_payload, true, 'artist');

  RETURN jsonb_build_object('withdrawn', true);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_credit_withdraw(uuid, uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_credit_withdraw(uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_credit_withdraw(uuid, uuid, uuid, jsonb, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
