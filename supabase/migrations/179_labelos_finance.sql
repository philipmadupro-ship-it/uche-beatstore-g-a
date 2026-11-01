-- 179_labelos_finance.sql
-- Label OS (LABEL-61): the finance record — payees, advances, periods, earnings
-- imports and lines, statements and their lines, and payments.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 176 and 186 (it uses 174's labelos_looks_like_bank_number and
-- 166's contacts.org_self_artist). Never part of supabase/apply/pending.sql.
--
-- SCHEMA + PERMISSIONS ONLY. Import and royalty calculation (LABEL-62),
-- statement generation and payment tracking screens (LABEL-63) and the
-- dashboard (LABEL-64) come later and write through the service role into
-- these tables. THE APP NEVER MOVES MONEY: `payments` is a record of a payment
-- somebody made elsewhere. It has no processor, account or transfer column.
--
-- Money: every amount is `bigint` minor units + `char(3)` ISO-4217 currency
-- (CHECK upper-case letters; the table of known codes and exponents is
-- lib/labelos/finance/money.ts). Never numeric / float.
--
-- Tables (all org-only: no user_id; ON DELETE CASCADE from organizations so the
-- org's hard delete leaves nothing; writes are service-role only — 141's
-- trigger, plus no write policy):
--   payees            who is paid. One per (org, party): the `parties` row (LABEL-27/54)
--                     holds the legal identity. `artist_contact_id` is a SNAPSHOT of
--                     the party's roster contact at the moment the payee was made and
--                     never changes — it is what "this is the artist's own payee"
--                     means, so linking a party to an account or re-pointing a party
--                     at another contact LATER cannot move anybody's finance reads
--                     (LABEL-71 H1). `payment_reference` is free text for finance
--                     ("wire ref on file"), never an account number (CHECK, 174's
--                     detector), and NO API role can read it.
--   finance_periods   a reporting period; open → closed, closed is final.
--   advances          recoupable / non-recoupable advances to a payee (ledger rows;
--                     amount, currency, kind, payee never change; voided once).
--   earnings_imports  one row per imported distributor file, unique per org + SHA-256
--                     of the file (re-importing the same file is a conflict).
--   earnings_lines    gross earnings per line; unmatched = track_id NULL. Only the
--                     match (track_id) can change.
--   statements        one per payee per period (a void one does not count).
--                     draft → approved → issued, any of them → void. Approval is
--                     append-only: who and when are written once. The artist sees
--                     ISSUED ones only.
--   statement_lines   what a statement is made of (earning / recoupment / adjustment).
--                     Frozen once the statement leaves draft. net_minor must equal the
--                     sum of the lines when the statement leaves draft.
--   payments          a payment RECORD, append-only (voided once, never deleted).
--
-- Reads (RLS; uncorrelated hashed subplans only, R-08):
--   · staff: `finance.read` (role other than artist) AND (a whole-org member, OR the
--     row's artist is in the member's member_artist_scopes). Rows whose payee has no
--     roster artist are whole-org only. Earnings imports / lines / periods are
--     whole-org finance readers only (they are not per-artist).
--   · a roster artist (role `artist`, who does NOT hold finance.read) reads ONLY
--     their own payee, its ISSUED statements and lines, its payments, and the period
--     rows of those statements. "Own" = labelos_my_payees(): the payee's snapshot
--     artist is the caller's scoped roster contact (member_artist_scopes), or the
--     caller is an owner of an ARTIST org and the payee's artist is that org's one
--     self artist (contacts.org_self_artist, 166) — the identity rule LABEL-71 used
--     for consent. A party's linked account proves nothing here.
--   · external project members, other orgs, anon: nothing. An org without the
--     `finance` module (entitlements, 170) reads nothing through any of these.
--   · advances, earnings, draft/approved/void statements: staff only.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP … IF EXISTS first.
-- Rollback: supabase/rollback/179_labelos_finance.down.sql.

-- ── 0. Helpers ───────────────────────────────────────────────────────────

-- True once the organization row is gone: the org's own purge (one DELETE on
-- organizations) cascades through every table, and the frozen-row guards below
-- must let exactly that through. Called only from AFTER-cascade deletes, where
-- the parent is already invisible (the 155 / 163 pattern).
CREATE OR REPLACE FUNCTION public.labelos_finance_org_gone(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_org);
$$;

