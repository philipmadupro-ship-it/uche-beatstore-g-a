-- Behaviour checks for 153_labelos_parties_credits.sql (LABEL-27), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- What is proven, as `authenticated` with each member's own JWT claims (the
-- way PostgREST reads) — never only as the service role:
--   - EXISTING credits read unchanged: a producer credit keeps org_id / party /
--     scope NULL and status 'confirmed', the producer reads it, and no Label OS
--     data can ride on a producer track's credit;
--   - an org track's credit takes the track's org, defaults to scope
--     'recording', and one read from a FILENAME arrives 'proposed';
--   - the party and contact of a credit must belong to the credit's org;
--   - who reads a credit: rights.read (whole org / in artist scope), the
--     credited person's own line (rights.read.own_line), nobody else —
--     marketing, another org, an external project member, the producer, anon;
--   - who reads a party (legal name, IPI): rights.read, or the party is you;
--   - nothing writes through the API roles;
--   - confirm / dispute is ONE function: the status change and the activity
--     event commit together, service_role only;
--   - the parties read plans as hashed subplans, no per-row definer call (R-08).
--
-- Cast (seed: producer P):
--   label L : owner O; AR (A&R, rights.read); SC (A&R scoped to Kilo C2);
--             PRD (member, function producer = own line only); MK (marketing);
--   label L2: owner X.   OUT is a member of nothing. EXT is an external editor
--   on Nova's project (LP1), not an org member.
--   L : S1 = Nova's song (LP1), S2 = Kilo's song (Inbox LP2).  L2: XS1.
--   P : PT = a producer track with a producer credit.

