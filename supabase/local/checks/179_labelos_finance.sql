-- Behaviour checks for 179_labelos_finance.sql (LABEL-61), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- Proven as the roles PostgREST uses (anon / authenticated), allow AND deny:
--   · staff with finance.read read payees / statements / lines / payments; staff
--     without it read nothing; staff scoped to ONE artist read only that
--     artist's rows (and no earnings); a roster artist reads only their own
--     payee and its ISSUED statements, lines and payments — never a draft, never
--     another artist's, never an advance or an earnings row;
--   · a party LINKED TO an artist's account (LABEL-71 H1) does not read the
--     payee of someone else's party; re-pointing a party's contact later does
--     not move the payee's artist;
--   · an external project member, an owner of ANOTHER org, anon: nothing;
--   · an org without the finance module reads nothing through any path;
--   · no API role can write; the free-text columns are unreadable (column grants);
--   · integrity: same-org parents, currency match, frozen statements and lines,
--     total = sum of lines, one live statement per payee and period, append-only
--     approval, payments only against an issued statement, void-once;
--   · the org's hard delete still takes everything, even issued statements.
--
-- Cast: label L, owner O, finance member F (whole org), scoped finance member S
-- (artist A1 only), marketing member N (no finance.read), roster artists R1
-- (scoped A1), R2 (scoped A2), external project member E; stranger label L2
-- (owner Z); artist org AR (owner X, self artist CA).

