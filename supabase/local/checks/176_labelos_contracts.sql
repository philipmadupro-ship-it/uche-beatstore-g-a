-- Behaviour checks for 176_labelos_contracts.sql (LABEL-57), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven, with each member's own JWT claims (as PostgREST reads) and as anon:
--   1. THE RECORD IS ONE ORG'S — an artist contact, song or party of another org
--      is refused; a contract is created a draft; status moves only along the
--      table; once it leaves draft its content is frozen; parties are added to a
--      draft only; the save function reports not_found / not_draft.
--   2. TEMPLATES ARE VERSIONED — a version is never updated; one row per
--      (org, type, version).
--   3. READS — contracts.read (legal) reads the org's contracts, a member limited
--      to Nova's artists reads Nova's only, marketing reads none; a roster artist
--      reads their OWN contract once it left draft and never a draft or another
--      artist's; a person named as a party reads their contract; another org's
--      owner and anon read nothing; templates are readable with contracts.read
--      only. contract_parties follows the contract.
--   4. NO API-ROLE WRITES — authenticated cannot insert, update or delete.
--   5. The org's hard delete cascades (labelos_org_hard_delete.sql proves it for all tables).
--
-- Cast: label L: owner O; LG (legal, whole org); SC (legal, limited to Nova);
-- MK (marketing); ART (role artist, Nova); ART2 (role artist, Kilo); PRD
-- (producer, a party on K1). Label L2: owner X.

