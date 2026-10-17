-- Behaviour checks for 167_labelos_release_items_lock_member_cas.sql
-- (LABEL-44, reviews G4 / G7 / G10), run by scripts/local-db/check.sh in its
-- own copy of the throwaway database. Every check RAISEs on failure.
--
-- Cast:
--   OWN owner of label org L, ADM an admin, MEM a member we change
--   C   a roster artist, P its project, S1/S2/S3 org songs
--   RD  a draft release, RX a release we deliver, RC one we cancel,
--   RI  an IMPORTED release (entered delivered), RR one for the race
-- Proven:
--   1. a tracklist changes (add / edit / reorder / remove, any role) only on
--      a draft or an imported release that is not on the store; deleting a
--      release or purging its org still cascades;
--   2. an item add and a delivery are serialised: whichever commits first,
--      the other sees it (two sessions, dblink) — without 167 the add lands
--      on the delivered release;
--   3. labelos_audit_member_update compares p_expect under its row lock: a
--      stale plan writes nothing (no change, no event), also when two admins
--      call it at the same moment; EXECUTE is service_role only.

\set OWN '''a1670000-0000-4000-8000-000000000001'''
\set ADM '''a1670000-0000-4000-8000-000000000002'''
\set MEM '''a1670000-0000-4000-8000-000000000003'''
\set L   '''b1670000-0000-4000-8000-000000000001'''
\set C   '''c1670000-0000-4000-8000-000000000001'''
\set P   '''d1670000-0000-4000-8000-000000000001'''
\set S1  '''e1670000-0000-4000-8000-000000000001'''
\set S2  '''e1670000-0000-4000-8000-000000000002'''
\set S3  '''e1670000-0000-4000-8000-000000000003'''
\set RD  '''f1670000-0000-4000-8000-000000000001'''
\set RX  '''f1670000-0000-4000-8000-000000000002'''
\set RC  '''f1670000-0000-4000-8000-000000000003'''
\set RI  '''f1670000-0000-4000-8000-000000000004'''
\set RR  '''f1670000-0000-4000-8000-000000000005'''

INSERT INTO auth.users (id, email) VALUES (:OWN, 'o167@local.test'), (:ADM, 'a167@local.test'), (:MEM, 'm167@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES (:L, 'Label 167', 'label-167', 'label', :OWN);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :OWN, 'owner', '{}', 'org'),
  (:L, :ADM, 'admin', '{}', 'org'),
  (:L, :MEM, 'member', '{a_and_r}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES (:C, NULL, :L, 'Nova', 'nova167@local.test', 'artist');
INSERT INTO public.projects (id, user_id, org_id, name) VALUES (:P, NULL, :L, 'Nova EP');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S1, NULL, :L, :OWN, 'One',   'song', 'r2://private/orgs/l/s1', 'selected'),
  (:S2, NULL, :L, :OWN, 'Two',   'song', 'r2://private/orgs/l/s2', 'selected'),
  (:S3, NULL, :L, :OWN, 'Three', 'song', 'r2://private/orgs/l/s3', 'selected');
INSERT INTO public.releases (id, org_id, project_id, contact_id, title, created_by) VALUES
  (:RD, :L, :P, :C, 'Draft', :OWN),
  (:RX, :L, :P, :C, 'Delivered', :OWN),
  (:RC, :L, :P, :C, 'Cancelled', :OWN),
  (:RR, :L, :P, :C, 'Race', :OWN);
INSERT INTO public.releases (id, org_id, project_id, contact_id, title, created_by, state, imported_released, delivered_at)
  VALUES (:RI, :L, :P, :C, 'Imported', :OWN, 'delivered', true, now());

CREATE EXTENSION IF NOT EXISTS dblink;

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
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text)
  TO anon, authenticated, service_role;

CREATE FUNCTION public.peer(p_name text) RETURNS text LANGUAGE sql AS $$
  SELECT dblink_connect(p_name, format('host=127.0.0.1 port=%s dbname=%s user=postgres', current_setting('port'), current_database()));
$$;