\set O  '''a1790000-0000-4000-8000-000000000001'''
\set F  '''a1790000-0000-4000-8000-000000000002'''
\set S  '''a1790000-0000-4000-8000-000000000003'''
\set N  '''a1790000-0000-4000-8000-000000000004'''
\set R1 '''a1790000-0000-4000-8000-000000000005'''
\set R2 '''a1790000-0000-4000-8000-000000000006'''
\set E  '''a1790000-0000-4000-8000-000000000007'''
\set Z  '''a1790000-0000-4000-8000-000000000008'''
\set X  '''a1790000-0000-4000-8000-000000000009'''
\set L  '''b1790000-0000-4000-8000-000000000001'''
\set L2 '''b1790000-0000-4000-8000-000000000002'''
\set AR '''b1790000-0000-4000-8000-000000000003'''
\set A1 '''c1790000-0000-4000-8000-0000000000a1'''
\set A2 '''c1790000-0000-4000-8000-0000000000a2'''
\set CX '''c1790000-0000-4000-8000-0000000000a3'''
\set CA '''c1790000-0000-4000-8000-0000000000a4'''
\set P1 '''d1790000-0000-4000-8000-000000000001'''
\set P2 '''d1790000-0000-4000-8000-000000000002'''
\set P3 '''d1790000-0000-4000-8000-000000000003'''
\set PX '''d1790000-0000-4000-8000-000000000004'''
\set PA '''d1790000-0000-4000-8000-000000000005'''
\set PJ '''e1790000-0000-4000-8000-000000000001'''
\set PY1 '''e2790000-0000-4000-8000-000000000001'''
\set PY2 '''e2790000-0000-4000-8000-000000000002'''
\set PY3 '''e2790000-0000-4000-8000-000000000003'''
\set PYX '''e2790000-0000-4000-8000-000000000004'''
\set PYA '''e2790000-0000-4000-8000-000000000005'''
\set PER '''e3790000-0000-4000-8000-000000000001'''
\set PERX '''e3790000-0000-4000-8000-000000000002'''
\set ST1 '''e4790000-0000-4000-8000-000000000001'''
\set ST2 '''e4790000-0000-4000-8000-000000000002'''
\set ST3 '''e4790000-0000-4000-8000-000000000003'''
\set STA '''e4790000-0000-4000-8000-000000000005'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o179@local.test'), (:F, 'f179@local.test'), (:S, 's179@local.test'), (:N, 'n179@local.test'),
  (:R1, 'r1179@local.test'), (:R2, 'r2179@local.test'), (:E, 'e179@local.test'), (:Z, 'z179@local.test'), (:X, 'x179@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-179', 'label', :O),
  (:L2, 'Label L2', 'label-l2-179', 'label', :Z),
  (:AR, 'Artist AR', 'artist-ar-179', 'artist', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :F, 'member', '{finance}', 'org'),
  (:L, :S, 'member', '{finance}', 'artists'),
  (:L, :N, 'member', '{marketing}', 'org'),
  (:L, :R1, 'artist', '{}', 'artists'),
  (:L, :R2, 'artist', '{}', 'artists'),
  (:L2, :Z, 'owner', '{}', 'org'),
  (:AR, :X, 'owner', '{}', 'org');
UPDATE public.contacts SET id = :CA WHERE org_id = :AR AND org_self_artist;
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:A1, NULL, :L, 'Ara', 'ara179@local.test', 'artist'),
  (:A2, NULL, :L, 'Bo', 'bo179@local.test', 'artist'),
  (:CX, NULL, :L2, 'Other', 'other179@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES
  (:L, :S, :A1), (:L, :R1, :A1), (:L, :R2, :A2);
INSERT INTO public.projects (id, user_id, org_id, name) VALUES (:PJ, NULL, :L, 'Ara EP');
INSERT INTO public.project_members (org_id, project_id, user_id, role) VALUES (:L, :PJ, :E, 'editor');

-- P1 is Ara's party; it is LINKED TO R2's account (a party's account proves nothing about money).
INSERT INTO public.parties (id, org_id, kind, display_name, contact_id, user_id) VALUES
  (:P1, :L, 'person', 'Ara', :A1, :R2),
  (:P2, :L, 'person', 'Bo', :A2, NULL),
  (:P3, :L, 'person', 'Producer Pat', NULL, :N),
  (:PX, :L2, 'person', 'Other', :CX, NULL),
  (:PA, :AR, 'person', 'Ara AR', :CA, NULL);

CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;
CREATE FUNCTION public.check_raises(label text, stmt text, pattern text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~* pattern THEN RETURN; END IF;
    RAISE EXCEPTION 'CHECK FAILED: % — raised "%", wanted /%/', label, SQLERRM, pattern;
  END;
  RAISE EXCEPTION 'CHECK FAILED: % — statement succeeded, wanted /%/', label, pattern;
END $$;
CREATE FUNCTION public.as_user(p_user text) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
-- Rows the CURRENT role can see (runs as the caller, so RLS applies).
CREATE FUNCTION public.vis(p_table text) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE format('SELECT count(*)::int FROM public.%I', p_table) INTO n;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.as_user(text), public.vis(text) TO anon, authenticated;

-- ── Shape ───────────────────────────────────────────────────────────────

SELECT public.check_eq('all eight tables have RLS on and no user_id',
  (SELECT count(*)::int FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relrowsecurity
     AND c.relname IN ('payees', 'finance_periods', 'advances', 'earnings_imports', 'earnings_lines', 'statements', 'statement_lines', 'payments')
     AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped)), 8);
SELECT public.check_eq('no money column is numeric or float',
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public'
     AND table_name IN ('payees', 'finance_periods', 'advances', 'earnings_imports', 'earnings_lines', 'statements', 'statement_lines', 'payments')
     AND (column_name LIKE '%\_minor' ESCAPE '\') AND data_type <> 'bigint'), 0);
SELECT public.check_eq('payments carries no processor or account column',
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payments'
     AND column_name ~* 'stripe|processor|account|iban|transfer|payout|method|bank'), 0);

-- ── Payees: the snapshot ────────────────────────────────────────────────

INSERT INTO public.payees (id, org_id, party_id, artist_contact_id, currency, created_by) VALUES
  (:PY1, :L, :P1, :A1, 'USD', :F), (:PY2, :L, :P2, :A2, 'USD', :F), (:PY3, :L, :P3, NULL, 'EUR', :F), (:PYX, :L2, :PX, :CX, 'USD', :Z), (:PYA, :AR, :PA, :CA, 'USD', :X);
SELECT public.check_raises('a payee naming an artist the party does not have is refused (party re-pointed / wrong artist)',
  format($$INSERT INTO public.payees (org_id, party_id, artist_contact_id) VALUES (%L, %L, %L)$$, 'b1790000-0000-4000-8000-000000000001', 'd1790000-0000-4000-8000-000000000003', 'c1790000-0000-4000-8000-0000000000a1'),
  'party_contact_changed');
SELECT public.check_raises('a payee omitting the artist its party has is refused',
  format($$UPDATE public.parties SET contact_id = %L WHERE id = %L; INSERT INTO public.payees (org_id, party_id) VALUES (%L, %L)$$, 'c1790000-0000-4000-8000-0000000000a1', 'd1790000-0000-4000-8000-000000000003', 'b1790000-0000-4000-8000-000000000001', 'd1790000-0000-4000-8000-000000000003'),
  'party_contact_changed|payees_one_per_party');
UPDATE public.parties SET contact_id = NULL WHERE id = :P3;
SELECT public.check_eq('a payee takes the party''s roster contact as its artist',
  (SELECT artist_contact_id FROM public.payees WHERE id = 'e2790000-0000-4000-8000-000000000001'), 'c1790000-0000-4000-8000-0000000000a1'::uuid);
SELECT public.check_eq('a party with no contact makes a payee with no artist',
  (SELECT artist_contact_id IS NULL FROM public.payees WHERE id = 'e2790000-0000-4000-8000-000000000003'), true);
SELECT public.check_raises('one payee per party',
  format($$INSERT INTO public.payees (org_id, party_id, artist_contact_id) VALUES (%L, %L, %L)$$, 'b1790000-0000-4000-8000-000000000001', 'd1790000-0000-4000-8000-000000000001', 'c1790000-0000-4000-8000-0000000000a1'),
  'payees_one_per_party|duplicate key');
SELECT public.check_raises('a party of another organization is refused',
  format($$INSERT INTO public.payees (org_id, party_id) VALUES (%L, %L)$$, 'b1790000-0000-4000-8000-000000000001', 'd1790000-0000-4000-8000-000000000004'),
  'belongs to another organization');
SELECT public.check_raises('a lower-case currency is refused',
  format($$UPDATE public.payees SET currency = 'usd' WHERE id = %L$$, 'e2790000-0000-4000-8000-000000000001'), 'currency_check');
SELECT public.check_raises('an account-number-looking reference is refused',
  format($$UPDATE public.payees SET payment_reference = 'GB29 NWBK 6016 1331 9268 19' WHERE id = %L$$, 'e2790000-0000-4000-8000-000000000001'), 'reference_check');
UPDATE public.payees SET payment_reference = 'Wire details on file with finance' WHERE id = :PY1;

-- Re-pointing the party at another contact, or linking it to another account, moves nobody.
UPDATE public.parties SET contact_id = :A2 WHERE id = :P1;
SELECT public.check_eq('re-pointing a party does not move the payee''s artist',
  (SELECT artist_contact_id FROM public.payees WHERE id = 'e2790000-0000-4000-8000-000000000001'), 'c1790000-0000-4000-8000-0000000000a1'::uuid);
UPDATE public.parties SET contact_id = :A1 WHERE id = :P1;
SELECT public.check_raises('the artist of a payee never changes',
  format($$UPDATE public.payees SET artist_contact_id = %L WHERE id = %L$$, 'c1790000-0000-4000-8000-0000000000a2', 'e2790000-0000-4000-8000-000000000001'),
  'never change');

-- ── Period, statements, lines ───────────────────────────────────────────

INSERT INTO public.finance_periods (id, org_id, label, starts_on, ends_on, created_by) VALUES
  (:PER, :L, '2026 Q3', '2026-07-01', '2026-09-30', :F),
  (:PERX, :L2, '2026 Q3', '2026-07-01', '2026-09-30', :Z);
SELECT public.check_raises('a period must end on or after it starts',
  $$INSERT INTO public.finance_periods (org_id, label, starts_on, ends_on) VALUES ('b1790000-0000-4000-8000-000000000001', 'x', '2026-10-02', '2026-10-01')$$, 'range_check');
SELECT public.check_raises('a period cannot be a duplicate range',
  $$INSERT INTO public.finance_periods (org_id, label, starts_on, ends_on) VALUES ('b1790000-0000-4000-8000-000000000001', 'x', '2026-07-01', '2026-09-30')$$, 'unique_range|duplicate key');

INSERT INTO public.statements (id, org_id, payee_id, period_id, currency, created_by) VALUES
  (:ST1, :L, :PY1, :PER, 'USD', :F), (:ST2, :L, :PY2, :PER, 'USD', :F), (:ST3, :L, :PY3, :PER, 'EUR', :F);
SELECT public.check_eq('a statement takes its artist from its payee',
  (SELECT artist_contact_id FROM public.statements WHERE id = 'e4790000-0000-4000-8000-000000000001'), 'c1790000-0000-4000-8000-0000000000a1'::uuid);
SELECT public.check_raises('one live statement per payee per period',
  format($$INSERT INTO public.statements (org_id, payee_id, period_id, currency) VALUES (%L, %L, %L, 'USD')$$, 'b1790000-0000-4000-8000-000000000001', 'e2790000-0000-4000-8000-000000000001', 'e3790000-0000-4000-8000-000000000001'),
  'one_live_per_period|duplicate key');
SELECT public.check_raises('a statement is in its payee''s currency',
  format($$INSERT INTO public.statements (org_id, payee_id, period_id, currency) VALUES (%L, %L, %L, 'GBP')$$, 'b1790000-0000-4000-8000-000000000001', 'e2790000-0000-4000-8000-000000000003', 'e3790000-0000-4000-8000-000000000001'),
  'one_live_per_period|payee''s currency');
SELECT public.check_raises('a payee of another org is refused',
  format($$INSERT INTO public.statements (org_id, payee_id, period_id, currency) VALUES (%L, %L, %L, 'USD')$$, 'b1790000-0000-4000-8000-000000000001', 'e2790000-0000-4000-8000-000000000004', 'e3790000-0000-4000-8000-000000000001'),
  'another organization');
SELECT public.check_raises('a period of another org is refused',
  format($$INSERT INTO public.statements (org_id, payee_id, period_id, currency) VALUES (%L, %L, %L, 'EUR')$$, 'b1790000-0000-4000-8000-000000000001', 'e2790000-0000-4000-8000-000000000003', 'e3790000-0000-4000-8000-000000000002'),
  'open periods|one_live_per_period');

INSERT INTO public.statement_lines (org_id, statement_id, kind, description, amount_minor, currency, position) VALUES
  (:L, :ST1, 'earning', 'Streams', 100000, 'USD', 0),
  (:L, :ST1, 'recoupment', 'Advance recouped', -25000, 'USD', 1),
  (:L, :ST2, 'earning', 'Streams', 5000, 'USD', 0),
  (:L, :ST3, 'earning', 'Streams', 700, 'EUR', 0);
SELECT public.check_raises('a line is in its statement''s currency',
  format($$INSERT INTO public.statement_lines (org_id, statement_id, kind, amount_minor, currency) VALUES (%L, %L, 'earning', 1, 'EUR')$$, 'b1790000-0000-4000-8000-000000000001', 'e4790000-0000-4000-8000-000000000001'),
  'statement''s currency');
SELECT public.check_raises('a recoupment is a deduction',
  format($$INSERT INTO public.statement_lines (org_id, statement_id, kind, amount_minor, currency) VALUES (%L, %L, 'recoupment', 5, 'USD')$$, 'b1790000-0000-4000-8000-000000000001', 'e4790000-0000-4000-8000-000000000001'),
  'recoup_check');

SELECT public.check_raises('the total must equal the sum of the lines to leave draft',
  format($$UPDATE public.statements SET net_minor = 1, status = 'approved', approved_by = %L, approved_at = now() WHERE id = %L$$, 'a1790000-0000-4000-8000-000000000002', 'e4790000-0000-4000-8000-000000000001'),
  'sum of its lines');
SELECT public.check_raises('a draft cannot jump to issued',
  format($$UPDATE public.statements SET net_minor = 75000, status = 'issued', issued_at = now() WHERE id = %L$$, 'e4790000-0000-4000-8000-000000000001'),
  'cannot become');

-- Draft statements: the artist reads nothing yet.
SET ROLE authenticated;
SELECT public.as_user(:R1);
SELECT public.check_eq('a roster artist sees their own payee', public.vis('payees'), 1);
SELECT public.check_eq('a roster artist sees no DRAFT statement', public.vis('statements'), 0);
SELECT public.check_eq('...nor its lines', public.vis('statement_lines'), 0);
RESET ROLE;

UPDATE public.statements SET net_minor = 75000, status = 'approved', approved_by = :F, approved_at = now() WHERE id = :ST1;
SELECT public.check_raises('an approved statement''s lines are frozen',
  format($$INSERT INTO public.statement_lines (org_id, statement_id, kind, amount_minor, currency) VALUES (%L, %L, 'earning', 1, 'USD')$$, 'b1790000-0000-4000-8000-000000000001', 'e4790000-0000-4000-8000-000000000001'),
  'left draft');
SELECT public.check_raises('...and so are its existing lines',
  format($$DELETE FROM public.statement_lines WHERE statement_id = %L$$, 'e4790000-0000-4000-8000-000000000001'), 'left draft');
SELECT public.check_raises('...and its total',
  format($$UPDATE public.statements SET net_minor = 1 WHERE id = %L$$, 'e4790000-0000-4000-8000-000000000001'), 'total is fixed');
SELECT public.check_raises('an approval is never rewritten',
  format($$UPDATE public.statements SET approved_by = %L WHERE id = %L$$, 'a1790000-0000-4000-8000-000000000001', 'e4790000-0000-4000-8000-000000000001'),
  'approval is never rewritten');
SELECT public.check_raises('an approved statement is not deleted',
  format($$DELETE FROM public.statements WHERE id = %L$$, 'e4790000-0000-4000-8000-000000000001'), 'voided, not deleted');
SELECT public.check_raises('a payment needs an ISSUED statement',
  format($$INSERT INTO public.payments (org_id, payee_id, statement_id, amount_minor, currency, paid_on) VALUES (%L, %L, %L, 100, 'USD', '2026-10-05')$$, 'b1790000-0000-4000-8000-000000000001', 'e2790000-0000-4000-8000-000000000001', 'e4790000-0000-4000-8000-000000000001'),
  'issued statement');

SET ROLE authenticated;
SELECT public.as_user(:R1);
SELECT public.check_eq('an approved (not issued) statement is still hidden from the artist', public.vis('statements'), 0);
RESET ROLE;

UPDATE public.statements SET status = 'issued', issued_at = now() WHERE id = :ST1;
UPDATE public.statements SET net_minor = 5000, status = 'approved', approved_by = :F, approved_at = now() WHERE id = :ST2;
UPDATE public.statements SET status = 'issued', issued_at = now() WHERE id = :ST2;

INSERT INTO public.advances (id, org_id, payee_id, kind, amount_minor, currency, paid_on, note) VALUES
  ('e5790000-0000-4000-8000-000000000001', :L, :PY1, 'recoupable', 500000, 'USD', '2026-06-01', 'signing advance');
SELECT public.check_raises('an advance is in the payee''s currency',
  format($$INSERT INTO public.advances (org_id, payee_id, kind, amount_minor, currency) VALUES (%L, %L, 'recoupable', 5, 'EUR')$$, 'b1790000-0000-4000-8000-000000000001', 'e2790000-0000-4000-8000-000000000001'),
  'payee''s currency');
-- 182 (LABEL-64) lets an advance that nothing references change its amount, kind and date (checked in 182's
-- own file); its currency and payee never change, whatever references it.
SELECT public.check_raises('an advance currency never changes',
  format($$UPDATE public.advances SET currency = 'EUR' WHERE id = %L$$, 'e5790000-0000-4000-8000-000000000001'), 'never change');

INSERT INTO public.payments (id, org_id, payee_id, statement_id, amount_minor, currency, paid_on, reference, recorded_by) VALUES
  ('e6790000-0000-4000-8000-000000000001', :L, :PY1, :ST1, 75000, 'USD', '2026-10-05', 'paid by finance', :F),
  ('e6790000-0000-4000-8000-000000000002', :L, :PY2, :ST2, 5000, 'USD', '2026-10-05', NULL, :F);
SELECT public.check_raises('a payment is positive',
  format($$INSERT INTO public.payments (org_id, payee_id, amount_minor, currency, paid_on) VALUES (%L, %L, 0, 'USD', '2026-10-05')$$, 'b1790000-0000-4000-8000-000000000001', 'e2790000-0000-4000-8000-000000000001'), 'amount_check');
SELECT public.check_raises('a payment cannot be edited',
  format($$UPDATE public.payments SET amount_minor = 1 WHERE id = %L$$, 'e6790000-0000-4000-8000-000000000001'), 'fixed once written');
SELECT public.check_raises('a payment cannot be deleted',
  format($$DELETE FROM public.payments WHERE id = %L$$, 'e6790000-0000-4000-8000-000000000001'), 'never deleted');

INSERT INTO public.earnings_imports (id, org_id, period_id, source, file_name, file_sha256, currency, row_count, total_minor, imported_by) VALUES
  ('e7790000-0000-4000-8000-000000000001', :L, :PER, 'Distributor X', 'q3.csv', repeat('a', 64), 'USD', 1, 100000, :F);
INSERT INTO public.earnings_lines (org_id, import_id, line_no, isrc, gross_minor, currency) VALUES
  (:L, 'e7790000-0000-4000-8000-000000000001', 1, 'USABC2600001', 100000, 'USD');
SELECT public.check_raises('the same file imports once per org',
  format($$INSERT INTO public.earnings_imports (org_id, source, file_sha256, currency) VALUES (%L, 'again', %L, 'USD')$$, 'b1790000-0000-4000-8000-000000000001', repeat('a', 64)), 'one_per_file|duplicate key');
SELECT public.check_raises('an earnings line is fixed (only its match can change)',
  $$UPDATE public.earnings_lines SET gross_minor = 1$$, 'fixed once written');

-- ── Reads, as the roles PostgREST uses ──────────────────────────────────

SET ROLE authenticated;

-- Owner (whole org, finance.read)
SELECT public.as_user(:O);
SELECT public.check_eq('owner: payees', public.vis('payees'), 3);
SELECT public.check_eq('owner: periods', public.vis('finance_periods'), 1);
SELECT public.check_eq('owner: statements', public.vis('statements'), 3);
SELECT public.check_eq('owner: lines', public.vis('statement_lines'), 4);
SELECT public.check_eq('owner: payments', public.vis('payments'), 2);
SELECT public.check_eq('owner: advances', public.vis('advances'), 1);
SELECT public.check_eq('owner: earnings imports', public.vis('earnings_imports'), 1);
SELECT public.check_eq('owner: earnings lines', public.vis('earnings_lines'), 1);

-- Finance member (whole org)
SELECT public.as_user(:F);
SELECT public.check_eq('finance member: statements', public.vis('statements'), 3);
SELECT public.check_eq('finance member: earnings lines', public.vis('earnings_lines'), 1);

-- Finance member scoped to Ara only
SELECT public.as_user(:S);
SELECT public.check_eq('scoped finance: payees (Ara''s only)', public.vis('payees'), 1);
SELECT public.check_eq('scoped finance: statements (Ara''s only)', public.vis('statements'), 1);
SELECT public.check_eq('scoped finance: lines', public.vis('statement_lines'), 2);
SELECT public.check_eq('scoped finance: payments', public.vis('payments'), 1);
SELECT public.check_eq('scoped finance: advances', public.vis('advances'), 1);
SELECT public.check_eq('scoped finance: periods (the one their statement is in)', public.vis('finance_periods'), 1);
SELECT public.check_eq('scoped finance: no earnings imports', public.vis('earnings_imports'), 0);
SELECT public.check_eq('scoped finance: no earnings lines', public.vis('earnings_lines'), 0);

-- Marketing member: no finance.read
SELECT public.as_user(:N);
SELECT public.check_eq('no finance.read: payees', public.vis('payees'), 0);
SELECT public.check_eq('no finance.read: statements', public.vis('statements'), 0);
SELECT public.check_eq('no finance.read: payments', public.vis('payments'), 0);
SELECT public.check_eq('no finance.read: periods', public.vis('finance_periods'), 0);

-- Roster artist R1 (Ara): own payee, ISSUED statement, its lines, its payment; nothing else
SELECT public.as_user(:R1);
SELECT public.check_eq('artist R1: own payee only', public.vis('payees'), 1);
SELECT public.check_eq('artist R1: own issued statement only', public.vis('statements'), 1);
SELECT public.check_eq('artist R1: its lines', public.vis('statement_lines'), 2);
SELECT public.check_eq('artist R1: its payment', public.vis('payments'), 1);
SELECT public.check_eq('artist R1: the period of that statement', public.vis('finance_periods'), 1);
SELECT public.check_eq('artist R1: no advances', public.vis('advances'), 0);
SELECT public.check_eq('artist R1: no earnings imports', public.vis('earnings_imports'), 0);
SELECT public.check_eq('artist R1: no earnings lines', public.vis('earnings_lines'), 0);
SELECT public.check_eq('artist R1 sees Ara''s statement, not Bo''s',
  (SELECT string_agg(payee_id::text, ',') FROM public.statements), 'e2790000-0000-4000-8000-000000000001');

-- R2 is Bo's roster artist AND the account Ara's party is linked to: the link grants nothing
SELECT public.as_user(:R2);
SELECT public.check_eq('artist R2 sees only Bo''s payee (the party linked to their account is Ara''s)',
  (SELECT string_agg(id::text, ',') FROM public.payees), 'e2790000-0000-4000-8000-000000000002');
SELECT public.check_eq('artist R2 sees only Bo''s statement',
  (SELECT string_agg(payee_id::text, ',') FROM public.statements), 'e2790000-0000-4000-8000-000000000002');
SELECT public.check_eq('artist R2: lines of Bo''s statement only', public.vis('statement_lines'), 1);

-- External project member, other org's owner, owner of the artist org: nothing of L
SELECT public.as_user(:E);
SELECT public.check_eq('external member: payees', public.vis('payees'), 0);
SELECT public.check_eq('external member: statements', public.vis('statements'), 0);
SELECT public.check_eq('external member: payments', public.vis('payments'), 0);
SELECT public.as_user(:Z);
SELECT public.check_eq('another org''s owner reads only their own org''s payee', (SELECT string_agg(org_id::text, ',') FROM public.payees), 'b1790000-0000-4000-8000-000000000002');
SELECT public.check_eq('another org''s owner: no statements of L', public.vis('statements'), 0);
SELECT public.check_eq('another org''s owner: no lines of L', public.vis('statement_lines'), 0);
SELECT public.as_user(:X);
SELECT public.check_eq('artist-org owner reads their own org''s payee only', (SELECT string_agg(org_id::text, ',') FROM public.payees), 'b1790000-0000-4000-8000-000000000003');

-- Free-text columns are unreadable by every API role
SELECT public.as_user(:O);
SELECT public.check_raises('payment_reference is not readable', $$SELECT payment_reference FROM public.payees$$, 'permission denied');
SELECT public.check_raises('select * on payees is denied (no table-wide grant)', $$SELECT * FROM public.payees$$, 'permission denied');
SELECT public.check_raises('a payment''s reference is not readable', $$SELECT reference FROM public.payments$$, 'permission denied');
SELECT public.check_raises('an advance note is not readable', $$SELECT note FROM public.advances$$, 'permission denied');

-- No API role writes
SELECT public.check_raises('owner cannot insert a payee through the API',
  format($$INSERT INTO public.payees (org_id, party_id) VALUES (%L, %L)$$, 'b1790000-0000-4000-8000-000000000001', 'd1790000-0000-4000-8000-000000000002'), 'permission denied');
SELECT public.check_raises('owner cannot update a statement through the API',
  $$UPDATE public.statements SET status = 'void', voided_at = now()$$, 'permission denied');
SELECT public.check_raises('owner cannot delete a payment through the API', $$DELETE FROM public.payments$$, 'permission denied');
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_raises('anon reads no payees', $$SELECT count(*) FROM public.payees$$, 'permission denied');
SELECT public.check_raises('anon reads no statements', $$SELECT count(*) FROM public.statements$$, 'permission denied');
SELECT public.check_raises('anon reads no payments', $$SELECT count(*) FROM public.payments$$, 'permission denied');
RESET ROLE;

-- The artist ORG's owner is the artist for their own payee (the self-artist rule), without finance.read being the reason
INSERT INTO public.finance_periods (id, org_id, label, starts_on, ends_on) VALUES ('e3790000-0000-4000-8000-000000000003', :AR, 'AR Q3', '2026-07-01', '2026-09-30');
INSERT INTO public.statements (id, org_id, payee_id, period_id, currency) VALUES (:STA, :AR, :PYA, 'e3790000-0000-4000-8000-000000000003', 'USD');
SELECT public.check_eq('an artist org''s payee takes the org''s self artist',
  (SELECT artist_contact_id FROM public.payees WHERE id = 'e2790000-0000-4000-8000-000000000005'), 'c1790000-0000-4000-8000-0000000000a4'::uuid);
SELECT public.check_eq('the owner of an artist org is the artist for their own payee',
  (SELECT count(*)::int FROM (SELECT payee_id FROM public.labelos_my_payees()) t), 0); -- postgres has no auth.uid(): none
SET ROLE authenticated;
SELECT public.as_user(:X);
SELECT public.check_eq('artist-org owner: own payee through labelos_my_payees()', (SELECT count(*)::int FROM public.labelos_my_payees()), 1);
SELECT public.as_user(:R1);
SELECT public.check_eq('a roster artist of L: own payee through labelos_my_payees()', (SELECT count(*)::int FROM public.labelos_my_payees()), 1);
SELECT public.as_user(:O);
SELECT public.check_eq('the label''s owner is nobody''s payee', (SELECT count(*)::int FROM public.labelos_my_payees()), 0);
RESET ROLE;

-- ── The finance module off: nothing through any path ────────────────────

INSERT INTO public.org_entitlements (org_id, modules) VALUES (:L, ARRAY['contracts']);
SET ROLE authenticated;
SELECT public.as_user(:O);
SELECT public.check_eq('module off: owner reads no payee', public.vis('payees'), 0);
SELECT public.check_eq('module off: owner reads no statement', public.vis('statements'), 0);
SELECT public.as_user(:R1);
SELECT public.check_eq('module off: the artist reads nothing of their own', public.vis('statements') + public.vis('payees'), 0);
RESET ROLE;
DELETE FROM public.org_entitlements WHERE org_id = :L;

-- ── Voiding ─────────────────────────────────────────────────────────────

-- 181: a statement with a live payment is not voided; void the payment first.
UPDATE public.payments SET voided_at = now() WHERE statement_id = :ST2 AND voided_at IS NULL;
UPDATE public.statements SET status = 'void', voided_at = now(), void_reason = 'wrong period' WHERE id = :ST2;
SELECT public.check_eq('a void statement frees the payee''s period', (SELECT count(*)::int FROM public.statements WHERE payee_id = 'e2790000-0000-4000-8000-000000000002' AND status <> 'void'), 0);
SELECT public.check_raises('a void statement is final',
  format($$UPDATE public.statements SET status = 'issued', issued_at = now() WHERE id = %L$$, 'e4790000-0000-4000-8000-000000000002'), 'cannot become');
SET ROLE authenticated;
SELECT public.as_user(:R2);
SELECT public.check_eq('artist R2: a void statement is not shown', public.vis('statements'), 0);
RESET ROLE;
UPDATE public.payments SET voided_at = now(), voided_by = :F WHERE id = 'e6790000-0000-4000-8000-000000000001';
SELECT public.check_raises('a void payment is final',
  format($$UPDATE public.payments SET voided_at = NULL WHERE id = %L$$, 'e6790000-0000-4000-8000-000000000001'), 'void payment is final|fixed once written');
SET ROLE authenticated;
SELECT public.as_user(:R1);
SELECT public.check_eq('artist R1: a voided payment is hidden', public.vis('payments'), 0);
RESET ROLE;
UPDATE public.finance_periods SET status = 'closed', closed_by = :F, closed_at = now() WHERE id = :PER;
SELECT public.check_raises('a closed period stays closed',
  format($$UPDATE public.finance_periods SET status = 'open', closed_at = NULL WHERE id = %L$$, 'e3790000-0000-4000-8000-000000000001'), 'stays closed|closed_shape');
SELECT public.check_raises('a closed period takes no new statement',
  format($$INSERT INTO public.statements (org_id, payee_id, period_id, currency) VALUES (%L, %L, %L, 'USD')$$, 'b1790000-0000-4000-8000-000000000001', 'e2790000-0000-4000-8000-000000000002', 'e3790000-0000-4000-8000-000000000001'), 'open periods');

-- ── A recording deleted from under a frozen statement does not unfreeze it ──
INSERT INTO public.tracks (id, user_id, org_id, title, type, audio_url, created_by) VALUES ('e8790000-0000-4000-8000-000000000001', NULL, :L, 'Song', 'song', 'r2://private/orgs/x.wav', :O);
UPDATE public.earnings_lines SET track_id = 'e8790000-0000-4000-8000-000000000001';
DELETE FROM public.tracks WHERE id = 'e8790000-0000-4000-8000-000000000001';
SELECT public.check_eq('a deleted recording nulls the match, nothing else',
  (SELECT track_id IS NULL AND gross_minor = 100000 FROM public.earnings_lines LIMIT 1), true);

-- ── M1: deleting an account that wrote finance rows works, and changes nothing else ──
SELECT public.check_eq('setup: the finance member wrote rows', (SELECT count(*)::int FROM public.statements WHERE approved_by = 'a1790000-0000-4000-8000-000000000002'), 2);
DELETE FROM public.org_members WHERE user_id = 'a1790000-0000-4000-8000-000000000002';
DELETE FROM auth.users WHERE id = 'a1790000-0000-4000-8000-000000000002';
SELECT public.check_eq('account deleted: approved_by / created_by / recorded_by are nulled, the rows keep their amounts and status',
  (SELECT (SELECT count(*) FROM public.statements WHERE id = 'e4790000-0000-4000-8000-000000000001' AND approved_by IS NULL AND approved_at IS NOT NULL AND status = 'issued' AND net_minor = 75000 AND created_by IS NULL)
        + (SELECT count(*) FROM public.payments WHERE id = 'e6790000-0000-4000-8000-000000000001' AND recorded_by IS NULL AND amount_minor = 75000)
        + (SELECT count(*) FROM public.finance_periods WHERE id = 'e3790000-0000-4000-8000-000000000001' AND created_by IS NULL AND closed_by IS NULL AND status = 'closed'))::int, 3);
SELECT public.check_raises('...but a user column still cannot be changed to another user',
  format($$UPDATE public.payments SET recorded_by = %L WHERE id = %L$$, 'a1790000-0000-4000-8000-000000000001', 'e6790000-0000-4000-8000-000000000001'), 'fixed once written');

-- ── The party and the contact are protected by the payee's foreign keys ──
SELECT public.check_raises('a party named by a payee cannot be deleted',
  format($$DELETE FROM public.parties WHERE id = %L$$, 'd1790000-0000-4000-8000-000000000001'), 'foreign key|violates');

-- ── The org's hard delete takes it all, even issued statements and payments ──
DELETE FROM public.organizations WHERE id = :L;
SELECT public.check_eq('hard delete: nothing of the org is left',
  (SELECT (SELECT count(*) FROM public.payees WHERE org_id = 'b1790000-0000-4000-8000-000000000001')
        + (SELECT count(*) FROM public.finance_periods WHERE org_id = 'b1790000-0000-4000-8000-000000000001')
        + (SELECT count(*) FROM public.advances WHERE org_id = 'b1790000-0000-4000-8000-000000000001')
        + (SELECT count(*) FROM public.earnings_imports WHERE org_id = 'b1790000-0000-4000-8000-000000000001')
        + (SELECT count(*) FROM public.earnings_lines WHERE org_id = 'b1790000-0000-4000-8000-000000000001')
        + (SELECT count(*) FROM public.statements WHERE org_id = 'b1790000-0000-4000-8000-000000000001')
        + (SELECT count(*) FROM public.statement_lines WHERE org_id = 'b1790000-0000-4000-8000-000000000001')
        + (SELECT count(*) FROM public.payments WHERE org_id = 'b1790000-0000-4000-8000-000000000001'))::int, 0);
SELECT public.check_eq('hard delete: another org''s finance rows are untouched',
  (SELECT count(*)::int FROM public.payees WHERE org_id IN ('b1790000-0000-4000-8000-000000000002', 'b1790000-0000-4000-8000-000000000003')), 2);
