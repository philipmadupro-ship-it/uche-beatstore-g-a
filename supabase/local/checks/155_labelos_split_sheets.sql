-- Behaviour checks for 155_labelos_split_sheets.sql (LABEL-28), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- What is proven:
--   - 33.3333 x 3 cannot circulate (function AND raw trigger); 33.3334 +
--     33.3333 + 33.3333 can; a composition sheet takes composition roles only;
--   - from circulated on, nothing about a line or the sheet changes — insert,
--     update (party / role / share), delete, the sheet's note and delete — and
--     the trigger is what holds it, not the route;
--   - a signature is written once, NULL -> set, and only on a circulated sheet;
--   - a new version supersedes the old one in the circulate transaction, with
--     its own event; one draft and one live sheet per (song, kind);
--   - reads, as `authenticated` with each member's own claims: rights.read
--     (whole org / artist scope), the credited person's own non-draft line,
--     nobody else — marketing, another org, an external member, anon;
--   - nothing writes through the API roles; the functions are service_role
--     only; the change and its audit event commit together;
--   - the reads plan as hashed subplans, no per-row definer call (R-08).
--
-- Cast: label L: owner O; AR (A&R, rights.read); SC (A&R scoped to Kilo);
--   PRD (member, function producer = own line only); MK (marketing).
--   label L2: owner X. OUT is a member of nothing. EXT is an external editor.
--   L: S1 = Nova's song (LP1), S2 = Kilo's song (Inbox LP2). L2: XS1.