ALTER FUNCTION public.labelos_finance_org_gone(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_finance_org_gone(uuid) FROM PUBLIC;

-- Generic freeze: UPDATE may change only the columns named as trigger
-- arguments; DELETE only comes from the organization's purge.
CREATE OR REPLACE FUNCTION public.labelos_finance_frozen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a jsonb;
  b jsonb;
  i int := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT public.labelos_finance_org_gone(OLD.org_id) THEN
      RAISE EXCEPTION '%: rows are never deleted (void them instead)', TG_TABLE_NAME USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  a := to_jsonb(OLD);
  b := to_jsonb(NEW);
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

-- ── 1. payees ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payees (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id          uuid NOT NULL REFERENCES public.parties(id),
  artist_contact_id uuid REFERENCES public.contacts(id),
  currency          char(3) NOT NULL DEFAULT 'USD',
  status            text NOT NULL DEFAULT 'active',
  payment_reference text,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payees_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT payees_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT payees_reference_check CHECK (
    payment_reference IS NULL OR (length(payment_reference) BETWEEN 1 AND 200 AND NOT public.labelos_looks_like_bank_number(payment_reference))),
  CONSTRAINT payees_one_per_party UNIQUE (org_id, party_id)
);

CREATE INDEX IF NOT EXISTS idx_payees_artist ON public.payees (org_id, artist_contact_id) WHERE artist_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payees_party ON public.payees (party_id);
ALTER TABLE public.payees ENABLE ROW LEVEL SECURITY;

-- ── 2. finance_periods ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.finance_periods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label      text NOT NULL,
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,
  status     text NOT NULL DEFAULT 'open',
  closed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at  timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_periods_label_check CHECK (length(label) BETWEEN 1 AND 80),
  CONSTRAINT finance_periods_range_check CHECK (ends_on >= starts_on),
  CONSTRAINT finance_periods_status_check CHECK (status IN ('open', 'closed')),
  CONSTRAINT finance_periods_closed_shape CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CONSTRAINT finance_periods_unique_range UNIQUE (org_id, starts_on, ends_on)
);

CREATE INDEX IF NOT EXISTS idx_finance_periods_org ON public.finance_periods (org_id, starts_on DESC);
ALTER TABLE public.finance_periods ENABLE ROW LEVEL SECURITY;

