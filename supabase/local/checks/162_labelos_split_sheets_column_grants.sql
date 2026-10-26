-- Behaviour checks for 162_labelos_split_sheets_column_grants.sql (LABEL-43,
-- review G6 F1 — the D2 breach), run by scripts/local-db/check.sh
-- (npm run db:local:check) in its own copy of the throwaway database. Every
-- check RAISEs on failure; psql stops at the first.
--
-- What is proven, as `authenticated` with each member's own JWT claims (the
-- way PostgREST reads) and as `anon`:
--   - THE RULE: an own-line reader (member, producer function) still reads the
--     signed sheet they are on — its status and dates — and can NOT read its
--     note, created_by, circulated_by, document_asset_id, superseded_by or
--     updated_at: not by naming the column, not by `*`, not as a whole row,
--     not by filtering or ordering on it;
--   - the same columns are closed to every API role, a whole-org rights
--     reader included (the routes read with the service role), and anon reads
--     no row and gets no permission error for the granted columns;
--   - the row rule is unchanged (155): marketing still reads no sheet;
--   - the service role (what every route uses) still reads every column.
--
-- Against 155's grants (before 162) the first "permission denied" check fails:
-- the own-line reader reads the note.
--
-- Cast: label L: owner O; AR (A&R, rights.read, whole org); PRD (member,
--   function producer = own line only); MK (marketing, no rights ability).
--   S1 = Nova's song in LP1, one composition sheet: circulated, then signed by
--   upload (so every hidden column holds a value).