-- ═══ 1. A tracklist changes only while the release is a draft ═════════════
SET ROLE service_role;

INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES
  (:RD, :L, 1, :S1, :S1), (:RX, :L, 1, :S1, :S1), (:RX, :L, 2, :S2, :S2), (:RC, :L, 1, :S1, :S1);
UPDATE public.release_items SET explicit = true WHERE release_id = :RD;
SELECT public.check_eq('a draft takes items and edits', (SELECT explicit FROM public.release_items WHERE release_id = :RD), true);

UPDATE public.releases SET state = 'delivered', delivered_at = now(), delivered_to = 'Distro' WHERE id = :RX;
UPDATE public.releases SET state = 'cancelled' WHERE id = :RC;

SELECT public.check_raises('no item is added to a delivered release',
  format('INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES (%L, %L, 3, %L, %L)', :RX, :L, :S3, :S3),
  'a delivered release keeps its tracklist');
SELECT public.check_raises('nor edited',
  format('UPDATE public.release_items SET explicit = true WHERE release_id = %L', :RX),
  'a delivered release keeps its tracklist');
SELECT public.check_raises('nor removed',
  format('DELETE FROM public.release_items WHERE release_id = %L AND position = 2', :RX),
  'a delivered release keeps its tracklist');
SELECT public.check_raises('nor reordered through 144''s function',
  format('SELECT public.labelos_release_items_reorder(%L, %L, ARRAY(SELECT id FROM public.release_items WHERE release_id = %L ORDER BY position DESC))', :L, :RX, :RX),
  'a delivered release keeps its tracklist');
SELECT public.check_raises('nor removed through 144''s function',
  format('SELECT public.labelos_release_item_remove(%L, %L, (SELECT id FROM public.release_items WHERE release_id = %L AND position = 1))', :L, :RX, :RX),
  'a delivered release keeps its tracklist');
SELECT public.check_raises('a cancelled release keeps its tracklist too',
  format('INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES (%L, %L, 2, %L, %L)', :RC, :L, :S2, :S2),
  'a cancelled release keeps its tracklist');
SELECT public.check_raises('and its items stay',
  format('DELETE FROM public.release_items WHERE release_id = %L', :RC),
  'a cancelled release keeps its tracklist');
SELECT public.check_eq('the delivered tracklist is as delivered',
  (SELECT string_agg(song_track_id::text, ',' ORDER BY position) FROM public.release_items WHERE release_id = :RX),
  'e1670000-0000-4000-8000-000000000001,e1670000-0000-4000-8000-000000000002');

-- LABEL-42: an imported release's tracklist is what is being entered — editable until it is listed.
INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES (:RI, :L, 1, :S1, :S1), (:RI, :L, 2, :S2, :S2);
UPDATE public.release_items SET explicit = true WHERE release_id = :RI AND position = 2;
SELECT public.labelos_release_item_remove(:L, :RI, (SELECT id FROM public.release_items WHERE release_id = :RI AND position = 1));
SELECT public.check_eq('an imported, unlisted release takes adds, edits and removes',
  (SELECT count(*)::int FROM public.release_items WHERE release_id = :RI), 1);
UPDATE public.releases SET store_listed = true, store_listed_at = now() WHERE id = :RI;
SELECT public.check_raises('once listed, 158''s hold and wording',
  format('INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES (%L, %L, 2, %L, %L)', :RI, :L, :S3, :S3),
  'take the release off the store to change its tracklist');
RESET ROLE;

-- The API roles have no write path at all (144), and that stays so.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'a1670000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, false);
SELECT public.check_raises('the owner''s own JWT writes no item',
  format('INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES (%L, %L, 2, %L, %L)', :RD, :L, :S2, :S2),
  'permission denied|row-level security|written through /api/org only');
RESET ROLE;
SET ROLE anon;
SELECT public.check_raises('anon writes no item',
  format('INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES (%L, %L, 2, %L, %L)', :RD, :L, :S2, :S2),
  'permission denied|row-level security|written through /api/org only');
RESET ROLE;