-- ── 3. advances ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.advances (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payee_id          uuid NOT NULL REFERENCES public.payees(id),
  artist_contact_id uuid REFERENCES public.contacts(id),
  kind              text NOT NULL,
  amount_minor      bigint NOT NULL,
  currency          char(3) NOT NULL,
  paid_on           date,
  note              text,
  voided_at         timestamptz,
  voided_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT advances_kind_check CHECK (kind IN ('recoupable', 'non_recoupable')),
  CONSTRAINT advances_amount_check CHECK (amount_minor > 0),
  CONSTRAINT advances_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT advances_note_check CHECK (note IS NULL OR length(note) <= 500),
  CONSTRAINT advances_void_shape CHECK (voided_by IS NULL OR voided_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_advances_payee ON public.advances (org_id, payee_id);
ALTER TABLE public.advances ENABLE ROW LEVEL SECURITY;

-- ── 4. earnings_imports / earnings_lines ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.earnings_imports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_id   uuid REFERENCES public.finance_periods(id),
  source      text NOT NULL,
  file_name   text,
  file_sha256 text NOT NULL,
  currency    char(3) NOT NULL,
  row_count   int NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'imported',
  imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT earnings_imports_source_check CHECK (length(source) BETWEEN 1 AND 80),
  CONSTRAINT earnings_imports_file_name_check CHECK (file_name IS NULL OR length(file_name) <= 200),
  CONSTRAINT earnings_imports_hash_check CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT earnings_imports_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT earnings_imports_rows_check CHECK (row_count >= 0),
  CONSTRAINT earnings_imports_status_check CHECK (status IN ('imported', 'void')),
  CONSTRAINT earnings_imports_one_per_file UNIQUE (org_id, file_sha256)
);

CREATE INDEX IF NOT EXISTS idx_earnings_imports_org ON public.earnings_imports (org_id, created_at DESC);
ALTER TABLE public.earnings_imports ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.earnings_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id    uuid NOT NULL REFERENCES public.earnings_imports(id) ON DELETE CASCADE,
  line_no      int NOT NULL,
  isrc         text,
  upc          text,
  track_id     uuid REFERENCES public.tracks(id) ON DELETE SET NULL,
  title        text,
  store        text,
  territory    text,
  units        bigint,
  gross_minor  bigint NOT NULL,
  currency     char(3) NOT NULL,
  period_start date,
  period_end   date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT earnings_lines_line_no_check CHECK (line_no >= 1),
  CONSTRAINT earnings_lines_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT earnings_lines_text_check CHECK (
    (isrc IS NULL OR length(isrc) <= 20) AND (upc IS NULL OR length(upc) <= 20) AND (title IS NULL OR length(title) <= 300)
    AND (store IS NULL OR length(store) <= 80) AND (territory IS NULL OR length(territory) <= 40)),
  CONSTRAINT earnings_lines_units_check CHECK (units IS NULL OR units >= 0),
  CONSTRAINT earnings_lines_unique_line UNIQUE (import_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_earnings_lines_org ON public.earnings_lines (org_id, import_id);
CREATE INDEX IF NOT EXISTS idx_earnings_lines_track ON public.earnings_lines (track_id) WHERE track_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_earnings_lines_unmatched ON public.earnings_lines (org_id) WHERE track_id IS NULL;
ALTER TABLE public.earnings_lines ENABLE ROW LEVEL SECURITY;

-- ── 5. statements / statement_lines ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.statements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payee_id          uuid NOT NULL REFERENCES public.payees(id),
  period_id         uuid NOT NULL REFERENCES public.finance_periods(id),
  artist_contact_id uuid REFERENCES public.contacts(id),
  currency          char(3) NOT NULL,
  net_minor         bigint NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'draft',
  approved_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  issued_at         timestamptz,
  voided_at         timestamptz,
  void_reason       text,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT statements_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT statements_status_check CHECK (status IN ('draft', 'approved', 'issued', 'void')),
  CONSTRAINT statements_approval_shape CHECK (status NOT IN ('approved', 'issued') OR approved_at IS NOT NULL),
  CONSTRAINT statements_issued_shape CHECK ((status = 'issued') = (issued_at IS NOT NULL) OR status = 'void'),
  CONSTRAINT statements_void_shape CHECK ((status = 'void') = (voided_at IS NOT NULL)),
  CONSTRAINT statements_reason_check CHECK (void_reason IS NULL OR length(void_reason) <= 500)
);

-- One live statement per payee per period.
CREATE UNIQUE INDEX IF NOT EXISTS statements_one_live_per_period
  ON public.statements (payee_id, period_id) WHERE status <> 'void';
CREATE INDEX IF NOT EXISTS idx_statements_org ON public.statements (org_id, period_id);
CREATE INDEX IF NOT EXISTS idx_statements_artist ON public.statements (org_id, artist_contact_id) WHERE artist_contact_id IS NOT NULL;
ALTER TABLE public.statements ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.statement_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  statement_id     uuid NOT NULL REFERENCES public.statements(id) ON DELETE CASCADE,
  kind             text NOT NULL,
  track_id         uuid REFERENCES public.tracks(id) ON DELETE SET NULL,
  earnings_line_id uuid REFERENCES public.earnings_lines(id) ON DELETE SET NULL,
  advance_id       uuid REFERENCES public.advances(id),
  description      text,
  share_units      int,
  amount_minor     bigint NOT NULL,
  currency         char(3) NOT NULL,
  position         int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT statement_lines_kind_check CHECK (kind IN ('earning', 'recoupment', 'adjustment')),
  CONSTRAINT statement_lines_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT statement_lines_desc_check CHECK (description IS NULL OR length(description) <= 200),
  CONSTRAINT statement_lines_share_check CHECK (share_units IS NULL OR share_units BETWEEN 0 AND 1000000),
  CONSTRAINT statement_lines_recoup_check CHECK (kind <> 'recoupment' OR amount_minor <= 0)
);

CREATE INDEX IF NOT EXISTS idx_statement_lines_statement ON public.statement_lines (org_id, statement_id, position);
ALTER TABLE public.statement_lines ENABLE ROW LEVEL SECURITY;