\set P    '''0b0e1a57-0000-4000-8000-000000000001'''
\set O    '''a1530000-0000-4000-8000-000000000001'''
\set AR   '''a1530000-0000-4000-8000-000000000002'''
\set SC   '''a1530000-0000-4000-8000-000000000003'''
\set PRD  '''a1530000-0000-4000-8000-000000000004'''
\set MK   '''a1530000-0000-4000-8000-000000000005'''
\set X    '''a1530000-0000-4000-8000-000000000006'''
\set OUT  '''a1530000-0000-4000-8000-000000000007'''
\set EXT  '''a1530000-0000-4000-8000-000000000008'''
\set L    '''b1530000-0000-4000-8000-000000000001'''
\set L2   '''b1530000-0000-4000-8000-000000000002'''
\set C1   '''c1530000-0000-4000-8000-0000000000c1'''
\set C2   '''c1530000-0000-4000-8000-0000000000c2'''
\set CX   '''c1530000-0000-4000-8000-0000000000c3'''
\set LP1  '''d1530000-0000-4000-8000-000000000011'''
\set LP2  '''d1530000-0000-4000-8000-000000000012'''
\set XP1  '''d1530000-0000-4000-8000-000000000021'''
\set S1   '''e1530000-0000-4000-8000-000000000001'''
\set S2   '''e1530000-0000-4000-8000-000000000002'''
\set XS1  '''e1530000-0000-4000-8000-000000000003'''
\set PT   '''e1530000-0000-4000-8000-000000000004'''
\set PA   '''f1530000-0000-4000-8000-0000000000a1'''
\set PB   '''f1530000-0000-4000-8000-0000000000a2'''
\set PX   '''f1530000-0000-4000-8000-0000000000a3'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o153@local.test'), (:AR, 'ar153@local.test'), (:SC, 'sc153@local.test'), (:PRD, 'prd153@local.test'),
  (:MK, 'mk153@local.test'), (:X, 'x153@local.test'), (:OUT, 'out153@local.test'), (:EXT, 'ext153@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-153', 'label', :O),
  (:L2, 'Label L2', 'label-l2-153', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org'),
  (:L, :SC, 'member', '{a_and_r}', 'artists'),
  (:L, :PRD, 'member', '{producer}', 'org'),
  (:L, :MK, 'member', '{marketing}', 'org'),
  (:L2, :X, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova153@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo153@local.test', 'artist'),
  (:CX, NULL, :L2, 'Xen', 'xen153@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :SC, :C2);
INSERT INTO public.projects (id, user_id, org_id, name, inbox_for_contact_id) VALUES
  (:LP1, NULL, :L, 'Nova EP', NULL),
  (:LP2, NULL, :L, 'Inbox · Kilo', :C2),
  (:XP1, NULL, :L2, 'L2 project', NULL);
INSERT INTO public.project_contacts (user_id, project_id, contact_id, role) VALUES (NULL, :LP1, :C1, 'artist');
INSERT INTO public.project_members (org_id, project_id, user_id, role, allow_downloads, invited_by) VALUES
  (:L, :LP1, :EXT, 'editor', true, :O);
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S1, NULL, :L, :AR, 'Nova demo', 'song', 'r2://private/orgs/l/s1', 'in_review'),
  (:S2, NULL, :L, :AR, 'Kilo demo', 'song', 'r2://private/orgs/l/s2', 'inbox'),
  (:XS1, NULL, :L2, :X, 'L2 demo', 'song', 'r2://private/orgs/l2/s1', 'inbox');
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES (:PT, :P, 'P beat', 'beat', 'r2://private/p1');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES (:LP1, :S1, 0), (:LP2, :S2, 0), (:XP1, :XS1, 0);

CREATE TABLE public.chk_lbl (id uuid PRIMARY KEY, name text NOT NULL);
GRANT SELECT ON public.chk_lbl TO anon, authenticated, service_role;
INSERT INTO public.chk_lbl VALUES (:S1, 'S1'), (:S2, 'S2'), (:XS1, 'XS1'), (:PT, 'PT');

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
CREATE FUNCTION public.rows_changed(stmt text) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
CREATE FUNCTION public.as_user(p_user text) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
-- The credits the caller reads, as "song/name/role", sorted.
CREATE FUNCTION public.visible_credits() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(s.name || '/' || c.name || '/' || c.role, ',' ORDER BY s.name, c.name, c.role), '')
  FROM public.track_collaborators c JOIN public.chk_lbl s ON s.id = c.track_id
$$;
CREATE FUNCTION public.visible_parties() RETURNS text
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
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.rows_changed(text), public.as_user(text), public.visible_credits(), public.visible_parties(), public.plan_filters(text)
  TO anon, authenticated, service_role;

-- ── Schema ──────────────────────────────────────────────────────────────

SELECT public.check_eq('RLS is on for parties',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.parties'::regclass), true);
SELECT public.check_eq('parties has no user_id OWNER column — only the party''s own account link, and one SELECT policy',
  (SELECT string_agg(policyname || '=' || permissive || '/' || cmd, ' ') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'parties'),
  'parties_member_read=PERMISSIVE/SELECT');
SELECT public.check_eq('track_collaborators policies: the producer''s (115), the org read, and the RESTRICTIVE guard',
  (SELECT string_agg(policyname || '=' || permissive || '/' || cmd, ' ' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'track_collaborators'),
  'org_member_guard=RESTRICTIVE/SELECT track_collaborators_org_member_read=PERMISSIVE/SELECT track_collaborators_via_parent=PERMISSIVE/ALL');
SELECT public.check_eq('the org read policy keys on rights.read, org membership and the scoped-tracks set, with no per-row definer helper (R-08)',
  (SELECT qual ~ 'rights\.read' AND qual ~ 'org_members' AND qual ~ 'labelos_scoped_tracks'
          AND qual !~ 'can_see_org_track' AND qual !~ 'labelos_is_org_track' AND qual !~ 'can_see_org_project'
   FROM pg_policies WHERE tablename = 'track_collaborators' AND policyname = 'track_collaborators_org_member_read'), true);
SELECT public.check_eq('the service-only write trigger is on parties and still on track_collaborators',
  (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE t.tgname = 'labelos_org_rows_service_only' AND NOT t.tgisinternal AND c.relname IN ('parties', 'track_collaborators')),
  'parties,track_collaborators');

-- ── Existing credits read unchanged ─────────────────────────────────────

-- Exactly what lib/upload/collaborators and the producer route write: no Label OS column named.
INSERT INTO public.track_collaborators (track_id, name, role, source) VALUES (:PT, 'Wheezy', 'producer', 'manual');
SELECT public.check_eq('a producer credit is exactly what it was: no org, no party, no scope, confirmed',
  (SELECT org_id IS NULL AND party_id IS NULL AND scope IS NULL AND status = 'confirmed' AND role_detail IS NULL AND created_by IS NULL
          AND confirmed_by IS NULL AND dispute_note IS NULL
   FROM public.track_collaborators WHERE track_id = :PT), true);
SELECT public.check_raises('a producer track''s credit cannot carry a party',
  $$INSERT INTO public.parties (id, org_id, display_name) VALUES ('f1530000-0000-4000-8000-0000000000b9', 'b1530000-0000-4000-8000-000000000001', 'Tmp');
    INSERT INTO public.track_collaborators (track_id, name, role, party_id) VALUES ('e1530000-0000-4000-8000-000000000004', 'Tmp', 'writer', 'f1530000-0000-4000-8000-0000000000b9')$$,
  'a producer track takes no organization, party, scope or status|track_collaborators_org_columns');
DELETE FROM public.parties WHERE id = 'f1530000-0000-4000-8000-0000000000b9';
SELECT public.check_raises('a producer track''s credit cannot be proposed (status)',
  $$INSERT INTO public.track_collaborators (track_id, name, role, status) VALUES ('e1530000-0000-4000-8000-000000000004', 'Nope', 'writer', 'proposed')$$,
  'a producer track takes no organization|track_collaborators_org_columns');
SELECT public.check_raises('a producer track''s credit cannot name an org',
  $$INSERT INTO public.track_collaborators (track_id, name, role, org_id) VALUES ('e1530000-0000-4000-8000-000000000004', 'Nope', 'writer', 'b1530000-0000-4000-8000-000000000001')$$,
  'a producer track takes no organization');
-- The producer's idempotent upsert (lib/upload/collaborators) still works: same (track, lower(name), role).
INSERT INTO public.track_collaborators (track_id, name, role, source) VALUES (:PT, 'wheezy', 'producer', 'filename')
  ON CONFLICT DO NOTHING;
SELECT public.check_eq('the filename re-parse stays idempotent', (SELECT count(*) FROM public.track_collaborators WHERE track_id = :PT), 1::bigint);

-- ── Org parties and credits (as the service role: what /api/org does) ────

INSERT INTO public.parties (id, org_id, kind, display_name, legal_name, ipi, user_id, contact_id) VALUES
  (:PA, :L, 'person', 'Prd Person', 'Pierre Producteur', '00123456789', :PRD, NULL),
  (:PB, :L, 'person', 'Nova', 'Nova Okafor', '00987654321', NULL, :C1),
  (:PX, :L2, 'person', 'Xen', NULL, NULL, NULL, NULL);

SELECT public.check_raises('one rights identity per account per org',
  $$INSERT INTO public.parties (org_id, display_name, user_id) VALUES ('b1530000-0000-4000-8000-000000000001', 'Again', 'a1530000-0000-4000-8000-000000000004')$$,
  'idx_parties_org_user|duplicate key');
SELECT public.check_raises('a party''s contact must be a contact of its org',
  $$INSERT INTO public.parties (org_id, display_name, contact_id) VALUES ('b1530000-0000-4000-8000-000000000001', 'Cross', 'c1530000-0000-4000-8000-0000000000c3')$$,
  'same organization');
SELECT public.check_raises('an IPI must be 9–11 digits',
  $$INSERT INTO public.parties (org_id, display_name, ipi) VALUES ('b1530000-0000-4000-8000-000000000001', 'Bad', '12ab')$$, 'parties_ipi_format');
SELECT public.check_raises('a party keeps its org',
  $$UPDATE public.parties SET org_id = 'b1530000-0000-4000-8000-000000000002' WHERE id = 'f1530000-0000-4000-8000-0000000000a1'$$, 'keeps its organization');

INSERT INTO public.track_collaborators (track_id, name, role, source, scope, status, party_id, created_by) VALUES
  (:S1, 'Prd Person', 'producer', 'manual', 'recording', 'proposed', :PA, :PRD),
  (:S1, 'Nova', 'songwriter', 'manual', 'composition', 'confirmed', :PB, :AR),
  (:S2, 'Prd Person', 'mixer', 'manual', 'recording', 'proposed', :PA, :PRD),
  (:XS1, 'Xen', 'songwriter', 'manual', 'composition', 'confirmed', :PX, :X);

SELECT public.check_eq('an org credit takes its track''s org',
  (SELECT count(*) FROM public.track_collaborators WHERE org_id = :L AND track_id IN (:S1, :S2)), 3::bigint);
INSERT INTO public.track_collaborators (track_id, name, role, source) VALUES (:S1, 'Beat Maker', 'producer', 'filename');
SELECT public.check_eq('a credit read from a filename on an org track is proposed, in recording scope, stamped with the org',
  (SELECT status || '/' || scope || '/' || (org_id = :L)::text FROM public.track_collaborators WHERE track_id = :S1 AND name = 'Beat Maker'),
  'proposed/recording/true');
SELECT public.check_raises('a credit cannot name another org''s party',
  $$INSERT INTO public.track_collaborators (track_id, name, role, party_id) VALUES ('e1530000-0000-4000-8000-000000000001', 'Xen', 'mixer', 'f1530000-0000-4000-8000-0000000000a3')$$,
  'party must belong to the same organization');
SELECT public.check_raises('a credit cannot carry another org''s id',
  $$INSERT INTO public.track_collaborators (track_id, name, role, org_id) VALUES ('e1530000-0000-4000-8000-000000000001', 'Zed', 'mixer', 'b1530000-0000-4000-8000-000000000002')$$,
  'track''s organization');
SELECT public.check_raises('a credit cannot be linked to another org''s contact',
  $$INSERT INTO public.track_collaborators (track_id, name, role, contact_id) VALUES ('e1530000-0000-4000-8000-000000000001', 'Zed', 'mixer', 'c1530000-0000-4000-8000-0000000000c3')$$,
  'contact must belong to the same organization');
SELECT public.check_raises('a status outside the vocabulary is refused',
  $$UPDATE public.track_collaborators SET status = 'rejected' WHERE name = 'Xen'$$, 'track_collaborators_status_check');
SELECT public.check_raises('a scope outside the vocabulary is refused',
  $$UPDATE public.track_collaborators SET scope = 'mix' WHERE name = 'Xen'$$, 'track_collaborators_scope_check');
SELECT public.check_raises('a credit keeps its track',
  $$UPDATE public.track_collaborators SET track_id = 'e1530000-0000-4000-8000-000000000002' WHERE name = 'Beat Maker'$$, 'keeps its track and organization');
SELECT public.check_raises('a party with credits cannot be deleted',
  $$DELETE FROM public.parties WHERE id = 'f1530000-0000-4000-8000-0000000000a1'$$, 'violates foreign key|still referenced');

-- ── Reads, as members, with their own claims ────────────────────────────

SET ROLE authenticated;

SELECT public.as_user(:O);
SELECT public.check_eq('owner (rights.read, whole org): every credit of L, none of L2''s',
  public.visible_credits(), 'S1/Beat Maker/producer,S1/Nova/songwriter,S1/Prd Person/producer,S2/Prd Person/mixer');
SELECT public.check_eq('… and every party of L, with the legal identifiers', public.visible_parties(), 'Nova,Prd Person');
SELECT public.check_eq('… IPI and legal name included',
  (SELECT string_agg(legal_name || '/' || ipi, ',' ORDER BY legal_name) FROM public.parties), 'Nova Okafor/00987654321,Pierre Producteur/00123456789');

SELECT public.as_user(:AR);
SELECT public.check_eq('A&R (rights.read, whole org): every credit of L',
  public.visible_credits(), 'S1/Beat Maker/producer,S1/Nova/songwriter,S1/Prd Person/producer,S2/Prd Person/mixer');

SELECT public.as_user(:SC);
SELECT public.check_eq('A&R scoped to Kilo: Kilo''s song''s credits only',
  public.visible_credits(), 'S2/Prd Person/mixer');
SELECT public.check_eq('… and only the parties credited on songs in that scope (06 §3), not the org-level directory',
  public.visible_parties(), 'Prd Person');

SELECT public.as_user(:PRD);
SELECT public.check_eq('producer-function member (rights.read.own_line): ONLY their own credit lines, across songs',
  public.visible_credits(), 'S1/Prd Person/producer,S2/Prd Person/mixer');
SELECT public.check_eq('… and ONLY their own party (not Nova''s IPI or legal name)', public.visible_parties(), 'Prd Person');

SELECT public.as_user(:MK);
SELECT public.check_eq('marketing (catalog.read, no rights ability): no credit', public.visible_credits(), '');
SELECT public.check_eq('… and no party', public.visible_parties(), '');
SELECT public.check_eq('… although it does hold catalog.read',
  public.has_org_cap(:L, 'catalog.read') AND NOT public.has_org_cap(:L, 'rights.read') AND NOT public.has_org_cap(:L, 'rights.read.own_line'), true);

SELECT public.as_user(:EXT);
SELECT public.check_eq('an external project member (editor on Nova''s project) reads no credit through the database',
  public.visible_credits(), '');
SELECT public.check_eq('… nor any party', public.visible_parties(), '');

SELECT public.as_user(:X);
SELECT public.check_eq('L2''s owner: only L2''s credit', public.visible_credits(), 'XS1/Xen/songwriter');
SELECT public.check_eq('… and only L2''s party', public.visible_parties(), 'Xen');

SELECT public.as_user(:OUT);
SELECT public.check_eq('a user in no org: nothing', public.visible_credits() || '|' || public.visible_parties(), '|');

SELECT public.as_user(:P);
SELECT public.check_eq('the producer reads their own credit and no org credit (existing credits read unchanged)',
  public.visible_credits(), 'PT/Wheezy/producer');

-- Nothing writes through the API roles.
SELECT public.as_user(:AR);
SELECT public.check_raises('a member cannot insert a party through the API roles',
  $$INSERT INTO public.parties (org_id, display_name) VALUES ('b1530000-0000-4000-8000-000000000001', 'Forged')$$,
  'written through /api/org only|row-level security|permission denied');
SELECT public.check_raises('a member cannot insert a credit on an org song through the API roles',
  $$INSERT INTO public.track_collaborators (track_id, name, role) VALUES ('e1530000-0000-4000-8000-000000000001', 'Forged', 'producer')$$,
  'written through /api/org only|row-level security|permission denied');
SELECT public.check_eq('… nor update one',
  public.rows_changed($$UPDATE public.track_collaborators SET status = 'confirmed' WHERE name = 'Prd Person'$$), 0);
SELECT public.check_eq('… nor delete one',
  public.rows_changed($$DELETE FROM public.track_collaborators WHERE name = 'Nova'$$), 0);
SELECT public.check_raises('authenticated cannot call the audit decision',
  $$SELECT public.labelos_audit_credit_decide('b1530000-0000-4000-8000-000000000001', 'a1530000-0000-4000-8000-000000000002', gen_random_uuid(), 'confirmed', NULL, '{}'::jsonb, '{}'::jsonb)$$,
  'permission denied');
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon: no credit, no party, and no permission error', public.visible_credits() || '|' || public.visible_parties(), '|');
RESET ROLE;

-- ── R-08: parties plan their membership tests as hashed subplans ────────

SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('the parties read plans its membership tests as hashed subplans',
  public.plan_filters('SELECT * FROM public.parties') ~ 'hashed SubPlan', true);
SELECT public.check_eq('… and no correlated (per-row) SubPlan or SECURITY DEFINER call remains in the filter',
  public.plan_filters('SELECT * FROM public.parties') ~ '(?<!hashed )SubPlan|can_see_org_|has_org_cap|can_see_artist', false);
RESET ROLE;

-- ── Confirm / dispute: the status and the event commit together ─────────

SET ROLE service_role;
SELECT public.check_eq('confirm: the credit is returned confirmed',
  (public.labelos_audit_credit_decide(:L, :AR, (SELECT id FROM public.track_collaborators WHERE track_id = :S1 AND name = 'Prd Person'),
     'confirmed', NULL, jsonb_build_object('artist_id', :C1, 'project_id', :LP1, 'song_id', :S1), '{"role":"producer"}'::jsonb)
   -> 'credit' ->> 'status'), 'confirmed');
RESET ROLE;
SELECT public.check_eq('… confirmed_by / confirmed_at are the actor''s',
  (SELECT confirmed_by = :AR AND confirmed_at IS NOT NULL FROM public.track_collaborators WHERE track_id = :S1 AND name = 'Prd Person'), true);
SELECT public.check_eq('… and ONE audit event credit.confirmed, visible to the artist side, with the song''s context',
  (SELECT count(*) FROM public.activity_events
   WHERE verb = 'credit.confirmed' AND audit AND visibility = 'artist' AND org_id = :L AND actor_id = :AR
     AND artist_id = :C1 AND project_id = :LP1 AND song_id = :S1 AND subject_type = 'credit'), 1::bigint);

SET ROLE service_role;
SELECT public.check_eq('confirming again is "unchanged" and writes no second event',
  (public.labelos_audit_credit_decide(:L, :AR, (SELECT id FROM public.track_collaborators WHERE track_id = :S1 AND name = 'Prd Person'),
     'confirmed', NULL, '{}'::jsonb, '{}'::jsonb) ->> 'error'), 'unchanged');
SELECT public.check_eq('dispute: the credit comes back disputed',
  (public.labelos_audit_credit_decide(:L, :PRD, (SELECT id FROM public.track_collaborators WHERE track_id = :S1 AND name = 'Prd Person'),
     'disputed', 'I also wrote the bridge', jsonb_build_object('song_id', :S1), '{}'::jsonb) -> 'credit' ->> 'status'), 'disputed');
SELECT public.check_eq('a credit of another org is not found (the function re-checks the org)',
  (public.labelos_audit_credit_decide(:L2, :X, (SELECT id FROM public.track_collaborators WHERE track_id = :S1 AND name = 'Prd Person'),
     'confirmed', NULL, '{}'::jsonb, '{}'::jsonb) ->> 'error'), 'not_found');
RESET ROLE;
SELECT public.check_eq('a dispute clears the confirmation and keeps the note',
  (SELECT confirmed_by IS NULL AND confirmed_at IS NULL AND dispute_note = 'I also wrote the bridge'
   FROM public.track_collaborators WHERE track_id = :S1 AND name = 'Prd Person'), true);
SELECT public.check_eq('… and one credit.disputed event',
  (SELECT count(*) FROM public.activity_events WHERE verb = 'credit.disputed' AND audit AND actor_id = :PRD), 1::bigint);

SET ROLE service_role;
SELECT public.check_raises('a secret-looking payload key rolls the whole decision back',
  $$SELECT public.labelos_audit_credit_decide('b1530000-0000-4000-8000-000000000001', 'a1530000-0000-4000-8000-000000000001',
      (SELECT id FROM public.track_collaborators WHERE name = 'Nova' AND org_id = 'b1530000-0000-4000-8000-000000000001'),
      'disputed', NULL, '{}'::jsonb, '{"api_token":"x"}'::jsonb)$$, 'secret-looking key');
RESET ROLE;
SELECT public.check_eq('… the credit is as it was',
  (SELECT status FROM public.track_collaborators WHERE name = 'Nova' AND org_id = :L), 'confirmed');

-- ── Cascades ────────────────────────────────────────────────────────────

DELETE FROM public.tracks WHERE id = :S2;
SELECT public.check_eq('deleting a song deletes its credits',
  (SELECT count(*) FROM public.track_collaborators WHERE track_id = :S2), 0::bigint);