-- Deleting a cancelled release, and purging the org with a delivered one, still cascade (below, at the end).
DELETE FROM public.releases WHERE id = :RC;
SELECT public.check_eq('deleting a cancelled release cascades its items', (SELECT count(*)::int FROM public.release_items WHERE release_id = :RC), 0);

-- ═══ 2. Tracklist race: an add and a delivery at the same moment ══════════
INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES (:RR, :L, 1, :S1, :S1);
SELECT public.peer('s1');
SELECT public.peer('s2');
SELECT dblink_exec('s1', 'SET ROLE service_role');
SELECT dblink_exec('s2', 'SET ROLE service_role');

-- 2a. The add is first: the delivery waits for it, then delivers it.
SELECT dblink_exec('s1', 'BEGIN');
SELECT dblink_exec('s1', format('INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES (%L, %L, 2, %L, %L)', :RR, :L, :S2, :S2));
SELECT dblink_send_query('s2', format($q$UPDATE public.releases SET state = 'delivered', delivered_at = now(), delivered_to = 'Distro' WHERE id = %L AND state = 'draft'$q$, :RR));
SELECT pg_sleep(0.3);
SELECT public.check_eq('the delivery waits while an add holds the release (FOR SHARE)', dblink_is_busy('s2'), 1);
SELECT dblink_exec('s1', 'COMMIT');
SELECT * FROM dblink_get_result('s2') AS t(r text);
SELECT * FROM dblink_get_result('s2') AS t(r text);
SELECT public.check_eq('then delivers, with the add in it',
  (SELECT state || ':' || (SELECT count(*) FROM public.release_items WHERE release_id = :RR) FROM public.releases WHERE id = :RR), 'delivered:2');

-- 2b. The delivery is first: the add waits for it, then is refused.
UPDATE public.releases SET state = 'draft', delivered_at = NULL, delivered_to = NULL WHERE id = :RR;
SELECT dblink_exec('s1', 'BEGIN');
SELECT dblink_exec('s1', format($q$UPDATE public.releases SET state = 'delivered', delivered_at = now(), delivered_to = 'Distro' WHERE id = %L AND state = 'draft'$q$, :RR));
SELECT dblink_exec('s2', 'BEGIN');
SELECT public.check_eq('the adding session still reads a draft (what tracklistLocked judges)',
  (SELECT s FROM dblink('s2', format('SELECT state FROM public.releases WHERE id = %L', :RR)) AS t(s text)), 'draft');
SELECT dblink_send_query('s2', format('INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES (%L, %L, 3, %L, %L)', :RR, :L, :S3, :S3));
SELECT pg_sleep(0.3);
SELECT public.check_eq('the add waits while the delivery holds the release', dblink_is_busy('s2'), 1);
SELECT dblink_exec('s1', 'COMMIT');
SELECT * FROM dblink_get_result('s2', false) AS t(r text);
SELECT public.check_eq('then is refused: the release it waited for is delivered',
  dblink_error_message('s2') ~ 'a delivered release keeps its tracklist', true);
SELECT * FROM dblink_get_result('s2', false) AS t(r text);
SELECT dblink_exec('s2', 'ROLLBACK');
SELECT public.check_eq('the delivered tracklist has no late add',
  (SELECT count(*)::int FROM public.release_items WHERE release_id = :RR), 2);

-- ═══ 3. Member change compares what the plan was made from ════════════════
SELECT public.check_eq('only the seven-argument function exists',
  (SELECT string_agg(p.oid::regprocedure::text, ',') FROM pg_proc p WHERE p.proname = 'labelos_audit_member_update'),
  'labelos_audit_member_update(uuid,uuid,uuid,jsonb,text,jsonb,jsonb)');
