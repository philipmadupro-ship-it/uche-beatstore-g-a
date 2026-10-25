-- Behaviour checks for 174_labelos_parties_payee.sql (LABEL-54), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- What is proven, with each member's own JWT claims (as PostgREST reads) and as
-- anon:
--   1. THE PAYEE RULE — tax_id and payment_instructions are unreadable by name,
--      by `select *`, by filter, by ORDER BY and as a whole row, for EVERY API
--      role: a whole-org rights reader, the owner and anon included. The
--      service role (the routes) reads them. The columns that remain granted
--      are exactly the listed ones.
--   2. NO BANK NUMBER — the CHECK refuses an IBAN-looking and a card-looking
--      payment_instructions (the same corpus lib/labelos/payee.ts is tested
--      with), accepts plain instructions, and refuses a country that is not
--      two upper-case letters.
--   3. THE ROSTER ARTIST (role `artist`, scoped to Nova) reads no co-writer
--      party at all on their own JWT — not even one credited on their own song
--      — only the party that is THEM; staff keep what they had (A&R reads
--      every party, a staff member limited to Nova's artists reads the
--      scoped ones). The policy stays hashed-subplan only (R-08).
--   4. THE LOCK — while a sheet naming the party is a draft, the party can be
--      renamed and re-linked; once it is circulated, display_name and an
--      existing user_id are locked (check_violation), the legal fields are
--      not, an unlinked party can still be linked, and a party on no sheet is
--      untouched. A second version's circulation does not unlock a party that
--      the superseded sheet named (superseded is not draft).
--   5. WITHDRAW — the function removes the credit and writes ONE audit event
--      `credit.withdrawn` (audit, artist-visible, with the song's keys) in the
--      same step; a second call is not_found; a credit of another org is
--      not_found; authenticated and anon cannot call it; a secret-looking
--      payload key is refused.
--
-- Cast: label L: owner O; WR (legal → rights.write); FN (finance → finance.read
-- only); AR (A&R, rights.read, whole org); SC (A&R limited to Kilo); PRD
-- (producer: own line); ART (role artist, scoped to Nova); MK (marketing).
-- Parties: PA = PRD's own, PB = Nova's co-writer (no account), PC = ART's own,
-- PD = on no sheet. S1 = Nova's song with a composition sheet.

\set O    '''a1740000-0000-4000-8000-000000000001'''
\set WR   '''a1740000-0000-4000-8000-000000000002'''
\set FN   '''a1740000-0000-4000-8000-000000000003'''
\set AR   '''a1740000-0000-4000-8000-000000000004'''
\set SC   '''a1740000-0000-4000-8000-000000000005'''
\set PRD  '''a1740000-0000-4000-8000-000000000006'''
\set ART  '''a1740000-0000-4000-8000-000000000007'''
\set MK   '''a1740000-0000-4000-8000-000000000008'''
\set X    '''a1740000-0000-4000-8000-000000000009'''
\set L    '''b1740000-0000-4000-8000-000000000001'''
\set L2   '''b1740000-0000-4000-8000-000000000002'''
\set C1   '''c1740000-0000-4000-8000-0000000000c1'''
\set C2   '''c1740000-0000-4000-8000-0000000000c2'''
\set LP1  '''d1740000-0000-4000-8000-000000000011'''
\set LP2  '''d1740000-0000-4000-8000-000000000012'''
\set S1   '''e1740000-0000-4000-8000-000000000001'''
\set S2   '''e1740000-0000-4000-8000-000000000002'''
\set XS1  '''e1740000-0000-4000-8000-0000000000f1'''
\set PA   '''f1740000-0000-4000-8000-0000000000a1'''
\set PB   '''f1740000-0000-4000-8000-0000000000a2'''
\set PC   '''f1740000-0000-4000-8000-0000000000a3'''
\set PD   '''f1740000-0000-4000-8000-0000000000a4'''
\set PE   '''f1740000-0000-4000-8000-0000000000a5'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o174@local.test'), (:WR, 'wr174@local.test'), (:FN, 'fn174@local.test'), (:AR, 'ar174@local.test'), (:SC, 'sc174@local.test'),
  (:PRD, 'prd174@local.test'), (:ART, 'art174@local.test'), (:MK, 'mk174@local.test'), (:X, 'x174@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-174', 'label', :O),
  (:L2, 'Label L2', 'label-l2-174', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :WR, 'member', '{legal}', 'org'),
  (:L, :FN, 'member', '{finance}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org'),
  (:L, :SC, 'member', '{a_and_r}', 'artists'),
  (:L, :PRD, 'member', '{producer}', 'org'),
  (:L, :ART, 'artist', '{}', 'artists'),
  (:L, :MK, 'member', '{marketing}', 'org'),
  (:L2, :X, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova174@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo174@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :ART, :C1), (:L, :SC, :C1);
INSERT INTO public.projects (id, user_id, org_id, name, inbox_for_contact_id) VALUES
  (:LP1, NULL, :L, 'Nova EP', NULL),
  (:LP2, NULL, :L, 'Inbox · Kilo', :C2);
INSERT INTO public.project_contacts (user_id, project_id, contact_id, role) VALUES (NULL, :LP1, :C1, 'artist');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S1, NULL, :L, :AR, 'Nova demo', 'song', 'r2://private/orgs/l/s1', 'in_review'),
  (:S2, NULL, :L, :AR, 'Kilo demo', 'song', 'r2://private/orgs/l/s2', 'inbox'),
  (:XS1, NULL, :L2, :X, 'L2 demo', 'song', 'r2://private/orgs/l2/s1', 'inbox');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES (:LP1, :S1, 0), (:LP2, :S2, 0);
INSERT INTO public.parties (id, org_id, kind, display_name, legal_name, ipi, address, country, tax_id, payment_instructions, user_id) VALUES
  (:PA, :L, 'person', 'Prd Person', 'Pierre Producteur', '00123456789', '1 rue X', 'FR', 'FR-TAX-1', 'PayPal, ask finance', :PRD),
  (:PB, :L, 'person', 'Nova Co', 'Nova Okafor', '00987654321', '2 road Y', 'GB', 'GB-TAX-2', 'Invoice monthly', NULL),
  (:PC, :L, 'person', 'Art Ist', 'Art Istique', NULL, '3 way Z', 'US', NULL, NULL, :ART),
  (:PD, :L, 'company', 'Unused Ltd', 'Unused Limited', NULL, NULL, NULL, 'U-1', NULL, NULL),
  (:PE, :L, 'person', 'Kilo Co', 'Kilo Writer', NULL, NULL, NULL, NULL, NULL, NULL);
-- PA and PB write Nova's song; PE writes Kilo's (outside ART's scope).
INSERT INTO public.track_collaborators (track_id, org_id, name, role, source, scope, status, party_id, created_by) VALUES
  (:S1, :L, 'Prd Person', 'producer', 'manual', 'recording', 'confirmed', :PA, :AR),
  (:S1, :L, 'Nova Co', 'writer', 'manual', 'composition', 'confirmed', :PB, :AR),
  (:S2, :L, 'Kilo Co', 'writer', 'manual', 'composition', 'confirmed', :PE, :AR);

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
CREATE FUNCTION public.visible_party_names() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(display_name, ',' ORDER BY display_name), '') FROM public.parties
$$;
CREATE FUNCTION public.plan_filters(q text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r text; filters text := '';
BEGIN
  FOR r IN EXECUTE 'EXPLAIN (COSTS OFF) ' || q LOOP
    IF r ~ 'Filter:' THEN filters := r; EXIT; END IF;
  END LOOP;
  RETURN filters;
END $$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text), public.as_user(text),
  public.visible_party_names(), public.plan_filters(text)
  TO anon, authenticated, service_role;

-- ── 2. No bank number ───────────────────────────────────────────────────

-- The corpus lib/labelos/payee.ts BANK_NUMBER_CORPUS is tested with.
SELECT public.check_eq('IBAN refused', public.labelos_looks_like_bank_number('GB29 NWBK 6016 1331 9268 19'), true);
SELECT public.check_eq('IBAN, lower case, no spaces', public.labelos_looks_like_bank_number('gb29nwbk60161331926819'), true);
SELECT public.check_eq('IBAN inside a sentence', public.labelos_looks_like_bank_number('Pay to DE89 3704 0044 0532 0130 00 please'), true);
SELECT public.check_eq('card with spaces', public.labelos_looks_like_bank_number('4111 1111 1111 1111'), true);
SELECT public.check_eq('card with dashes', public.labelos_looks_like_bank_number('4111-1111-1111-1111'), true);
SELECT public.check_eq('card inside a sentence', public.labelos_looks_like_bank_number('card 5500 0000 0000 0004 exp 12/30'), true);
SELECT public.check_eq('15-digit card', public.labelos_looks_like_bank_number('378282246310005'), true);
SELECT public.check_eq('prose with letters and digits is fine', public.labelos_looks_like_bank_number('Pay via PayPal, FY26 plan b is fine'), false);
SELECT public.check_eq('PayPal address is fine', public.labelos_looks_like_bank_number('PayPal: nova@example.com'), false);
SELECT public.check_eq('invoice reference is fine', public.labelos_looks_like_bank_number('Invoice monthly, reference RCD-2026-04, net 30'), false);
SELECT public.check_eq('a phone number is fine', public.labelos_looks_like_bank_number('Call +33 6 12 34 56 78 before paying'), false);
SELECT public.check_eq('plain words are fine', public.labelos_looks_like_bank_number('Pay by bank transfer to the account on file with finance'), false);

SELECT public.check_raises('the column refuses an IBAN',
  $$UPDATE public.parties SET payment_instructions = 'GB29 NWBK 6016 1331 9268 19' WHERE id = 'f1740000-0000-4000-8000-0000000000a4'$$,
  'parties_payment_instructions_check');
SELECT public.check_raises('the column refuses a card number',
  $$UPDATE public.parties SET payment_instructions = 'use 4111 1111 1111 1111' WHERE id = 'f1740000-0000-4000-8000-0000000000a4'$$,
  'parties_payment_instructions_check');
UPDATE public.parties SET payment_instructions = 'Wise link in the contract' WHERE id = :PD;
SELECT public.check_eq('plain instructions stored', (SELECT payment_instructions FROM public.parties WHERE id = :PD), 'Wise link in the contract');
SELECT public.check_raises('country must be two upper-case letters (France)', $$UPDATE public.parties SET country = 'France' WHERE id = 'f1740000-0000-4000-8000-0000000000a4'$$, 'parties_country_check');
SELECT public.check_raises('… and not lower case', $$UPDATE public.parties SET country = 'fr' WHERE id = 'f1740000-0000-4000-8000-0000000000a4'$$, 'parties_country_check');

-- ── 1. The payee rule, on every API role ────────────────────────────────

SELECT public.check_eq('authenticated holds no table-wide SELECT on parties', has_table_privilege('authenticated', 'public.parties', 'SELECT'), false);
SELECT public.check_eq('anon neither', has_table_privilege('anon', 'public.parties', 'SELECT'), false);
SELECT public.check_eq('tax_id is not granted to authenticated', has_column_privilege('authenticated', 'public.parties', 'tax_id', 'SELECT'), false);
SELECT public.check_eq('payment_instructions is not granted to authenticated', has_column_privilege('authenticated', 'public.parties', 'payment_instructions', 'SELECT'), false);
SELECT public.check_eq('nor to anon', has_column_privilege('anon', 'public.parties', 'tax_id', 'SELECT') OR has_column_privilege('anon', 'public.parties', 'payment_instructions', 'SELECT'), false);
SELECT public.check_eq('every other column stays readable (the row policy decides who)',
  (SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'parties'
     AND has_column_privilege('authenticated', 'public.parties', column_name, 'SELECT')),
  'address,contact_id,country,created_at,created_by,details_confirmed_at,details_confirmed_by,display_name,email,id,ipi,isni,kind,legal_name,org_id,pro,pro_affiliation,publisher_ipi,publisher_name,updated_at,user_id');
SELECT public.check_eq('service_role keeps the whole table', has_table_privilege('service_role', 'public.parties', 'SELECT'), true);

SET ROLE authenticated;
SELECT public.as_user(:O);
SELECT public.check_raises('owner: tax_id by name', $$SELECT tax_id FROM public.parties$$, 'permission denied');
SELECT public.check_raises('owner: payment_instructions by name', $$SELECT payment_instructions FROM public.parties$$, 'permission denied');
SELECT public.check_raises('owner: select * is refused', $$SELECT * FROM public.parties$$, 'permission denied');
SELECT public.check_raises('owner: the whole row as json is refused', $$SELECT to_jsonb(p) FROM public.parties p$$, 'permission denied');
SELECT public.check_raises('owner: filtering on the tax id is refused (no guessing it a character at a time)', $$SELECT id FROM public.parties WHERE tax_id LIKE 'FR%'$$, 'permission denied');
SELECT public.check_raises('owner: ordering by it is refused', $$SELECT id FROM public.parties ORDER BY payment_instructions$$, 'permission denied');
SELECT public.as_user(:WR);
SELECT public.check_raises('legal (rights.write): not on their own JWT either — the routes serve it', $$SELECT tax_id FROM public.parties$$, 'permission denied');
SELECT public.as_user(:FN);
SELECT public.check_raises('finance (finance.read): the same', $$SELECT payment_instructions FROM public.parties$$, 'permission denied');
SELECT public.as_user(:AR);
SELECT public.check_raises('A&R: the same', $$SELECT tax_id FROM public.parties$$, 'permission denied');
SELECT public.as_user(:PRD);
SELECT public.check_raises('even the person on their own party: not readable back', $$SELECT tax_id FROM public.parties WHERE user_id = auth.uid()$$, 'permission denied');
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_raises('anon: tax_id is a permission error', $$SELECT tax_id FROM public.parties$$, 'permission denied');
SELECT public.check_eq('anon: a granted column answers no row', (SELECT count(*) FROM public.parties), 0::bigint);
RESET ROLE;
SET ROLE service_role;
SELECT public.check_eq('service_role (every route) reads the payee columns',
  (SELECT tax_id || '/' || payment_instructions FROM public.parties WHERE id = :PA), 'FR-TAX-1/PayPal, ask finance');
RESET ROLE;

-- ── 3. The roster artist ────────────────────────────────────────────────

SET ROLE authenticated;
SELECT public.as_user(:ART);
SELECT public.check_eq('roster artist: reads only the party that is them — no co-writer of their own song, none outside scope',
  public.visible_party_names(), 'Art Ist');
SELECT public.check_eq('… whose legal name is theirs to read',
  (SELECT legal_name FROM public.parties WHERE user_id = auth.uid()), 'Art Istique');
SELECT public.check_eq('… and the co-writer''s legal data is not there to ask for',
  (SELECT count(*) FROM public.parties WHERE id = 'f1740000-0000-4000-8000-0000000000a2'), 0::bigint);
SELECT public.as_user(:AR);
SELECT public.check_eq('A&R (whole org): every party, as before', public.visible_party_names(), 'Art Ist,Kilo Co,Nova Co,Prd Person,Unused Ltd');
SELECT public.as_user(:SC);
SELECT public.check_eq('staff limited to Nova: the parties credited on Nova''s songs, as before', public.visible_party_names(), 'Nova Co,Prd Person');
SELECT public.as_user(:PRD);
SELECT public.check_eq('an own-line producer: their own party only', public.visible_party_names(), 'Prd Person');
SELECT public.as_user(:MK);
SELECT public.check_eq('marketing: none', public.visible_party_names(), '');
SELECT public.as_user(:AR);
SELECT public.check_eq('the parties read still plans its membership tests as hashed subplans',
  public.plan_filters('SELECT id, display_name FROM public.parties') ~ 'hashed SubPlan', true);
SELECT public.check_eq('… with no correlated (per-row) SubPlan or SECURITY DEFINER call in the filter',
  public.plan_filters('SELECT id, display_name FROM public.parties') ~ '(?<!hashed )SubPlan|can_see_org_|has_org_cap|can_see_artist', false);
RESET ROLE;

-- ── 4. The lock ─────────────────────────────────────────────────────────

SET ROLE service_role;
-- PB and PA on a composition draft sheet.
SELECT public.labelos_split_create_draft(:L, :AR, :S1, 'composition', 'note',
  jsonb_build_array(jsonb_build_object('party_id', :PA::text, 'role', 'writer', 'share', '40'),
                    jsonb_build_object('party_id', :PB::text, 'role', 'writer', 'share', '60')), NULL);
UPDATE public.parties SET display_name = 'Nova Co Draft' WHERE id = :PB;
SELECT public.check_eq('a draft sheet does not lock: rename allowed', (SELECT display_name FROM public.parties WHERE id = :PB), 'Nova Co Draft');
UPDATE public.parties SET display_name = 'Nova Co' WHERE id = :PB;
SELECT public.check_eq('setup: the sheet circulates',
  (public.labelos_audit_split_circulate(:L, :AR, (SELECT id FROM public.split_sheets WHERE track_id = :S1),
     jsonb_build_object('song_id', :S1::text), '{}'::jsonb) -> 'sheet' ->> 'status'), 'circulated');
RESET ROLE;

SET ROLE service_role;
SELECT public.check_raises('circulated: renaming a party on the sheet is refused (mutation check on the lock)',
  $$UPDATE public.parties SET display_name = 'Someone Else' WHERE id = 'f1740000-0000-4000-8000-0000000000a2'$$, 'locked');
SELECT public.check_raises('circulated: swapping the linked account is refused',
  $$UPDATE public.parties SET user_id = 'a1740000-0000-4000-8000-000000000008' WHERE id = 'f1740000-0000-4000-8000-0000000000a1'$$, 'locked');
SELECT public.check_raises('circulated: removing the linked account is refused',
  $$UPDATE public.parties SET user_id = NULL WHERE id = 'f1740000-0000-4000-8000-0000000000a1'$$, 'locked');
SELECT public.check_eq('… nothing moved', (SELECT display_name || '/' || coalesce(user_id::text, '-') FROM public.parties WHERE id = :PA), 'Prd Person/' || :PRD);

UPDATE public.parties SET display_name = 'Prd Person' WHERE id = :PA;
SELECT public.check_eq('a no-op rename is not a rename', (SELECT display_name FROM public.parties WHERE id = :PA), 'Prd Person');
UPDATE public.parties SET legal_name = 'Nova O. Okafor', ipi = '00987654322', address = '9 new road', country = 'GB' WHERE id = :PB;
SELECT public.check_eq('circulated: the legal data stays editable (a typo in an IPI must be fixable)',
  (SELECT legal_name || '/' || ipi || '/' || address FROM public.parties WHERE id = :PB), 'Nova O. Okafor/00987654322/9 new road');
UPDATE public.parties SET user_id = :MK WHERE id = :PB;
SELECT public.check_eq('circulated: linking an account to an unlinked party is allowed', (SELECT user_id FROM public.parties WHERE id = :PB), :MK::uuid);
UPDATE public.parties SET display_name = 'Unused Renamed', user_id = :FN WHERE id = :PD;
SELECT public.check_eq('a party on no sheet is not locked', (SELECT display_name FROM public.parties WHERE id = :PD), 'Unused Renamed');

-- ── 4b. A confirmation belongs to what was confirmed ───────────────────

UPDATE public.parties SET details_confirmed_at = now(), details_confirmed_by = :AR WHERE id = :PB;
SELECT public.check_eq('setup: PB is confirmed', (SELECT details_confirmed_at IS NOT NULL AND details_confirmed_by = :AR FROM public.parties WHERE id = :PB), true);
UPDATE public.parties SET tax_id = 'GB-TAX-3', payment_instructions = 'Wise' WHERE id = :PB;
SELECT public.check_eq('payee data is not what the person confirmed: the stamp stays', (SELECT details_confirmed_at IS NOT NULL FROM public.parties WHERE id = :PB), true);
UPDATE public.parties SET legal_name = 'Nova Q. Okafor' WHERE id = :PB;
SELECT public.check_eq('a changed legal name clears the stamp (both columns)', (SELECT details_confirmed_at IS NULL AND details_confirmed_by IS NULL FROM public.parties WHERE id = :PB), true);
UPDATE public.parties SET details_confirmed_at = now(), details_confirmed_by = :MK, ipi = '00987654399', country = 'US' WHERE id = :PB;
SELECT public.check_eq('the person confirming WITH corrections keeps the new stamp',
  (SELECT details_confirmed_by = :MK AND ipi = '00987654399' FROM public.parties WHERE id = :PB), true);
UPDATE public.parties SET address = 'moved' WHERE id = :PB;
SELECT public.check_eq('a later address change clears it again', (SELECT details_confirmed_at IS NULL FROM public.parties WHERE id = :PB), true);
UPDATE public.parties SET details_confirmed_at = now(), details_confirmed_by = :MK WHERE id = :PD;
UPDATE public.parties SET user_id = :AR WHERE id = :PD;
SELECT public.check_eq('re-linking the account clears the stamp (no inherited confirmation)', (SELECT details_confirmed_at IS NULL FROM public.parties WHERE id = :PD), true);

-- Supersede: v2 (a copy, then PB taken off it) is circulated; v1 becomes `superseded`, which is not draft.
SELECT public.labelos_split_create_draft(:L, :AR, :S1, 'composition', NULL, NULL, (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND version = 1));
DELETE FROM public.split_lines WHERE split_sheet_id = (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND version = 2) AND party_id = :PB;
UPDATE public.split_lines SET share = 100 WHERE split_sheet_id = (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND version = 2);
SELECT public.labelos_audit_split_circulate(:L, :AR, (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND version = 2), jsonb_build_object('song_id', :S1::text), '{}'::jsonb);
RESET ROLE;
SELECT public.check_eq('setup: v1 is superseded', (SELECT status FROM public.split_sheets WHERE track_id = :S1 AND version = 1), 'superseded');
SELECT public.check_eq('setup: only v1 names PB', (SELECT count(*) FROM public.split_lines WHERE party_id = :PB), 1::bigint);
SET ROLE service_role;
SELECT public.check_raises('a party only the SUPERSEDED sheet names stays locked (its name was shown)',
  $$UPDATE public.parties SET display_name = 'Renamed Later' WHERE id = 'f1740000-0000-4000-8000-0000000000a2'$$, 'locked');
RESET ROLE;

-- ── 5. Withdraw ─────────────────────────────────────────────────────────

SELECT public.check_eq('setup: Prd Person has a credit on S1', (SELECT count(*) FROM public.track_collaborators WHERE track_id = :S1 AND party_id = :PA), 1::bigint);
SET ROLE service_role;
SELECT public.check_eq('withdraw: answers withdrawn',
  (public.labelos_audit_credit_withdraw(:L, :PRD, (SELECT id FROM public.track_collaborators WHERE track_id = :S1 AND party_id = :PA),
     jsonb_build_object('artist_id', :C1, 'project_id', :LP1, 'song_id', :S1), '{"role":"producer","scope":"recording","from":"confirmed"}'::jsonb) ->> 'withdrawn'), 'true');
RESET ROLE;
SELECT public.check_eq('… the credit is gone', (SELECT count(*) FROM public.track_collaborators WHERE track_id = :S1 AND party_id = :PA), 0::bigint);
SELECT public.check_eq('… and ONE audit event credit.withdrawn, visible to the artist side, with the song''s context',
  (SELECT count(*) FROM public.activity_events
   WHERE verb = 'credit.withdrawn' AND audit AND visibility = 'artist' AND org_id = :L AND actor_id = :PRD
     AND artist_id = :C1 AND project_id = :LP1 AND song_id = :S1 AND subject_type = 'credit'), 1::bigint);
SELECT public.check_eq('… the party itself is untouched (the credit was withdrawn, not the person)', (SELECT count(*) FROM public.parties WHERE id = :PA), 1::bigint);

SET ROLE service_role;
SELECT public.check_eq('a second withdraw of the same credit is not_found, with no second event',
  (public.labelos_audit_credit_withdraw(:L, :PRD, (SELECT id FROM public.activity_events WHERE verb = 'credit.withdrawn' LIMIT 1),
     '{}'::jsonb, '{}'::jsonb) ->> 'error'), 'not_found');
RESET ROLE;
INSERT INTO public.track_collaborators (id, track_id, org_id, name, role, source, scope, status, party_id, created_by)
  VALUES ('a9740000-0000-4000-8000-000000000001', :S2, :L, 'Kilo Co 2', 'writer', 'manual', 'composition', 'confirmed', :PE, :AR);
SET ROLE service_role;
SELECT public.check_eq('a credit of ANOTHER org is not_found',
  (public.labelos_audit_credit_withdraw(:L2, :X, 'a9740000-0000-4000-8000-000000000001', '{}'::jsonb, '{}'::jsonb) ->> 'error'), 'not_found');
SELECT public.check_raises('a secret-looking payload key is refused',
  $$SELECT public.labelos_audit_credit_withdraw('b1740000-0000-4000-8000-000000000001', 'a1740000-0000-4000-8000-000000000006', 'a9740000-0000-4000-8000-000000000001', '{}'::jsonb, '{"token":"x"}'::jsonb)$$,
  'secret-looking');
RESET ROLE;
SELECT public.check_eq('… and that credit is still there', (SELECT count(*) FROM public.track_collaborators WHERE id = 'a9740000-0000-4000-8000-000000000001'), 1::bigint);

SET ROLE authenticated;
SELECT public.as_user(:O);
SELECT public.check_raises('authenticated cannot call the function (EXECUTE is service_role only)',
  $$SELECT public.labelos_audit_credit_withdraw('b1740000-0000-4000-8000-000000000001', 'a1740000-0000-4000-8000-000000000001', 'a9740000-0000-4000-8000-000000000001', '{}'::jsonb, '{}'::jsonb)$$,
  'permission denied');
RESET ROLE;
SET ROLE anon;
SELECT public.check_raises('anon neither',
  $$SELECT public.labelos_audit_credit_withdraw('b1740000-0000-4000-8000-000000000001', 'a1740000-0000-4000-8000-000000000001', 'a9740000-0000-4000-8000-000000000001', '{}'::jsonb, '{}'::jsonb)$$,
  'permission denied');
RESET ROLE;

-- ── 6. Deleting the linked account must not be blocked by the lock ──────
-- PA names PRD and sits on circulated / superseded sheets: the FK's SET NULL is an UPDATE of user_id.

SET ROLE service_role;
UPDATE public.parties SET details_confirmed_at = now(), details_confirmed_by = :AR WHERE id = :PA;
RESET ROLE;
SELECT public.check_eq('setup: the party is still linked to PRD and on a non-draft sheet',
  (SELECT user_id = :PRD FROM public.parties WHERE id = :PA)
  AND EXISTS (SELECT 1 FROM public.split_lines l JOIN public.split_sheets s ON s.id = l.split_sheet_id WHERE l.party_id = :PA AND s.status <> 'draft'), true);
DELETE FROM auth.users WHERE id = :PRD;
SELECT public.check_eq('deleting the linked auth user succeeds: user_id goes NULL, the party and its name stay',
  (SELECT user_id IS NULL AND display_name = 'Prd Person' FROM public.parties WHERE id = :PA), true);
SELECT public.check_eq('… and the confirmation of that person goes with the account', (SELECT details_confirmed_at IS NULL FROM public.parties WHERE id = :PA), true);