-- ── 6. payments (records only) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payee_id          uuid NOT NULL REFERENCES public.payees(id),
  statement_id      uuid REFERENCES public.statements(id),
  artist_contact_id uuid REFERENCES public.contacts(id),
  amount_minor      bigint NOT NULL,
  currency          char(3) NOT NULL,
  paid_on           date NOT NULL,
  reference         text,
  voided_at         timestamptz,
  voided_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_amount_check CHECK (amount_minor > 0),
  CONSTRAINT payments_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT payments_reference_check CHECK (
    reference IS NULL OR (length(reference) BETWEEN 1 AND 200 AND NOT public.labelos_looks_like_bank_number(reference)))
);

CREATE INDEX IF NOT EXISTS idx_payments_payee ON public.payments (org_id, payee_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_payments_statement ON public.payments (statement_id) WHERE statement_id IS NOT NULL;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- ── 7. Integrity triggers ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.payees_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT p.contact_id INTO v_contact FROM public.parties p WHERE p.id = NEW.party_id AND p.org_id = NEW.org_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payees: the party belongs to another organization' USING ERRCODE = 'check_violation';
    END IF;
    -- The snapshot: only ever what the party said when the payee was made, never what the writer sent.
    IF v_contact IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = v_contact AND c.org_id = NEW.org_id) THEN
      v_contact := NULL;
    END IF;
    NEW.artist_contact_id := v_contact;
  ELSE
    IF NEW.org_id <> OLD.org_id OR NEW.party_id <> OLD.party_id OR NEW.artist_contact_id IS DISTINCT FROM OLD.artist_contact_id THEN
      RAISE EXCEPTION 'payees: the organization, party and artist of a payee never change' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.currency <> OLD.currency AND (
      EXISTS (SELECT 1 FROM public.advances a WHERE a.payee_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.statements s WHERE s.payee_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.payments m WHERE m.payee_id = OLD.id)) THEN
      RAISE EXCEPTION 'payees: the currency cannot change once there are advances, statements or payments' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.payees_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.payees_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS payees_guard ON public.payees;
CREATE TRIGGER payees_guard BEFORE INSERT OR UPDATE ON public.payees
  FOR EACH ROW EXECUTE FUNCTION public.payees_guard();

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
    RAISE EXCEPTION 'finance_periods: a closed period stays closed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.finance_periods_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finance_periods_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS finance_periods_guard ON public.finance_periods;
CREATE TRIGGER finance_periods_guard BEFORE INSERT OR UPDATE ON public.finance_periods
  FOR EACH ROW EXECUTE FUNCTION public.finance_periods_guard();
-- A period's dates never move; its label and its close do.
DROP TRIGGER IF EXISTS finance_periods_frozen ON public.finance_periods;
CREATE TRIGGER finance_periods_frozen BEFORE UPDATE OR DELETE ON public.finance_periods
  FOR EACH ROW EXECUTE FUNCTION public.labelos_finance_frozen('label', 'status', 'closed_by', 'closed_at');

CREATE OR REPLACE FUNCTION public.advances_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payee public.payees%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_payee FROM public.payees p WHERE p.id = NEW.payee_id AND p.org_id = NEW.org_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'advances: the payee belongs to another organization' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.currency <> v_payee.currency THEN
      RAISE EXCEPTION 'advances: an advance is in the payee''s currency' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'advances: a new advance is not void' USING ERRCODE = 'check_violation';
    END IF;
    NEW.artist_contact_id := v_payee.artist_contact_id;
  ELSIF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'advances: a void advance is final' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.advances_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.advances_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS advances_guard ON public.advances;
CREATE TRIGGER advances_guard BEFORE INSERT OR UPDATE ON public.advances
  FOR EACH ROW EXECUTE FUNCTION public.advances_guard();
DROP TRIGGER IF EXISTS advances_frozen ON public.advances;
CREATE TRIGGER advances_frozen BEFORE UPDATE OR DELETE ON public.advances
  FOR EACH ROW EXECUTE FUNCTION public.labelos_finance_frozen('note', 'voided_at', 'voided_by');

CREATE OR REPLACE FUNCTION public.earnings_imports_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.period_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.finance_periods p WHERE p.id = NEW.period_id AND p.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'earnings_imports: the period belongs to another organization' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.status = 'void' AND NEW.status <> 'void' THEN
    RAISE EXCEPTION 'earnings_imports: a void import is final' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.earnings_imports_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.earnings_imports_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS earnings_imports_guard ON public.earnings_imports;
CREATE TRIGGER earnings_imports_guard BEFORE INSERT OR UPDATE ON public.earnings_imports
  FOR EACH ROW EXECUTE FUNCTION public.earnings_imports_guard();