SELECT public.check_eq('EXECUTE: service_role only',
  (SELECT (has_function_privilege('service_role', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'),
           has_function_privilege('anon', p.oid, 'EXECUTE'))::text FROM pg_proc p WHERE p.proname = 'labelos_audit_member_update'),
  '(t,f,f)');

\set EXPECT '''{"role":"member","functions":["a_and_r"],"scope":"org","cap_grants":[],"cap_revokes":[]}'''
SET ROLE service_role;
SELECT public.check_eq('a stale plan (the member is not who the plan saw) is refused with "changed"',
  public.labelos_audit_member_update(:L, :ADM, :MEM, '{"functions":["finance"]}', 'member.capabilities_changed', '{}',
    '{"role":"member","functions":["marketing"],"scope":"org","cap_grants":[],"cap_revokes":[]}') ->> 'error', 'changed');
SELECT public.check_eq('and changed nothing', (SELECT functions FROM public.org_members WHERE org_id = :L AND user_id = :MEM), '{a_and_r}'::text[]);
SELECT public.check_eq('and recorded no event',
  (SELECT count(*)::int FROM public.activity_events WHERE org_id = :L AND verb LIKE 'member.%'), 0);
SELECT public.check_raises('an unknown expectation key is an error, not a pass',
  format('SELECT public.labelos_audit_member_update(%L, %L, %L, %L, %L, %L, %L)', :L, :ADM, :MEM, '{"functions":["finance"]}', 'member.capabilities_changed', '{}', '{"nickname":"x"}'),
  'unknown member expectation key');
SELECT public.check_eq('a fresh plan goes through',
  public.labelos_audit_member_update(:L, :ADM, :MEM, '{"functions":["finance"]}', 'member.capabilities_changed', '{}', :EXPECT) -> 'member' ->> 'functions',
  '["finance"]');
SELECT public.check_eq('with its one event',
  (SELECT count(*)::int FROM public.activity_events WHERE org_id = :L AND verb = 'member.capabilities_changed'), 1);
RESET ROLE;

SET ROLE authenticated;
SELECT public.check_raises('authenticated cannot call it',
  format('SELECT public.labelos_audit_member_update(%L, %L, %L, %L, %L, %L, %L)', :L, :OWN, :MEM, '{"role":"admin"}', 'member.role_changed', '{}', :EXPECT),
  'permission denied');
RESET ROLE;

-- Two admins plan from the same read, then call at the same moment: the second waits on the row lock and is refused.
UPDATE public.org_members SET functions = '{a_and_r}' WHERE org_id = :L AND user_id = :MEM;
SELECT dblink_exec('s1', 'BEGIN');
SELECT public.check_eq('admin one changes the member',
  (SELECT r FROM dblink('s1', format('SELECT public.labelos_audit_member_update(%L, %L, %L, %L, %L, %L, %L)::text',
     :L, :OWN, :MEM, '{"functions":["marketing"]}', 'member.capabilities_changed', '{}', :EXPECT)) AS t(r text))::jsonb -> 'member' ->> 'functions',
  '["marketing"]');
SELECT dblink_send_query('s2', format('SELECT public.labelos_audit_member_update(%L, %L, %L, %L, %L, %L, %L)::text',
  :L, :ADM, :MEM, '{"role":"admin"}', 'member.role_changed', '{}', :EXPECT));
SELECT pg_sleep(0.3);
SELECT public.check_eq('admin two waits on the row lock', dblink_is_busy('s2'), 1);
SELECT dblink_exec('s1', 'COMMIT');
SELECT public.check_eq('then is told the member changed',
  (SELECT r FROM dblink_get_result('s2') AS t(r text))::jsonb ->> 'error', 'changed');
SELECT * FROM dblink_get_result('s2') AS t(r text);
SELECT public.check_eq('admin one''s change stands, admin two''s plan did not overwrite it',
  (SELECT role || ':' || array_to_string(functions, ',') FROM public.org_members WHERE org_id = :L AND user_id = :MEM), 'member:marketing');

SELECT dblink_disconnect('s1');
SELECT dblink_disconnect('s2');

-- Purging the org with a delivered release and its items is not blocked.
DO $$
BEGIN
  DELETE FROM public.organizations WHERE id = 'b1670000-0000-4000-8000-000000000001';
  IF EXISTS (SELECT 1 FROM public.release_items WHERE org_id = 'b1670000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'CHECK FAILED: purging an organization with a delivered release left items behind';
  END IF;
END $$;