\set O    '''a1550000-0000-4000-8000-000000000001'''
\set AR   '''a1550000-0000-4000-8000-000000000002'''
\set SC   '''a1550000-0000-4000-8000-000000000003'''
\set PRD  '''a1550000-0000-4000-8000-000000000004'''
\set MK   '''a1550000-0000-4000-8000-000000000005'''
\set X    '''a1550000-0000-4000-8000-000000000006'''
\set OUT  '''a1550000-0000-4000-8000-000000000007'''
\set EXT  '''a1550000-0000-4000-8000-000000000008'''
\set L    '''b1550000-0000-4000-8000-000000000001'''
\set L2   '''b1550000-0000-4000-8000-000000000002'''
\set C1   '''c1550000-0000-4000-8000-0000000000c1'''
\set C2   '''c1550000-0000-4000-8000-0000000000c2'''
\set LP1  '''d1550000-0000-4000-8000-000000000011'''
\set LP2  '''d1550000-0000-4000-8000-000000000012'''
\set XP1  '''d1550000-0000-4000-8000-000000000021'''
\set S1   '''e1550000-0000-4000-8000-000000000001'''
\set S2   '''e1550000-0000-4000-8000-000000000002'''
\set XS1  '''e1550000-0000-4000-8000-000000000003'''
\set PT   '''e1550000-0000-4000-8000-000000000004'''
\set PA   '''f1550000-0000-4000-8000-0000000000a1'''
\set PB   '''f1550000-0000-4000-8000-0000000000a2'''
\set PC   '''f1550000-0000-4000-8000-0000000000a3'''
\set PX   '''f1550000-0000-4000-8000-0000000000a4'''
\set AS1  '''a5550000-0000-4000-8000-000000000001'''
\set AS2  '''a5550000-0000-4000-8000-000000000002'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o155@local.test'), (:AR, 'ar155@local.test'), (:SC, 'sc155@local.test'), (:PRD, 'prd155@local.test'),
  (:MK, 'mk155@local.test'), (:X, 'x155@local.test'), (:OUT, 'out155@local.test'), (:EXT, 'ext155@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-155', 'label', :O),
  (:L2, 'Label L2', 'label-l2-155', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org'),
  (:L, :SC, 'member', '{a_and_r}', 'artists'),
  (:L, :PRD, 'member', '{producer}', 'org'),
  (:L, :MK, 'member', '{marketing}', 'org'),
  (:L2, :X, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova155@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo155@local.test', 'artist');
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
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES (:PT, '0b0e1a57-0000-4000-8000-000000000001', 'P beat', 'beat', 'r2://private/p1');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES (:LP1, :S1, 0), (:LP2, :S2, 0), (:XP1, :XS1, 0);
INSERT INTO public.parties (id, org_id, kind, display_name, legal_name, ipi, user_id) VALUES
  (:PA, :L, 'person', 'Prd Person', 'Pierre Producteur', '00123456789', :PRD),
  (:PB, :L, 'person', 'Nova', 'Nova Okafor', '00987654321', NULL),
  (:PC, :L, 'person', 'Kilo', NULL, NULL, NULL),
  (:PX, :L2, 'person', 'Xen', NULL, NULL, NULL);
INSERT INTO public.project_assets (id, user_id, created_by, project_id, kind, sensitivity, url) VALUES
  (:AS1, NULL, :O, :LP1, 'split_sheet', 'restricted', 'r2://private/orgs/l/assets/split1.pdf'),
  (:AS2, NULL, :O, :LP1, 'artwork', 'normal', 'r2://private/orgs/l/assets/art.png');

CREATE TABLE public.chk_lbl (id uuid PRIMARY KEY, name text NOT NULL);
GRANT SELECT ON public.chk_lbl TO anon, authenticated, service_role;
INSERT INTO public.chk_lbl VALUES (:S1, 'S1'), (:S2, 'S2'), (:XS1, 'XS1');

CREATE TABLE public.chk_party (id uuid PRIMARY KEY, display_name text NOT NULL);
GRANT SELECT ON public.chk_party TO anon, authenticated, service_role;
INSERT INTO public.chk_party SELECT id, display_name FROM public.parties;

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
-- The sheets the caller reads, as "song/kind/vN/status", sorted.
CREATE FUNCTION public.visible_sheets() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(s2.name || '/' || h.kind || '/v' || h.version || '/' || h.status, ',' ORDER BY s2.name, h.kind, h.version), '')
  FROM public.split_sheets h JOIN public.chk_lbl s2 ON s2.id = h.track_id
$$;
-- The lines the caller reads, as "song/party/share", sorted.
CREATE FUNCTION public.visible_lines() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(s2.name || '/' || (SELECT pn.display_name FROM public.chk_party pn WHERE pn.id = l.party_id) || '/' || to_char(l.share, 'FM990.0000'), ',' ORDER BY s2.name, l.share DESC, l.party_id), '')
  FROM public.split_lines l JOIN public.chk_lbl s2 ON s2.id = l.track_id
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
  public.rows_changed(text), public.as_user(text), public.visible_sheets(), public.visible_lines(), public.plan_filters(text)
  TO anon, authenticated, service_role;

-- ── Schema ──────────────────────────────────────────────────────────────

SELECT public.check_eq('RLS is on for both tables',
  (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.split_sheets'::regclass, 'public.split_lines'::regclass)), true);
SELECT public.check_eq('each table has ONE policy, a SELECT',
  (SELECT string_agg(tablename || '.' || policyname || '=' || permissive || '/' || cmd, ' ' ORDER BY tablename) FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('split_sheets', 'split_lines')),
  'split_lines.split_lines_member_read=PERMISSIVE/SELECT split_sheets.split_sheets_member_read=PERMISSIVE/SELECT');
SELECT public.check_eq('a share is numeric(7,4)',
  (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.split_lines'::regclass AND attname = 'share'), 'numeric(7,4)');
SELECT public.check_eq('the service-only write trigger is on both tables',
  (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE t.tgname = 'labelos_org_rows_service_only' AND NOT t.tgisinternal AND c.relname IN ('split_sheets', 'split_lines')),
  'split_lines,split_sheets');
SELECT public.check_eq('the functions are service_role only',
  (SELECT string_agg(p.proname || '=' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
      || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || has_function_privilege('anon', p.oid, 'EXECUTE')::text, ' ' ORDER BY p.proname)
   FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('labelos_audit_split_circulate', 'labelos_audit_split_sign', 'labelos_split_create_draft', 'labelos_split_save_draft')),
  'labelos_audit_split_circulate=truefalsefalse labelos_audit_split_sign=truefalsefalse labelos_split_create_draft=truefalsefalse labelos_split_save_draft=truefalsefalse');

-- ── Drafts ──────────────────────────────────────────────────────────────

SET ROLE service_role;
SELECT public.check_eq('a draft is created with its lines in one step, as version 1',
  (public.labelos_split_create_draft(:L, :AR, :S1, 'composition', 'first cut',
     jsonb_build_array(jsonb_build_object('party_id', :PA::text, 'role', 'writer', 'share', '33.3333'),
                       jsonb_build_object('party_id', :PB::text, 'role', 'writer', 'share', '33.3333'),
                       jsonb_build_object('party_id', :PC::text, 'role', 'writer', 'share', '33.3333')), NULL)
   -> 'sheet' ->> 'version'), '1');
RESET ROLE;

SELECT public.check_eq('the draft carries its song and org on every line (stamped by the trigger)',
  (SELECT count(*) FROM public.split_lines WHERE org_id = :L AND track_id = :S1), 3::bigint);

SET ROLE service_role;
SELECT public.check_eq('33.3333 x 3 cannot circulate: bad_total 99.9999 and the sheet stays a draft',
  (public.labelos_audit_split_circulate(:L, :AR, (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition'),
     jsonb_build_object('song_id', :S1), '{}'::jsonb))::text,
  '{"error": "bad_total", "total": 99.9999}');
RESET ROLE;
SELECT public.check_eq('… still a draft', (SELECT status FROM public.split_sheets WHERE track_id = :S1), 'draft');
SELECT public.check_raises('… and the trigger holds it even for a raw UPDATE',
  $$UPDATE public.split_sheets SET status = 'circulated' WHERE track_id = 'e1550000-0000-4000-8000-000000000001'$$,
  'add up to 99\.9999, not 100');

SET ROLE service_role;
SELECT public.check_eq('a second draft of the same song and kind is refused',
  (public.labelos_split_create_draft(:L, :AR, :S1, 'composition', NULL, NULL, NULL) ->> 'error'), 'draft_exists');
SELECT public.check_eq('a master draft of the same song is a different sheet',
  (public.labelos_split_create_draft(:L, :AR, :S1, 'master', NULL,
     jsonb_build_array(jsonb_build_object('party_id', :PC::text, 'role', 'master_owner', 'share', '100')), NULL) -> 'sheet' ->> 'version'), '1');
SELECT public.check_eq('a song of another org is not found',
  (public.labelos_split_create_draft(:L2, :X, :S1, 'composition', NULL, NULL, NULL) ->> 'error'), 'not_found');
SELECT public.check_eq('a producer track is not found (a sheet belongs to an org song)',
  (public.labelos_split_create_draft(:L, :AR, :PT, 'composition', NULL, NULL, NULL) ->> 'error'), 'not_found');
RESET ROLE;

SELECT public.check_raises('a composition sheet takes composition roles only',
  $$INSERT INTO public.split_lines (split_sheet_id, party_id, role, share)
    VALUES ((SELECT id FROM public.split_sheets WHERE track_id = 'e1550000-0000-4000-8000-000000000001' AND kind = 'composition'), 'f1550000-0000-4000-8000-0000000000a1', 'master_owner', 1)$$,
  'not a role of a composition sheet');
SELECT public.check_raises('a master sheet takes master_owner only',
  $$INSERT INTO public.split_lines (split_sheet_id, party_id, role, share)
    VALUES ((SELECT id FROM public.split_sheets WHERE track_id = 'e1550000-0000-4000-8000-000000000001' AND kind = 'master'), 'f1550000-0000-4000-8000-0000000000a1', 'writer', 1)$$,
  'not a role of a master sheet');
SELECT public.check_raises('a line cannot name another org''s party',
  $$INSERT INTO public.split_lines (split_sheet_id, party_id, role, share)
    VALUES ((SELECT id FROM public.split_sheets WHERE track_id = 'e1550000-0000-4000-8000-000000000001' AND kind = 'composition'), 'f1550000-0000-4000-8000-0000000000a4', 'writer', 1)$$,
  'party must belong to the same organization');
SELECT public.check_raises('a share of 0 is refused', $$UPDATE public.split_lines SET share = 0 WHERE role = 'writer'$$, 'split_lines_share_check');
SELECT public.check_raises('a share over 100 is refused', $$UPDATE public.split_lines SET share = 100.0001 WHERE role = 'writer'$$, 'split_lines_share_check');
SELECT public.check_raises('the same party and role twice is refused',
  $$INSERT INTO public.split_lines (split_sheet_id, party_id, role, share)
    VALUES ((SELECT id FROM public.split_sheets WHERE track_id = 'e1550000-0000-4000-8000-000000000001' AND kind = 'composition'), 'f1550000-0000-4000-8000-0000000000a1', 'writer', 1)$$,
  'split_lines_party_role_uniq|duplicate key');
SELECT public.check_raises('a sheet of a producer track cannot be inserted',
  $$INSERT INTO public.split_sheets (org_id, track_id, kind, version) VALUES ('b1550000-0000-4000-8000-000000000001', 'e1550000-0000-4000-8000-000000000004', 'composition', 1)$$,
  'song must be a song of the same organization');
SELECT public.check_raises('a sheet cannot start circulated',
  $$INSERT INTO public.split_sheets (org_id, track_id, kind, version, status) VALUES ('b1550000-0000-4000-8000-000000000001', 'e1550000-0000-4000-8000-000000000002', 'composition', 1, 'circulated')$$,
  'starts as a draft');

-- Saving the draft replaces the lines atomically; 33.3334 + 33.3333 + 33.3333 = 100.
SET ROLE service_role;
SELECT public.check_eq('saving a draft replaces its lines',
  (public.labelos_split_save_draft(:L, (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition'), true, 'second cut', true,
     jsonb_build_array(jsonb_build_object('party_id', :PA::text, 'role', 'writer', 'share', '33.3334'),
                       jsonb_build_object('party_id', :PB::text, 'role', 'writer', 'share', '33.3333'),
                       jsonb_build_object('party_id', :PC::text, 'role', 'writer', 'share', '33.3333'))) -> 'sheet' ->> 'note'), 'second cut');
RESET ROLE;
SELECT public.check_eq('… in the order they were written (rows of one statement share a created_at, so position says which is first)',
  (SELECT string_agg(party_id::text, ',' ORDER BY position) FROM public.split_lines WHERE track_id = :S1 AND role = 'writer'),
  :PA || ',' || :PB || ',' || :PC);
SELECT public.check_eq('… three lines, summing to exactly 100.0000',
  (SELECT sum(share) FROM public.split_lines WHERE track_id = :S1 AND role = 'writer'), 100.0000::numeric);

-- ── Circulate ───────────────────────────────────────────────────────────

SET ROLE service_role;
SELECT public.check_eq('circulating a sheet that adds up works and returns it circulated',
  (public.labelos_audit_split_circulate(:L, :AR, (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition'),
     jsonb_build_object('artist_id', :C1::text, 'project_id', :LP1::text, 'song_id', :S1::text), '{"kind":"composition","version":1,"lines":3}'::jsonb)
   -> 'sheet' ->> 'status'), 'circulated');
SELECT public.check_eq('circulating again is "not_draft"',
  (public.labelos_audit_split_circulate(:L, :AR, (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition'), '{}'::jsonb, '{}'::jsonb) ->> 'error'), 'not_draft');
SELECT public.check_eq('another org''s sheet is not found',
  (public.labelos_audit_split_circulate(:L2, :X, (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition'), '{}'::jsonb, '{}'::jsonb) ->> 'error'), 'not_found');
SELECT public.labelos_split_create_draft(:L, :AR, :S2, 'master', NULL, NULL, NULL);
SELECT public.check_eq('a draft with no lines is "no_lines"',
  (public.labelos_audit_split_circulate(:L, :AR, (SELECT id FROM public.split_sheets WHERE track_id = :S2 AND kind = 'master'), '{}'::jsonb, '{}'::jsonb) ->> 'error'), 'no_lines');
RESET ROLE;
DELETE FROM public.split_sheets WHERE track_id = :S2 AND kind = 'master';
SELECT public.check_eq('the master draft has one line at 100',
  (SELECT sum(share) FROM public.split_lines l JOIN public.split_sheets s ON s.id = l.split_sheet_id WHERE s.track_id = :S1 AND s.kind = 'master'), 100::numeric);

SELECT public.check_eq('… ONE audit event split_sheet.circulated, internal, with the song''s context',
  (SELECT count(*) FROM public.activity_events
   WHERE verb = 'split_sheet.circulated' AND audit AND visibility = 'internal' AND org_id = :L AND actor_id = :AR
     AND artist_id = :C1 AND project_id = :LP1 AND song_id = :S1 AND subject_type = 'split_sheet'), 1::bigint);
SELECT public.check_eq('… circulated_by / circulated_at are set',
  (SELECT circulated_by = :AR AND circulated_at IS NOT NULL FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition'), true);

-- ── A circulated sheet cannot be edited: the trigger holds ──────────────

SELECT public.check_raises('a line''s share cannot change',
  $$UPDATE public.split_lines SET share = 50 WHERE track_id = 'e1550000-0000-4000-8000-000000000001' AND role = 'writer' AND party_id = 'f1550000-0000-4000-8000-0000000000a2'$$,
  'circulated sheet cannot be edited');
SELECT public.check_raises('a line''s party cannot change',
  $$UPDATE public.split_lines SET party_id = 'f1550000-0000-4000-8000-0000000000a1' WHERE party_id = 'f1550000-0000-4000-8000-0000000000a2' AND track_id = 'e1550000-0000-4000-8000-000000000001'$$,
  'circulated sheet cannot be edited');
SELECT public.check_raises('a line''s role cannot change',
  $$UPDATE public.split_lines SET role = 'composer' WHERE party_id = 'f1550000-0000-4000-8000-0000000000a2' AND track_id = 'e1550000-0000-4000-8000-000000000001'$$,
  'circulated sheet cannot be edited');
SELECT public.check_raises('a line cannot be added',
  $$INSERT INTO public.split_lines (split_sheet_id, party_id, role, share)
    VALUES ((SELECT id FROM public.split_sheets WHERE track_id = 'e1550000-0000-4000-8000-000000000001' AND kind = 'composition'), 'f1550000-0000-4000-8000-0000000000a1', 'publisher', 1)$$,
  'circulated sheet cannot be edited');
SELECT public.check_raises('a line cannot be deleted',
  $$DELETE FROM public.split_lines WHERE party_id = 'f1550000-0000-4000-8000-0000000000a2' AND track_id = 'e1550000-0000-4000-8000-000000000001'$$,
  'circulated sheet cannot be edited');
SELECT public.check_raises('the note cannot change',
  $$UPDATE public.split_sheets SET note = 'sneaky' WHERE track_id = 'e1550000-0000-4000-8000-000000000001' AND kind = 'composition'$$,
  'circulated sheet cannot be edited');
SELECT public.check_raises('the sheet cannot be deleted',
  $$DELETE FROM public.split_sheets WHERE track_id = 'e1550000-0000-4000-8000-000000000001' AND kind = 'composition'$$,
  'circulated sheet cannot be deleted');
SELECT public.check_raises('the sheet cannot go back to a draft',
  $$UPDATE public.split_sheets SET status = 'draft' WHERE track_id = 'e1550000-0000-4000-8000-000000000001' AND kind = 'composition'$$,
  'cannot go from circulated to draft');
SELECT public.check_raises('its song and version cannot change',
  $$UPDATE public.split_sheets SET version = 9 WHERE track_id = 'e1550000-0000-4000-8000-000000000001' AND kind = 'composition'$$,
  'keeps its organization, song, kind and version');
SELECT public.check_raises('a circulated sheet''s song cannot be deleted while it is on record',
  $$DELETE FROM public.tracks WHERE id = 'e1550000-0000-4000-8000-000000000001'$$,
  'violates foreign key|cannot be deleted');
SELECT public.check_raises('a party on a sheet cannot be deleted',
  $$DELETE FROM public.parties WHERE id = 'f1550000-0000-4000-8000-0000000000a2'$$,
  'violates foreign key');

-- The all-or-nothing audit: a bad payload rolls the whole transition back.
SET ROLE service_role;
SELECT public.check_raises('a secret-looking payload key rolls the whole circulation back',
  $$SELECT public.labelos_audit_split_circulate('b1550000-0000-4000-8000-000000000001', 'a1550000-0000-4000-8000-000000000001',
      (SELECT id FROM public.split_sheets WHERE track_id = 'e1550000-0000-4000-8000-000000000001' AND kind = 'master'), '{}'::jsonb, '{"api_token":"x"}'::jsonb)$$,
  'secret-looking key');
RESET ROLE;
SELECT public.check_eq('… the master sheet is still a draft', (SELECT status FROM public.split_sheets WHERE track_id = :S1 AND kind = 'master'), 'draft');

-- ── Signatures ──────────────────────────────────────────────────────────

SET ROLE service_role;
SELECT public.check_eq('a draft cannot be signed',
  (public.labelos_audit_split_sign(:L, :PRD, (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND kind = 'master'), NULL, 'upload', :AS1, '{}'::jsonb, '{}'::jsonb) ->> 'error'),
  'not_circulated');
SELECT public.check_eq('an acknowledgement needs a line',
  (public.labelos_audit_split_sign(:L, :PRD, (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition'), NULL, 'acknowledged', NULL, '{}'::jsonb, '{}'::jsonb) ->> 'error'),
  'bad_method');
SELECT public.check_eq('an upload must point at a restricted split_sheet file of the org (artwork is not)',
  (public.labelos_audit_split_sign(:L, :PRD, (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition'), NULL, 'upload', :AS2, '{}'::jsonb, '{}'::jsonb) ->> 'error'),
  'bad_asset');
SELECT public.check_eq('PRD acknowledges their own line',
  (public.labelos_audit_split_sign(:L, :PRD, (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition'),
     (SELECT l.id FROM public.split_lines l WHERE l.track_id = :S1 AND l.party_id = :PA), 'acknowledged', NULL,
     jsonb_build_object('artist_id', :C1::text, 'song_id', :S1::text), '{"method":"acknowledged"}'::jsonb) ->> 'complete'), 'false');
SELECT public.check_eq('signing the same line twice is "already_signed"',
  (public.labelos_audit_split_sign(:L, :PRD, (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition'),
     (SELECT l.id FROM public.split_lines l WHERE l.track_id = :S1 AND l.party_id = :PA), 'acknowledged', NULL, '{}'::jsonb, '{}'::jsonb) ->> 'error'), 'already_signed');
RESET ROLE;
SELECT public.check_eq('… the line carries the signature and who wrote it',
  (SELECT signed_at IS NOT NULL AND signature_method = 'acknowledged' AND signed_by = :PRD AND signature_asset_id IS NULL
   FROM public.split_lines WHERE track_id = :S1 AND party_id = :PA), true);
SELECT public.check_raises('a signature cannot be rewritten',
  $$UPDATE public.split_lines SET signed_at = now() - interval '1 day' WHERE track_id = 'e1550000-0000-4000-8000-000000000001' AND party_id = 'f1550000-0000-4000-8000-0000000000a1'$$,
  'signature cannot be changed');
SELECT public.check_raises('… nor unsigned',
  $$UPDATE public.split_lines SET signed_at = NULL, signature_method = NULL WHERE track_id = 'e1550000-0000-4000-8000-000000000001' AND party_id = 'f1550000-0000-4000-8000-0000000000a1'$$,
  'signature cannot be changed');
SELECT public.check_raises('the sheet cannot become signed while a line is not',
  $$UPDATE public.split_sheets SET status = 'signed' WHERE track_id = 'e1550000-0000-4000-8000-000000000001' AND kind = 'composition'$$,
  'every line must be signed first');

SET ROLE service_role;
SELECT public.check_eq('a signed PDF covering the sheet signs the remaining lines and the sheet becomes signed',
  (public.labelos_audit_split_sign(:L, :O, (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition'), NULL, 'upload', :AS1,
     jsonb_build_object('artist_id', :C1::text, 'song_id', :S1::text), '{"method":"upload"}'::jsonb) ->> 'complete'), 'true');
RESET ROLE;
SELECT public.check_eq('… status signed, signed_at and the document are on the sheet',
  (SELECT status = 'signed' AND signed_at IS NOT NULL AND document_asset_id = :AS1 FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition'), true);
SELECT public.check_eq('… the other two lines point at the file',
  (SELECT count(*) FROM public.split_lines WHERE track_id = :S1 AND signature_method = 'upload' AND signature_asset_id = :AS1), 2::bigint);
SELECT public.check_eq('… two signature events (one per call), both audit',
  (SELECT count(*) FROM public.activity_events WHERE verb = 'split_sheet.signed' AND audit AND org_id = :L), 2::bigint);
SELECT public.check_eq('… the second marks the sheet complete',
  (SELECT (payload ->> 'complete')::boolean FROM public.activity_events WHERE verb = 'split_sheet.signed' AND actor_id = :O), true);

-- Deleting the file clears the reference, not the record of the signature.
DELETE FROM public.project_assets WHERE id = :AS1;
SELECT public.check_eq('deleting the signed PDF keeps the signatures (the file reference goes null)',
  (SELECT count(*) FROM public.split_lines WHERE track_id = :S1 AND signed_at IS NOT NULL AND signature_asset_id IS NULL AND signature_method = 'upload'), 2::bigint);
SELECT public.check_eq('… and the sheet stays signed', (SELECT status FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition'), 'signed');

-- ── A new version supersedes the old one ────────────────────────────────

SET ROLE service_role;
SELECT public.check_eq('a new version copies the lines of the one it replaces, as version 2',
  (public.labelos_split_create_draft(:L, :AR, :S1, 'composition', NULL, NULL,
     (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition' AND version = 1)) -> 'sheet' ->> 'version'), '2');
RESET ROLE;
SELECT public.check_eq('… the copy carries three unsigned lines, 100.0000 in all',
  (SELECT count(*) || '/' || sum(l.share) || '/' || count(l.signed_at) FROM public.split_lines l JOIN public.split_sheets s ON s.id = l.split_sheet_id
   WHERE s.track_id = :S1 AND s.kind = 'composition' AND s.version = 2), '3/100.0000/0');
SELECT public.check_eq('… v1 is still the signed version in force while v2 is a draft',
  (SELECT string_agg(version || ':' || status, ',' ORDER BY version) FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition'), '1:signed,2:draft');

SET ROLE service_role;
SELECT public.check_eq('circulating v2 returns the id of the sheet it superseded',
  (public.labelos_audit_split_circulate(:L, :AR, (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition' AND version = 2),
     jsonb_build_object('artist_id', :C1::text, 'project_id', :LP1::text, 'song_id', :S1::text), '{"kind":"composition","version":2}'::jsonb)
   ->> 'superseded') = (SELECT id::text FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition' AND version = 1), true);
RESET ROLE;
SELECT public.check_eq('… v1 is superseded (by v2), v2 is circulated: ONE live sheet',
  (SELECT string_agg(version || ':' || status, ',' ORDER BY version) FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition'), '1:superseded,2:circulated');
SELECT public.check_eq('… v1 points at v2 and carries superseded_at',
  (SELECT superseded_by = (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition' AND version = 2) AND superseded_at IS NOT NULL
   FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition' AND version = 1), true);
SELECT public.check_eq('… the supersession is its own audit event, and v1''s signatures are untouched',
  (SELECT count(*) FROM public.activity_events WHERE verb = 'split_sheet.superseded' AND audit AND song_id = :S1) || '/'
  || (SELECT count(*) FROM public.split_lines l JOIN public.split_sheets s ON s.id = l.split_sheet_id WHERE s.version = 1 AND s.track_id = :S1 AND l.signed_at IS NOT NULL),
  '1/3');
SET ROLE service_role;
SELECT public.check_eq('a superseded sheet is closed to signatures',
  (public.labelos_audit_split_sign(:L, :PRD, (SELECT id FROM public.split_sheets WHERE track_id = :S1 AND kind = 'composition' AND version = 1),
     (SELECT l.id FROM public.split_lines l JOIN public.split_sheets s ON s.id = l.split_sheet_id WHERE s.version = 1 AND s.track_id = :S1 AND l.party_id = :PA),
     'acknowledged', NULL, '{}'::jsonb, '{}'::jsonb) ->> 'error'), 'not_circulated');
RESET ROLE;
SELECT public.check_raises('the one-live index refuses a second circulated sheet of the same song and kind',
  $$INSERT INTO public.split_sheets (id, org_id, track_id, kind, version, status) VALUES ('a5550000-0000-4000-8000-0000000000f7', 'b1550000-0000-4000-8000-000000000001', 'e1550000-0000-4000-8000-000000000001', 'composition', 7, 'draft');
    INSERT INTO public.split_lines (split_sheet_id, party_id, role, share) VALUES ('a5550000-0000-4000-8000-0000000000f7', 'f1550000-0000-4000-8000-0000000000a1', 'writer', 100);
    DELETE FROM public.split_sheets WHERE track_id = 'e1550000-0000-4000-8000-000000000001' AND version = 2 AND false;
    UPDATE public.split_sheets SET status = 'circulated' WHERE id = 'a5550000-0000-4000-8000-0000000000f7'$$,
  'idx_split_sheets_one_live|duplicate key');

-- ── Reads, as members, with their own claims ────────────────────────────

-- Draft for Kilo's song (S2) and a second sheet in L2, so scope and org are visible.
SET ROLE service_role;
SELECT public.labelos_split_create_draft(:L, :AR, :S2, 'composition', NULL,
  jsonb_build_array(jsonb_build_object('party_id', :PA::text, 'role', 'writer', 'share', '60'),
                    jsonb_build_object('party_id', :PC::text, 'role', 'writer', 'share', '40')), NULL);
SELECT public.labelos_split_create_draft(:L2, :X, :XS1, 'master', NULL,
  jsonb_build_array(jsonb_build_object('party_id', :PX::text, 'role', 'master_owner', 'share', '100')), NULL);
RESET ROLE;

SET ROLE authenticated;

SELECT public.as_user(:O);
SELECT public.check_eq('owner (rights.read, whole org): every sheet of L, none of L2''s',
  public.visible_sheets(), 'S1/composition/v1/superseded,S1/composition/v2/circulated,S1/master/v1/draft,S2/composition/v1/draft');
SELECT public.check_eq('… and every line of them',
  (SELECT count(*) FROM public.split_lines), 3::bigint + 3 + 1 + 2);

SELECT public.as_user(:AR);
SELECT public.check_eq('A&R (rights.read, whole org): the same', public.visible_sheets(),
  'S1/composition/v1/superseded,S1/composition/v2/circulated,S1/master/v1/draft,S2/composition/v1/draft');

SELECT public.as_user(:SC);
SELECT public.check_eq('A&R scoped to Kilo: Kilo''s song''s sheet only', public.visible_sheets(), 'S2/composition/v1/draft');
SELECT public.check_eq('… and its lines only', public.visible_lines(), 'S2/Prd Person/60.0000,S2/Kilo/40.0000');

SELECT public.as_user(:PRD);
SELECT public.check_eq('producer-function member (own line): only the circulated / signed / superseded sheets they are on — not a draft',
  public.visible_sheets(), 'S1/composition/v1/superseded,S1/composition/v2/circulated');
SELECT public.check_eq('… and ONLY their own lines (not Nova''s 33.3333, not Kilo''s)', public.visible_lines(), 'S1/Prd Person/33.3334,S1/Prd Person/33.3334');

SELECT public.as_user(:MK);
SELECT public.check_eq('marketing (catalog.read, no rights ability): no sheet, no line', public.visible_sheets() || '|' || public.visible_lines(), '|');

SELECT public.as_user(:EXT);
SELECT public.check_eq('an external project member reads nothing through the database (the route serves their own line)',
  public.visible_sheets() || '|' || public.visible_lines(), '|');

SELECT public.as_user(:X);
SELECT public.check_eq('L2''s owner: only L2''s sheet', public.visible_sheets(), 'XS1/master/v1/draft');

SELECT public.as_user(:OUT);
SELECT public.check_eq('a user in no org: nothing', public.visible_sheets() || '|' || public.visible_lines(), '|');

-- Nothing writes through the API roles.
SELECT public.as_user(:AR);
SELECT public.check_raises('a member cannot insert a sheet through the API roles',
  $$INSERT INTO public.split_sheets (org_id, track_id, kind, version) VALUES ('b1550000-0000-4000-8000-000000000001', 'e1550000-0000-4000-8000-000000000002', 'master', 1)$$,
  'written through /api/org only|row-level security|permission denied');
SELECT public.check_raises('… nor a line',
  $$INSERT INTO public.split_lines (split_sheet_id, party_id, role, share) SELECT id, 'f1550000-0000-4000-8000-0000000000a1', 'writer', 1 FROM public.split_sheets LIMIT 1$$,
  'written through /api/org only|row-level security|permission denied');
SELECT public.check_eq('… nor update a sheet', public.rows_changed($$UPDATE public.split_sheets SET note = 'x'$$), 0);
SELECT public.check_eq('… nor delete a line', public.rows_changed($$DELETE FROM public.split_lines$$), 0);
SELECT public.check_raises('authenticated cannot call the circulate function',
  $$SELECT public.labelos_audit_split_circulate('b1550000-0000-4000-8000-000000000001', 'a1550000-0000-4000-8000-000000000002', gen_random_uuid(), '{}'::jsonb, '{}'::jsonb)$$,
  'permission denied');
SELECT public.check_raises('… nor the sign function',
  $$SELECT public.labelos_audit_split_sign('b1550000-0000-4000-8000-000000000001', 'a1550000-0000-4000-8000-000000000002', gen_random_uuid(), NULL, 'upload', gen_random_uuid(), '{}'::jsonb, '{}'::jsonb)$$,
  'permission denied');
SELECT public.check_raises('… nor the draft functions',
  $$SELECT public.labelos_split_create_draft('b1550000-0000-4000-8000-000000000001', 'a1550000-0000-4000-8000-000000000002', 'e1550000-0000-4000-8000-000000000001', 'master', NULL, NULL, NULL)$$,
  'permission denied');
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon: no sheet, no line, and no permission error', public.visible_sheets() || '|' || public.visible_lines(), '|');
RESET ROLE;

-- ── R-08: hashed subplans, no per-row definer call ──────────────────────
-- 162 (LABEL-43) closes the note and the actor columns to the API roles, so the probe names granted columns.

SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('the sheets read plans its membership tests as hashed subplans',
  public.plan_filters('SELECT id, status FROM public.split_sheets') ~ 'hashed SubPlan', true);
SELECT public.check_eq('… and no correlated (per-row) SubPlan or SECURITY DEFINER call remains in the filter',
  public.plan_filters('SELECT id, status FROM public.split_sheets') ~ '(?<!hashed )SubPlan|can_see_org_|has_org_cap|can_see_artist', false);
SELECT public.check_eq('the lines read plans as hashed subplans too',
  public.plan_filters('SELECT * FROM public.split_lines') ~ 'hashed SubPlan', true);
SELECT public.check_eq('… with no correlated SubPlan or per-row definer call',
  public.plan_filters('SELECT * FROM public.split_lines') ~ '(?<!hashed )SubPlan|can_see_org_|has_org_cap|can_see_artist', false);
RESET ROLE;

-- ── Cascades ────────────────────────────────────────────────────────────

DELETE FROM public.split_sheets WHERE track_id = :S2;
SELECT public.check_eq('a draft is deletable, and its lines go with it',
  (SELECT count(*) FROM public.split_lines WHERE track_id = :S2), 0::bigint);
DELETE FROM public.organizations WHERE id = :L;
SELECT public.check_eq('deleting an organization deletes its sheets and lines, circulated ones included',
  (SELECT count(*) FROM public.split_sheets WHERE org_id = :L) + (SELECT count(*) FROM public.split_lines WHERE org_id = :L), 0::bigint);