DROP TRIGGER IF EXISTS earnings_imports_frozen ON public.earnings_imports;
CREATE TRIGGER earnings_imports_frozen BEFORE UPDATE OR DELETE ON public.earnings_imports
  FOR EACH ROW EXECUTE FUNCTION public.labelos_finance_frozen('status');

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
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.earnings_lines_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.earnings_lines_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS earnings_lines_guard ON public.earnings_lines;
CREATE TRIGGER earnings_lines_guard BEFORE INSERT OR UPDATE ON public.earnings_lines
  FOR EACH ROW EXECUTE FUNCTION public.earnings_lines_guard();
-- Only the match can change (the FK to tracks nulls it when a recording is deleted).
DROP TRIGGER IF EXISTS earnings_lines_frozen ON public.earnings_lines;
CREATE TRIGGER earnings_lines_frozen BEFORE UPDATE OR DELETE ON public.earnings_lines
  FOR EACH ROW EXECUTE FUNCTION public.labelos_finance_frozen('track_id');

CREATE OR REPLACE FUNCTION public.statements_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payee public.payees%ROWTYPE;
  v_sum   numeric;
  v_n     int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A draft may be thrown away; anything that left draft is voided, never deleted. The org's purge passes.
    IF OLD.status <> 'draft' AND NOT public.labelos_finance_org_gone(OLD.org_id) THEN
      RAISE EXCEPTION 'statements: a statement that left draft is voided, not deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_payee FROM public.payees p WHERE p.id = NEW.payee_id AND p.org_id = NEW.org_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'statements: the payee belongs to another organization' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.finance_periods fp WHERE fp.id = NEW.period_id AND fp.org_id = NEW.org_id AND fp.status = 'open') THEN
      RAISE EXCEPTION 'statements: the period is not one of this organization''s open periods' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.currency <> v_payee.currency THEN
      RAISE EXCEPTION 'statements: a statement is in the payee''s currency' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'draft' OR NEW.net_minor <> 0 THEN
      RAISE EXCEPTION 'statements: a statement starts as an empty draft' USING ERRCODE = 'check_violation';
    END IF;
    NEW.artist_contact_id := v_payee.artist_contact_id;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.org_id <> OLD.org_id OR NEW.payee_id <> OLD.payee_id OR NEW.period_id <> OLD.period_id
     OR NEW.currency <> OLD.currency OR NEW.artist_contact_id IS DISTINCT FROM OLD.artist_contact_id THEN
    RAISE EXCEPTION 'statements: the payee, period and currency of a statement never change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'draft'    AND NEW.status IN ('approved', 'void'))
    OR (OLD.status = 'approved' AND NEW.status IN ('issued', 'void'))
    OR (OLD.status = 'issued'   AND NEW.status = 'void')) THEN
    RAISE EXCEPTION 'statements: % cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- Approval is written once.
  IF OLD.approved_at IS NOT NULL AND (NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approved_by IS DISTINCT FROM OLD.approved_by) THEN
    RAISE EXCEPTION 'statements: an approval is never rewritten' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.issued_at IS NOT NULL AND NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION 'statements: the issue date is never rewritten' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'draft' AND NEW.net_minor <> OLD.net_minor THEN
    RAISE EXCEPTION 'statements: the total is fixed once the statement leaves draft' USING ERRCODE = 'check_violation';
  END IF;
  -- Leaving draft for approved: the total must be the sum of the lines.
  IF OLD.status = 'draft' AND NEW.status = 'approved' THEN
    SELECT COALESCE(sum(l.amount_minor), 0), count(*) INTO v_sum, v_n FROM public.statement_lines l WHERE l.statement_id = OLD.id;
    IF v_sum <> NEW.net_minor THEN
      RAISE EXCEPTION 'statements: the total does not equal the sum of its lines' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.statements_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.statements_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS statements_guard ON public.statements;
CREATE TRIGGER statements_guard BEFORE INSERT OR UPDATE OR DELETE ON public.statements
  FOR EACH ROW EXECUTE FUNCTION public.statements_guard();