\set O    '''a1620000-0000-4000-8000-000000000001'''
\set AR   '''a1620000-0000-4000-8000-000000000002'''
\set PRD  '''a1620000-0000-4000-8000-000000000003'''
\set MK   '''a1620000-0000-4000-8000-000000000004'''
\set L    '''b1620000-0000-4000-8000-000000000001'''
\set C1   '''c1620000-0000-4000-8000-0000000000c1'''
\set LP1  '''d1620000-0000-4000-8000-000000000011'''
\set S1   '''e1620000-0000-4000-8000-000000000001'''
\set PA   '''f1620000-0000-4000-8000-0000000000a1'''
\set PB   '''f1620000-0000-4000-8000-0000000000a2'''
\set AS1  '''a5620000-0000-4000-8000-000000000001'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o162@local.test'), (:AR, 'ar162@local.test'), (:PRD, 'prd162@local.test'), (:MK, 'mk162@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES (:L, 'Label L', 'label-l-162', 'label', :O);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org'),
  (:L, :PRD, 'member', '{producer}', 'org'),
  (:L, :MK, 'member', '{marketing}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES (:C1, NULL, :L, 'Nova', 'nova162@local.test', 'artist');
INSERT INTO public.projects (id, user_id, org_id, name) VALUES (:LP1, NULL, :L, 'Nova EP');
INSERT INTO public.project_contacts (user_id, project_id, contact_id, role) VALUES (NULL, :LP1, :C1, 'artist');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S1, NULL, :L, :AR, 'Nova demo', 'song', 'r2://private/orgs/l/s1', 'in_review');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES (:LP1, :S1, 0);
INSERT INTO public.parties (id, org_id, kind, display_name, user_id) VALUES
  (:PA, :L, 'person', 'Prd Person', :PRD),
  (:PB, :L, 'person', 'Nova', NULL);
INSERT INTO public.project_assets (id, user_id, created_by, project_id, kind, sensitivity, url) VALUES
  (:AS1, NULL, :O, :LP1, 'split_sheet', 'restricted', 'r2://private/orgs/l/assets/split162.pdf');

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
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text), public.as_user(text)
  TO anon, authenticated, service_role;

-- ── A real sheet, through the service-role functions the routes call ────

SET ROLE service_role;
SELECT public.labelos_split_create_draft(:L, :AR, :S1, 'composition', 'the negotiation note',
  jsonb_build_array(jsonb_build_object('party_id', :PA::text, 'role', 'writer', 'share', '40'),
                    jsonb_build_object('party_id', :PB::text, 'role', 'writer', 'share', '60')), NULL);
SELECT public.check_eq('setup: the sheet circulates',
  (public.labelos_audit_split_circulate(:L, :AR, (SELECT id FROM public.split_sheets WHERE track_id = :S1),
     jsonb_build_object('song_id', :S1::text), '{}'::jsonb) -> 'sheet' ->> 'status'), 'circulated');
SELECT public.check_eq('setup: a signed PDF signs it',
  (public.labelos_audit_split_sign(:L, :O, (SELECT id FROM public.split_sheets WHERE track_id = :S1), NULL, 'upload', :AS1,
     '{}'::jsonb, '{}'::jsonb) -> 'sheet' ->> 'status'), 'signed');
RESET ROLE;
SELECT public.check_eq('setup: every hidden column holds a value',
  (SELECT note IS NOT NULL AND created_by IS NOT NULL AND circulated_by IS NOT NULL AND document_asset_id IS NOT NULL
   FROM public.split_sheets WHERE track_id = :S1), true);

-- ── Grants, as the catalog states them ──────────────────────────────────

SELECT public.check_eq('authenticated holds no table-wide SELECT on split_sheets',
  has_table_privilege('authenticated', 'public.split_sheets', 'SELECT'), false);
SELECT public.check_eq('anon neither', has_table_privilege('anon', 'public.split_sheets', 'SELECT'), false);
SELECT public.check_eq('the columns authenticated may read are exactly the status columns',
  (SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'split_sheets'
     AND has_column_privilege('authenticated', 'public.split_sheets', column_name, 'SELECT')),
  'circulated_at,created_at,id,kind,org_id,signed_at,status,superseded_at,track_id,version');
SELECT public.check_eq('… and anon the same',
  (SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'split_sheets'
     AND has_column_privilege('anon', 'public.split_sheets', column_name, 'SELECT')),
  'circulated_at,created_at,id,kind,org_id,signed_at,status,superseded_at,track_id,version');
SELECT public.check_eq('service_role keeps the whole table',
  has_table_privilege('service_role', 'public.split_sheets', 'SELECT'), true);

-- ── THE RULE: the own-line reader, on their own JWT ─────────────────────

SET ROLE authenticated;
SELECT public.as_user(:PRD);
SELECT public.check_eq('own line: still reads the sheet they are on — status and dates',
  (SELECT status || '/' || kind || '/v' || version || '/' || (signed_at IS NOT NULL) || '/' || (circulated_at IS NOT NULL)
   FROM public.split_sheets), 'signed/composition/v1/true/true');
SELECT public.check_raises('own line: the negotiation NOTE is unreadable',
  $$SELECT note FROM public.split_sheets$$, 'permission denied');
SELECT public.check_raises('own line: created_by is unreadable', $$SELECT created_by FROM public.split_sheets$$, 'permission denied');
SELECT public.check_raises('own line: circulated_by is unreadable', $$SELECT circulated_by FROM public.split_sheets$$, 'permission denied');
SELECT public.check_raises('own line: document_asset_id is unreadable', $$SELECT document_asset_id FROM public.split_sheets$$, 'permission denied');
SELECT public.check_raises('own line: superseded_by is unreadable', $$SELECT superseded_by FROM public.split_sheets$$, 'permission denied');
SELECT public.check_raises('own line: updated_at is unreadable', $$SELECT updated_at FROM public.split_sheets$$, 'permission denied');
SELECT public.check_raises('own line: select * is refused', $$SELECT * FROM public.split_sheets$$, 'permission denied');
SELECT public.check_raises('own line: the whole row as json is refused', $$SELECT to_jsonb(s) FROM public.split_sheets s$$, 'permission denied');
SELECT public.check_raises('own line: filtering on the note is refused (no guessing it a letter at a time)',
  $$SELECT id FROM public.split_sheets WHERE note LIKE 'the%'$$, 'permission denied');
SELECT public.check_raises('own line: ordering by it is refused too',
  $$SELECT id FROM public.split_sheets ORDER BY note$$, 'permission denied');
SELECT public.check_raises('own line: nor through RETURNING on a write',
  $$UPDATE public.split_sheets SET status = status RETURNING note$$, 'permission denied');

-- A whole-org rights reader: the same columns are closed (the app reads them through the service role).
SELECT public.as_user(:AR);
SELECT public.check_eq('A&R (rights.read, whole org): reads the sheet''s status',
  (SELECT status FROM public.split_sheets), 'signed');
SELECT public.check_raises('A&R: the note is not readable on their own JWT either', $$SELECT note FROM public.split_sheets$$, 'permission denied');

-- The row rule is 155's: marketing reads no sheet.
SELECT public.as_user(:MK);
SELECT public.check_eq('marketing: no sheet (the row rule is unchanged)', (SELECT count(*) FROM public.split_sheets), 0::bigint);
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon: the granted columns answer no row, and no permission error',
  (SELECT count(*) FROM public.split_sheets), 0::bigint);
SELECT public.check_raises('anon: the note is a permission error', $$SELECT note FROM public.split_sheets$$, 'permission denied');
RESET ROLE;

-- ── The routes' client still reads everything ───────────────────────────

SET ROLE service_role;
SELECT public.check_eq('service_role (every route): reads the note and the document',
  (SELECT note || '/' || (document_asset_id = :AS1) FROM public.split_sheets WHERE track_id = :S1), 'the negotiation note/true');
RESET ROLE;