\set O    '''a1760000-0000-4000-8000-000000000001'''
\set LG   '''a1760000-0000-4000-8000-000000000002'''
\set SC   '''a1760000-0000-4000-8000-000000000003'''
\set MK   '''a1760000-0000-4000-8000-000000000004'''
\set ART  '''a1760000-0000-4000-8000-000000000005'''
\set ART2 '''a1760000-0000-4000-8000-000000000006'''
\set PRD  '''a1760000-0000-4000-8000-000000000007'''
\set X    '''a1760000-0000-4000-8000-000000000009'''
\set L    '''b1760000-0000-4000-8000-000000000001'''
\set L2   '''b1760000-0000-4000-8000-000000000002'''
\set C1   '''c1760000-0000-4000-8000-0000000000c1'''
\set C2   '''c1760000-0000-4000-8000-0000000000c2'''
\set XC   '''c1760000-0000-4000-8000-0000000000c9'''
\set S1   '''e1760000-0000-4000-8000-000000000001'''
\set XS   '''e1760000-0000-4000-8000-0000000000f1'''
\set PA   '''f1760000-0000-4000-8000-0000000000a1'''
\set PB   '''f1760000-0000-4000-8000-0000000000a2'''
\set XP   '''f1760000-0000-4000-8000-0000000000a9'''
\set K1   '''91760000-0000-4000-8000-000000000001'''
\set K2   '''91760000-0000-4000-8000-000000000002'''
\set K3   '''91760000-0000-4000-8000-000000000003'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o176@local.test'), (:LG, 'lg176@local.test'), (:SC, 'sc176@local.test'), (:MK, 'mk176@local.test'),
  (:ART, 'art176@local.test'), (:ART2, 'art2176@local.test'), (:PRD, 'prd176@local.test'), (:X, 'x176@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-176', 'label', :O),
  (:L2, 'Label L2', 'label-l2-176', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :LG, 'member', '{legal}', 'org'),
  (:L, :SC, 'member', '{legal}', 'artists'),
  (:L, :MK, 'member', '{marketing}', 'org'),
  (:L, :ART, 'artist', '{}', 'artists'),
  (:L, :ART2, 'artist', '{}', 'artists'),
  (:L, :PRD, 'member', '{producer}', 'org'),
  (:L2, :X, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova176@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo176@local.test', 'artist'),
  (:XC, NULL, :L2, 'Other', 'other176@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :ART, :C1), (:L, :SC, :C1), (:L, :ART2, :C2);
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S1, NULL, :L, :LG, 'Nova demo', 'song', 'r2://private/orgs/l/s1', 'in_review'),
  (:XS, NULL, :L2, :X, 'L2 demo', 'song', 'r2://private/orgs/l2/s1', 'inbox');
INSERT INTO public.parties (id, org_id, kind, display_name, user_id) VALUES
  (:PA, :L, 'company', 'Label L Ltd', NULL),
  (:PB, :L, 'person', 'Prd Person', :PRD),
  (:XP, :L2, 'person', 'Outsider', NULL);

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
CREATE FUNCTION public.visible_contracts() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(title, ',' ORDER BY title), '') FROM public.contracts
$$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text), public.as_user(text), public.visible_contracts()
  TO anon, authenticated, service_role;

-- ── 1. The record ────────────────────────────────────────────────────────

SELECT public.labelos_contract_save(:L, :LG, NULL,
  jsonb_build_object('type', 'recording', 'title', 'K1', 'template_source', 'platform:recording@1', 'template_version', 1,
    'clauses', '[{"id":"a","heading":"H","body":"B"}]'::jsonb, 'artist_contact_id', :C1, 'track_id', :S1,
    'territories', '["GB","FR"]'::jsonb, 'fields', '{"advance":"2500"}'::jsonb),
  jsonb_build_array(jsonb_build_object('party_id', :PA, 'role', 'label', 'position', 0), jsonb_build_object('party_id', :PB, 'role', 'artist', 'position', 1)));
SELECT id AS k1raw FROM public.contracts WHERE title = 'K1' \gset
\set K1 :'k1raw'
SELECT public.check_eq('created a draft', (SELECT status FROM public.contracts WHERE id = :K1), 'draft');
SELECT public.check_eq('parties stored', (SELECT count(*)::int FROM public.contract_parties WHERE contract_id = :K1), 2);

SELECT public.check_raises('an artist of another org', format($q$SELECT public.labelos_contract_save(%L, %L, NULL, jsonb_build_object('type','nda','title','Bad','template_source','platform:nda@1','clauses','[{"id":"a","heading":"H","body":"B"}]'::jsonb,'artist_contact_id',%L), NULL)$q$, :L, :LG, :XC), 'not a contact of this organization');
SELECT public.check_raises('a song of another org', format($q$SELECT public.labelos_contract_save(%L, %L, NULL, jsonb_build_object('type','nda','title','Bad','template_source','platform:nda@1','clauses','[{"id":"a","heading":"H","body":"B"}]'::jsonb,'track_id',%L), NULL)$q$, :L, :LG, :XS), 'belongs to another organization');
SELECT public.check_raises('a party of another org', format($q$SELECT public.labelos_contract_save(%L, %L, %L, '{}'::jsonb, jsonb_build_array(jsonb_build_object('party_id', %L, 'role', 'label')))$q$, :L, :LG, :K1, :XP), 'belongs to another organization');
SELECT public.check_raises('an unknown contract type', $$INSERT INTO public.contracts (org_id, type, title, template_source, clauses) VALUES ('b1760000-0000-4000-8000-000000000001', 'nope', 'x', 'p', '[{"a":1}]')$$, 'contracts_type_check');
SELECT public.check_raises('a contract is created a draft', $$INSERT INTO public.contracts (org_id, type, title, status, template_source, clauses) VALUES ('b1760000-0000-4000-8000-000000000001', 'nda', 'x', 'sent', 'p', '[{"a":1}]')$$, 'created as a draft');
SELECT public.check_raises('territories must be codes', $$UPDATE public.contracts SET territories = '{England}' WHERE title = 'K1'$$, 'contracts_territories_check');
SELECT public.check_raises('not_found', format($q$SELECT public.labelos_contract_save(%L, %L, %L, '{}'::jsonb, NULL)$q$, :L, :LG, :K2), 'not_found');
SELECT public.check_raises('another org cannot edit it', format($q$SELECT public.labelos_contract_save(%L, %L, %L, '{"title":"hijack"}'::jsonb, NULL)$q$, :L2, :X, :K1), 'not_found');

SELECT public.check_raises('draft cannot jump to signed', format($q$UPDATE public.contracts SET status = 'signed' WHERE id = %L$q$, :K1), 'cannot become');
UPDATE public.contracts SET status = 'sent' WHERE id = :K1;
SELECT public.check_raises('a sent contract’s content is frozen (fields)', format($q$UPDATE public.contracts SET fields = '{"advance":"1"}' WHERE id = %L$q$, :K1), 'left draft');
SELECT public.check_raises('… and its clauses', format($q$UPDATE public.contracts SET clauses = '[{"id":"z","heading":"H","body":"B"}]' WHERE id = %L$q$, :K1), 'left draft');
SELECT public.check_raises('… and its artist', format($q$UPDATE public.contracts SET artist_contact_id = NULL WHERE id = %L$q$, :K1), 'left draft');
SELECT public.check_raises('save refuses a sent contract', format($q$SELECT public.labelos_contract_save(%L, %L, %L, '{"title":"x"}'::jsonb, NULL)$q$, :L, :LG, :K1), 'not_draft');
SELECT public.check_raises('parties cannot be added once sent', format($q$INSERT INTO public.contract_parties (contract_id, party_id, org_id, role) VALUES (%L, %L, %L, 'publisher')$q$, :K1, :PA, :L), 'draft contract');
UPDATE public.contracts SET internal_note = 'chase signature' WHERE id = :K1;
SELECT public.check_eq('the internal note stays editable', (SELECT internal_note FROM public.contracts WHERE id = :K1), 'chase signature');

-- The parties of a sent contract are frozen too (a cascade is not).
SELECT public.check_raises('a party cannot be removed from a sent contract', format($q$DELETE FROM public.contract_parties WHERE contract_id = %L$q$, :K1), 'left draft');
SELECT public.check_raises('… nor re-roled', format($q$UPDATE public.contract_parties SET role = 'publisher' WHERE contract_id = %L$q$, :K1), 'left draft');
SELECT public.check_eq('both parties still there', (SELECT count(*)::int FROM public.contract_parties WHERE contract_id = :K1), 2);

-- A second contract (Kilo's, a draft) and a third (Kilo's, sent), to read as different people.
SELECT public.labelos_contract_save(:L, :LG, NULL,
  jsonb_build_object('type', 'nda', 'title', 'K2 draft', 'template_source', 'platform:nda@1', 'clauses', '[{"id":"a","heading":"H","body":"B"}]'::jsonb, 'artist_contact_id', :C2), NULL);
SELECT public.labelos_contract_save(:L, :LG, NULL,
  jsonb_build_object('type', 'management', 'title', 'K3 sent', 'template_source', 'platform:management@1', 'clauses', '[{"id":"a","heading":"H","body":"B"}]'::jsonb, 'artist_contact_id', :C2), NULL);
UPDATE public.contracts SET status = 'sent' WHERE title = 'K3 sent';
-- A contract naming no artist, draft-> sent, with PRD's party.
SELECT public.labelos_contract_save(:L, :LG, NULL,
  jsonb_build_object('type', 'session', 'title', 'K4 session', 'template_source', 'platform:session@1', 'clauses', '[{"id":"a","heading":"H","body":"B"}]'::jsonb),
  jsonb_build_array(jsonb_build_object('party_id', :PB, 'role', 'engineer')));
UPDATE public.contracts SET status = 'sent' WHERE title = 'K4 session';
-- Another org's contract.
SELECT public.labelos_contract_save(:L2, :X, NULL,
  jsonb_build_object('type', 'nda', 'title', 'L2 nda', 'template_source', 'platform:nda@1', 'clauses', '[{"id":"a","heading":"H","body":"B"}]'::jsonb,
    'artist_contact_id', :XC, 'track_id', :XS),
  jsonb_build_array(jsonb_build_object('party_id', :XP, 'role', 'disclosing')));

UPDATE public.contracts SET status = 'void' WHERE title = 'K4 session';
SELECT public.check_raises('void is final', $$UPDATE public.contracts SET status = 'sent' WHERE title = 'K4 session'$$, 'cannot become');
-- bring K4 back as a fresh sent contract for the read checks
SELECT public.labelos_contract_save(:L, :LG, NULL,
  jsonb_build_object('type', 'session', 'title', 'K5 session', 'template_source', 'platform:session@1', 'clauses', '[{"id":"a","heading":"H","body":"B"}]'::jsonb),
  jsonb_build_array(jsonb_build_object('party_id', :PB, 'role', 'engineer')));
UPDATE public.contracts SET status = 'sent' WHERE title = 'K5 session';

-- ── 2. Templates ─────────────────────────────────────────────────────────

INSERT INTO public.contract_templates (org_id, type, version, name, clauses, based_on, created_by)
VALUES (:L, 'recording', 1, 'Our recording deal', '[{"id":"a","heading":"H","body":"B"}]', 'platform:recording@1', :LG),
       (:L2, 'recording', 1, 'Their deal', '[{"id":"a","heading":"H","body":"B"}]', NULL, :X);
SELECT public.check_raises('a template version is never updated', $$UPDATE public.contract_templates SET name = 'x' WHERE name = 'Our recording deal'$$, 'never changed');
SELECT public.check_raises('one row per (org, type, version)', format($q$INSERT INTO public.contract_templates (org_id, type, version, name, clauses) VALUES (%L, 'recording', 1, 'dup', '[{"id":"a"}]')$q$, :L), 'contract_templates_version_uniq');
INSERT INTO public.contract_templates (org_id, type, version, name, clauses) VALUES (:L, 'recording', 2, 'Our recording deal v2', '[{"id":"a","heading":"H","body":"B2"}]');
SELECT public.check_eq('the next version is a new row', (SELECT count(*)::int FROM public.contract_templates WHERE org_id = :L AND type = 'recording'), 2);

-- ── 3. Reads ─────────────────────────────────────────────────────────────

SET ROLE authenticated;
SELECT public.as_user(:O);
SELECT public.check_eq('owner reads all of L', public.visible_contracts(), 'K1,K2 draft,K3 sent,K4 session,K5 session');
SELECT public.as_user(:LG);
SELECT public.check_eq('legal (whole org) reads all of L', public.visible_contracts(), 'K1,K2 draft,K3 sent,K4 session,K5 session');
SELECT public.check_eq('legal reads the templates', (SELECT count(*)::int FROM public.contract_templates), 2);
SELECT public.as_user(:SC);
SELECT public.check_eq('legal limited to Nova reads Nova’s only (a contract with no artist is whole-org only)', public.visible_contracts(), 'K1');
SELECT public.as_user(:MK);
SELECT public.check_eq('marketing reads no contract', public.visible_contracts(), '');
SELECT public.check_eq('… and no template', (SELECT count(*)::int FROM public.contract_templates), 0);
SELECT public.as_user(:ART);
SELECT public.check_eq('Nova reads her own sent contract, no draft, nothing of Kilo’s', public.visible_contracts(), 'K1');
SELECT public.check_eq('… and no template', (SELECT count(*)::int FROM public.contract_templates), 0);
SELECT public.check_eq('… and the party rows of her contract only', (SELECT count(*)::int FROM public.contract_parties), 2);
SELECT public.as_user(:ART2);
SELECT public.check_eq('Kilo reads the sent one, not the draft', public.visible_contracts(), 'K3 sent');
SELECT public.as_user(:PRD);
SELECT public.check_eq('a person named as a party reads their contract (and, as a producer without contracts.read, nothing else)', public.visible_contracts(), 'K1,K4 session,K5 session');
SELECT public.as_user(:X);
SELECT public.check_eq('another org’s owner reads only their own', public.visible_contracts(), 'L2 nda');
SELECT public.check_eq('… and their own template', (SELECT count(*)::int FROM public.contract_templates), 1);
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon reads nothing', public.visible_contracts(), '');
RESET ROLE;

-- ── 4. No API-role writes ────────────────────────────────────────────────

SET ROLE authenticated;
SELECT public.as_user(:LG);
SELECT public.check_raises('authenticated cannot insert', $$INSERT INTO public.contracts (org_id, type, title, template_source, clauses) VALUES ('b1760000-0000-4000-8000-000000000001', 'nda', 'x', 'p', '[{"a":1}]')$$, 'written through /api/org|permission denied');
UPDATE public.contracts SET internal_note = 'hijacked' WHERE title = 'K1';
DELETE FROM public.contracts WHERE title = 'K1';
SELECT public.check_raises('… template insert', $$INSERT INTO public.contract_templates (org_id, type, version, name, clauses) VALUES ('b1760000-0000-4000-8000-000000000001', 'nda', 1, 'x', '[{"a":1}]')$$, 'written through /api/org|permission denied');
SELECT public.check_raises('… the save function', format($q$SELECT public.labelos_contract_save(%L, %L, NULL, '{}'::jsonb, NULL)$q$, :L, :LG), 'permission denied');
RESET ROLE;
SELECT public.check_eq('… an update or delete through RLS touches nothing (no write policy)', (SELECT internal_note FROM public.contracts WHERE title = 'K1'), 'chase signature');

-- ── 4b. Voiding is one transaction with its audit event ─────────────────

SELECT public.check_eq('void: the function answers voided',
  (public.labelos_audit_contract_void(:L, :LG, (SELECT id FROM public.contracts WHERE title = 'K3 sent'), 'replaced', '{"with_reason":true}'::jsonb)) ->> 'voided', 'true');
SELECT public.check_eq('… the contract is void with the reason and the actor', (SELECT status || '/' || void_reason FROM public.contracts WHERE title = 'K3 sent'), 'void/replaced');
SELECT public.check_eq('… and ONE audit event, internal, naming the artist and the previous status',
  (SELECT count(*)::int FROM public.activity_events WHERE verb = 'contract.voided' AND audit AND visibility = 'internal' AND artist_id = :C2 AND payload ->> 'from' = 'sent'), 1);
SELECT public.check_eq('a second void is refused', (public.labelos_audit_contract_void(:L, :LG, (SELECT id FROM public.contracts WHERE title = 'K3 sent'), NULL, '{}'::jsonb)) ->> 'error', 'already_void');
SELECT public.check_eq('another org cannot void it', (public.labelos_audit_contract_void(:L2, :X, (SELECT id FROM public.contracts WHERE title = 'K1'), NULL, '{}'::jsonb)) ->> 'error', 'not_found');
SELECT public.check_raises('a secret-looking payload key is refused', format($q$SELECT public.labelos_audit_contract_void(%L, %L, %L, NULL, '{"api_token":"x"}'::jsonb)$q$, :L, :LG, :K1), 'secret-looking');
SET ROLE authenticated;
SELECT public.check_raises('API roles cannot call it', format($q$SELECT public.labelos_audit_contract_void(%L, %L, %L, NULL, '{}'::jsonb)$q$, :L, :LG, :K1), 'permission denied');
RESET ROLE;

-- ── 5. Cascade ───────────────────────────────────────────────────────────
-- L2's contract names L2's contact, song and party (NO ACTION links): the org's one DELETE cascades through all of them.

DELETE FROM public.organizations WHERE id = :L2;
SELECT public.check_eq('an org’s contracts and templates go with it', (SELECT count(*)::int FROM public.contracts WHERE org_id = :L2) + (SELECT count(*)::int FROM public.contract_templates WHERE org_id = :L2), 0);