CREATE OR REPLACE FUNCTION public.statement_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_st public.statements%ROWTYPE;
BEGIN
  -- FOR SHARE: approving a statement locks it FOR UPDATE, so a line written at the same moment either
  -- lands before the sum is read or finds a statement that is no longer a draft.
  SELECT * INTO v_st FROM public.statements s
  WHERE s.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.statement_id ELSE NEW.statement_id END
  FOR SHARE;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; -- the statement is going (cascade)
    RAISE EXCEPTION 'statement_lines: the statement does not exist' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF v_st.status <> 'draft' AND NOT public.labelos_finance_org_gone(OLD.org_id) THEN
      RAISE EXCEPTION 'statement_lines: a statement that left draft cannot be edited' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  -- The one change a frozen line takes: a reference that vanished (the FK nulls the recording or the
  -- earnings line when that row is deleted). The amounts stay.
  IF TG_OP = 'UPDATE' AND v_st.status <> 'draft'
     AND (to_jsonb(NEW) - 'track_id' - 'earnings_line_id') = (to_jsonb(OLD) - 'track_id' - 'earnings_line_id')
     AND (NEW.track_id IS NULL OR NEW.track_id = OLD.track_id)
     AND (NEW.earnings_line_id IS NULL OR NEW.earnings_line_id = OLD.earnings_line_id) THEN
    RETURN NEW;
  END IF;
  IF v_st.status <> 'draft' THEN
    RAISE EXCEPTION 'statement_lines: a statement that left draft cannot be edited' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.statement_id <> OLD.statement_id THEN
    RAISE EXCEPTION 'statement_lines: a line stays on its statement' USING ERRCODE = 'check_violation';
  END IF;
  NEW.org_id := v_st.org_id;
  IF NEW.currency <> v_st.currency THEN
    RAISE EXCEPTION 'statement_lines: a line is in its statement''s currency' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.track_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.track_id AND t.org_id = v_st.org_id) THEN
    RAISE EXCEPTION 'statement_lines: the recording belongs to another organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.earnings_line_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.earnings_lines e WHERE e.id = NEW.earnings_line_id AND e.org_id = v_st.org_id) THEN
    RAISE EXCEPTION 'statement_lines: the earnings line belongs to another organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.advance_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.advances a WHERE a.id = NEW.advance_id AND a.org_id = v_st.org_id AND a.payee_id = v_st.payee_id) THEN
    RAISE EXCEPTION 'statement_lines: the advance is not this payee''s' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.statement_lines_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.statement_lines_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS statement_lines_guard ON public.statement_lines;
CREATE TRIGGER statement_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.statement_lines
  FOR EACH ROW EXECUTE FUNCTION public.statement_lines_guard();

CREATE OR REPLACE FUNCTION public.payments_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payee public.payees%ROWTYPE;
  v_st    public.statements%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_payee FROM public.payees p WHERE p.id = NEW.payee_id AND p.org_id = NEW.org_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payments: the payee belongs to another organization' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.currency <> v_payee.currency THEN
      RAISE EXCEPTION 'payments: a payment is in the payee''s currency' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'payments: a new payment is not void' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.statement_id IS NOT NULL THEN
      SELECT * INTO v_st FROM public.statements s WHERE s.id = NEW.statement_id AND s.org_id = NEW.org_id AND s.payee_id = NEW.payee_id;
      IF NOT FOUND OR v_st.status <> 'issued' THEN
        RAISE EXCEPTION 'payments: a payment is recorded against an issued statement of the same payee' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    NEW.artist_contact_id := v_payee.artist_contact_id;
  ELSIF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'payments: a void payment is final' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.payments_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.payments_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS payments_guard ON public.payments;
CREATE TRIGGER payments_guard BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_guard();
DROP TRIGGER IF EXISTS payments_frozen ON public.payments;
CREATE TRIGGER payments_frozen BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.labelos_finance_frozen('voided_at', 'voided_by');

-- Writes are the service role's (141): no API role can write a finance row.
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.payees;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.payees
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.finance_periods;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.finance_periods
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.advances;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.advances
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.earnings_imports;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.earnings_imports
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.earnings_lines;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.earnings_lines
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.statements;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.statements
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.statement_lines;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.statement_lines
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.payments;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');

-- ── 8. Reads ─────────────────────────────────────────────────────────────

-- The payees that ARE the caller. One call, no argument that varies by row.
-- A payee is the caller's when its snapshot artist is
--   (a) a roster contact in the caller's member_artist_scopes, and the caller's role is `artist`; or
--   (b) the one self artist of an ARTIST org the caller owns (contacts.org_self_artist, 166).
-- Never through parties.user_id: a party linked to an account is a rights identity, not an
-- authorisation to read a payee's money (LABEL-71 H1).
CREATE OR REPLACE FUNCTION public.labelos_my_payees()
RETURNS TABLE (payee_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.payees p
  JOIN public.organizations o ON o.id = p.org_id AND o.deleted_at IS NULL AND o.kind IN ('label', 'artist')
  WHERE p.artist_contact_id IS NOT NULL
    AND p.org_id IN (SELECT m.org_id FROM public.org_members m WHERE m.user_id = auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.org_entitlements e
      WHERE e.org_id = p.org_id AND NOT ('finance' = ANY (coalesce(e.modules, '{}')))
    )
    AND (
      (
        EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p.org_id AND m.user_id = auth.uid() AND m.role = 'artist')
        AND (p.org_id, p.artist_contact_id) IN (SELECT s.org_id, s.contact_id FROM public.member_artist_scopes s WHERE s.user_id = auth.uid())
      )
      OR (
        o.kind = 'artist'
        AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p.org_id AND m.user_id = auth.uid() AND m.role = 'owner')
        AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p.artist_contact_id AND c.org_id = p.org_id AND c.org_self_artist)
      )
    );
$$;

ALTER FUNCTION public.labelos_my_payees() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_my_payees() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.labelos_my_payees() TO authenticated, anon;

-- Columns: no API role reads the free text finance keeps (payment_reference, the advance note,
-- a payment's reference). The routes (service role) serve them to finance.write readers only —
-- a column grant cannot ask for a capability, so the grant guarantees nothing else bypasses it.
REVOKE ALL ON public.payees, public.finance_periods, public.advances, public.earnings_imports, public.earnings_lines,
              public.statements, public.statement_lines, public.payments FROM anon, authenticated;

GRANT SELECT (id, org_id, party_id, artist_contact_id, currency, status, created_by, created_at, updated_at)
  ON public.payees TO authenticated;
GRANT SELECT (id, org_id, label, starts_on, ends_on, status, closed_by, closed_at, created_by, created_at)
  ON public.finance_periods TO authenticated;
GRANT SELECT (id, org_id, payee_id, artist_contact_id, kind, amount_minor, currency, paid_on, voided_at, voided_by, created_by, created_at)
  ON public.advances TO authenticated;
GRANT SELECT (id, org_id, period_id, source, file_name, file_sha256, currency, row_count, total_minor, status, imported_by, created_at)
  ON public.earnings_imports TO authenticated;
GRANT SELECT (id, org_id, import_id, line_no, isrc, upc, track_id, title, store, territory, units, gross_minor, currency, period_start, period_end, created_at)
  ON public.earnings_lines TO authenticated;
GRANT SELECT (id, org_id, payee_id, period_id, artist_contact_id, currency, net_minor, status, approved_by, approved_at, issued_at, voided_at, created_by, created_at, updated_at)
  ON public.statements TO authenticated;
GRANT SELECT (id, org_id, statement_id, kind, track_id, earnings_line_id, advance_id, description, share_units, amount_minor, currency, position, created_at)
  ON public.statement_lines TO authenticated;
GRANT SELECT (id, org_id, payee_id, statement_id, artist_contact_id, amount_minor, currency, paid_on, voided_at, voided_by, recorded_by, created_at)
  ON public.payments TO authenticated;

-- payees
DROP POLICY IF EXISTS payees_member_read ON public.payees;
CREATE POLICY payees_member_read ON public.payees
  FOR SELECT
  USING (
    (
      org_id IN (
        SELECT cm.org_id FROM public.org_members cm
        WHERE cm.user_id = (SELECT auth.uid()) AND cm.role <> 'artist' AND public.has_org_cap(cm.org_id, 'finance.read')
      )
      AND (
        org_id IN (SELECT om.org_id FROM public.org_members om WHERE om.user_id = (SELECT auth.uid()) AND om.scope = 'org' AND om.role <> 'artist')
        OR (org_id, artist_contact_id) IN (SELECT s.org_id, s.contact_id FROM public.member_artist_scopes s WHERE s.user_id = (SELECT auth.uid()))
      )
    )
    OR id IN (SELECT mp.payee_id FROM public.labelos_my_payees() mp)
  );

-- periods: whole-org finance readers; and the period of any statement the caller can read
DROP POLICY IF EXISTS finance_periods_member_read ON public.finance_periods;
CREATE POLICY finance_periods_member_read ON public.finance_periods
  FOR SELECT
  USING (
    org_id IN (
      SELECT cm.org_id FROM public.org_members cm
      WHERE cm.user_id = (SELECT auth.uid()) AND cm.role <> 'artist' AND cm.scope = 'org' AND public.has_org_cap(cm.org_id, 'finance.read')
    )
    OR (org_id, id) IN (SELECT s.org_id, s.period_id FROM public.statements s)
  );

-- advances: staff only
DROP POLICY IF EXISTS advances_member_read ON public.advances;
CREATE POLICY advances_member_read ON public.advances
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

-- earnings: whole-org finance readers only (a line is not per-artist until it is matched and allocated)
DROP POLICY IF EXISTS earnings_imports_member_read ON public.earnings_imports;
CREATE POLICY earnings_imports_member_read ON public.earnings_imports
  FOR SELECT
  USING (
    org_id IN (
      SELECT cm.org_id FROM public.org_members cm
      WHERE cm.user_id = (SELECT auth.uid()) AND cm.role <> 'artist' AND cm.scope = 'org' AND public.has_org_cap(cm.org_id, 'finance.read')
    )
  );

DROP POLICY IF EXISTS earnings_lines_member_read ON public.earnings_lines;
CREATE POLICY earnings_lines_member_read ON public.earnings_lines
  FOR SELECT
  USING (
    org_id IN (
      SELECT cm.org_id FROM public.org_members cm
      WHERE cm.user_id = (SELECT auth.uid()) AND cm.role <> 'artist' AND cm.scope = 'org' AND public.has_org_cap(cm.org_id, 'finance.read')
    )
  );

-- statements: staff (any status) in scope; the artist's own payee, ISSUED only
DROP POLICY IF EXISTS statements_member_read ON public.statements;
CREATE POLICY statements_member_read ON public.statements
  FOR SELECT
  USING (
    (
      org_id IN (
        SELECT cm.org_id FROM public.org_members cm
        WHERE cm.user_id = (SELECT auth.uid()) AND cm.role <> 'artist' AND public.has_org_cap(cm.org_id, 'finance.read')
      )
      AND (
        org_id IN (SELECT om.org_id FROM public.org_members om WHERE om.user_id = (SELECT auth.uid()) AND om.scope = 'org' AND om.role <> 'artist')
        OR (org_id, artist_contact_id) IN (SELECT s.org_id, s.contact_id FROM public.member_artist_scopes s WHERE s.user_id = (SELECT auth.uid()))
      )
    )
    OR (status = 'issued' AND payee_id IN (SELECT mp.payee_id FROM public.labelos_my_payees() mp))
  );

-- A statement's lines are readable exactly where the statement is.
DROP POLICY IF EXISTS statement_lines_member_read ON public.statement_lines;
CREATE POLICY statement_lines_member_read ON public.statement_lines
  FOR SELECT
  USING (
    org_id IN (SELECT mm.org_id FROM public.org_members mm WHERE mm.user_id = (SELECT auth.uid()))
    AND (org_id, statement_id) IN (SELECT s.org_id, s.id FROM public.statements s)
  );

-- payments: staff in scope; the artist's own payee's, not voided, and (when tied to a statement) of an issued statement
DROP POLICY IF EXISTS payments_member_read ON public.payments;
CREATE POLICY payments_member_read ON public.payments
  FOR SELECT
  USING (
    (
      org_id IN (
        SELECT cm.org_id FROM public.org_members cm
        WHERE cm.user_id = (SELECT auth.uid()) AND cm.role <> 'artist' AND public.has_org_cap(cm.org_id, 'finance.read')
      )
      AND (
        org_id IN (SELECT om.org_id FROM public.org_members om WHERE om.user_id = (SELECT auth.uid()) AND om.scope = 'org' AND om.role <> 'artist')
        OR (org_id, artist_contact_id) IN (SELECT s.org_id, s.contact_id FROM public.member_artist_scopes s WHERE s.user_id = (SELECT auth.uid()))
      )
    )
    OR (
      voided_at IS NULL
      AND payee_id IN (SELECT mp.payee_id FROM public.labelos_my_payees() mp)
      AND (statement_id IS NULL OR (org_id, statement_id) IN (SELECT s.org_id, s.id FROM public.statements s))
    )
  );

NOTIFY pgrst, 'reload schema';
