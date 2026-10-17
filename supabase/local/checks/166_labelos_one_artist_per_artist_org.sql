-- Behaviour checks for 166_labelos_one_artist_per_artist_org.sql (LABEL-44,
-- review G2 D1), run by scripts/local-db/check.sh in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- Cast:
--   A    an artist org (139 gives it its one artist contact, SELF)
--   B    a second artist org, emptied of artists for the concurrent case
--   L    a label org (many artists, untouched)
--   PR   a producer with ordinary contacts (untouched)
-- Proven: a second artist in an artist org is refused by the index, whoever
-- writes it and however (insert, change of role, extra role, a kind change),
-- and when two sessions add one at the same moment exactly one lands. The
-- flag is the trigger's, never the writer's. The migration refuses to run
-- over data that already breaks the rule, naming the org.

\set OA  '''a1660000-0000-4000-8000-000000000001'''
\set PR  '''a1660000-0000-4000-8000-000000000002'''
\set A   '''b1660000-0000-4000-8000-000000000001'''
\set B   '''b1660000-0000-4000-8000-000000000002'''
\set L   '''b1660000-0000-4000-8000-000000000003'''

INSERT INTO auth.users (id, email) VALUES (:OA, 'oa166@local.test'), (:PR, 'pr166@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:A, 'Nova', 'nova-166', 'artist', :OA),
  (:B, 'Kai', 'kai-166', 'artist', :OA),
  (:L, 'Label 166', 'label-166', 'label', :OA);

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

SELECT public.check_eq('139 gave each artist org exactly one artist, flagged',
  (SELECT count(*)::int FROM public.contacts WHERE org_id IN (:A, :B) AND org_self_artist), 2);
SELECT public.check_eq('the index is unique and partial on the flag',
  (SELECT indexdef ~ 'CREATE UNIQUE INDEX contacts_one_artist_per_artist_org ON public\.contacts USING btree \(org_id\) WHERE org_self_artist'
   FROM pg_indexes WHERE indexname = 'contacts_one_artist_per_artist_org'),
  true);

-- ── service_role (the org contacts routes) ────────────────────────────────
SET ROLE service_role;

SELECT public.check_raises('a second artist contact in an artist org is refused',
  format($q$INSERT INTO public.contacts (org_id, user_id, name, category) VALUES (%L, NULL, 'Twin', 'artist')$q$, :A),
  'contacts_one_artist_per_artist_org');
SELECT public.check_raises('every artist-group category counts (rapper), trimmed and any case',
  format($q$INSERT INTO public.contacts (org_id, user_id, name, category) VALUES (%L, NULL, 'Twin', '  RAPPER ')$q$, :A),
  'contacts_one_artist_per_artist_org');
SELECT public.check_raises('any surrounding whitespace is trimmed, as groupOfCategory trims (a tab, a newline)',
  format($q$INSERT INTO public.contacts (org_id, user_id, name, category) VALUES (%L, NULL, 'Twin', E'\tartist\n')$q$, :A),
  'contacts_one_artist_per_artist_org');
SELECT public.check_raises('an extra artist role counts too',
  format($q$INSERT INTO public.contacts (org_id, user_id, name, category, secondary_category) VALUES (%L, NULL, 'Twin', 'producer', 'singer')$q$, :A),
  'contacts_one_artist_per_artist_org');

INSERT INTO public.contacts (id, org_id, user_id, name, category)
  VALUES ('c1660000-0000-4000-8000-000000000001', :A, NULL, 'Engineer', 'engineer');
SELECT public.check_eq('a non-artist contact joins the artist org', (SELECT org_self_artist FROM public.contacts WHERE id = 'c1660000-0000-4000-8000-000000000001'), false);
SELECT public.check_raises('turning them into an artist is refused',
  $q$UPDATE public.contacts SET category = 'artist' WHERE id = 'c1660000-0000-4000-8000-000000000001'$q$,
  'contacts_one_artist_per_artist_org');
SELECT public.check_raises('or giving them an extra artist role',
  $q$UPDATE public.contacts SET secondary_category = 'topliner' WHERE id = 'c1660000-0000-4000-8000-000000000001'$q$,
  'contacts_one_artist_per_artist_org');

-- The flag is the trigger's: a writer cannot clear it to make room.
UPDATE public.contacts SET org_self_artist = false WHERE org_id = :A AND category = 'artist';
SELECT public.check_eq('clearing the flag by hand does nothing',
  (SELECT count(*)::int FROM public.contacts WHERE org_id = :A AND org_self_artist), 1);
SELECT public.check_raises('so a second artist is still refused',
  format($q$INSERT INTO public.contacts (org_id, user_id, name, category) VALUES (%L, NULL, 'Twin', 'artist')$q$, :A),
  'contacts_one_artist_per_artist_org');
INSERT INTO public.contacts (id, org_id, user_id, name, category, org_self_artist)
  VALUES ('c1660000-0000-4000-8000-000000000002', :A, NULL, 'Press', 'press', true);
SELECT public.check_eq('nor set it on a non-artist', (SELECT org_self_artist FROM public.contacts WHERE id = 'c1660000-0000-4000-8000-000000000002'), false);

-- A label keeps as many artists as it likes; a producer's contacts are never flagged.
INSERT INTO public.contacts (org_id, user_id, name, category) VALUES (:L, NULL, 'One', 'artist'), (:L, NULL, 'Two', 'artist'), (:L, NULL, 'Three', 'rapper');
INSERT INTO public.contacts (org_id, user_id, name, category) VALUES (NULL, :PR, 'Mine one', 'artist'), (NULL, :PR, 'Mine two', 'artist');
SELECT public.check_eq('label and producer artists are not flagged',
  (SELECT count(*)::int FROM public.contacts WHERE (org_id = :L OR user_id = :PR) AND org_self_artist), 0);

-- Changing roles inside the rule still works: the one artist steps down, another steps up.
UPDATE public.contacts SET category = 'other' WHERE org_id = :A AND category = 'artist';
UPDATE public.contacts SET category = 'artist' WHERE id = 'c1660000-0000-4000-8000-000000000001';
SELECT public.check_eq('one artist again, a different one',
  (SELECT id::text FROM public.contacts WHERE org_id = :A AND org_self_artist), 'c1660000-0000-4000-8000-000000000001');
RESET ROLE;

-- A kind change recomputes: a label with three artists cannot become an artist org.
SELECT public.check_raises('a label with several artists cannot turn into an artist org',
  format($q$UPDATE public.organizations SET kind = 'artist' WHERE id = %L$q$, :L),
  'contacts_one_artist_per_artist_org');
UPDATE public.organizations SET kind = 'label' WHERE id = :A;
SELECT public.check_eq('an artist org turned label drops the flag', (SELECT count(*)::int FROM public.contacts WHERE org_id = :A AND org_self_artist), 0);
UPDATE public.organizations SET kind = 'artist' WHERE id = :A;
SELECT public.check_eq('and turned back, gets it again', (SELECT count(*)::int FROM public.contacts WHERE org_id = :A AND org_self_artist), 1);

-- ── API roles write no org contact at all (139, unchanged) ────────────────
SET ROLE authenticated;
SELECT public.check_raises('authenticated cannot add an org contact',
  format($q$INSERT INTO public.contacts (org_id, user_id, name, category) VALUES (%L, NULL, 'Twin', 'artist')$q$, :B),
  'row-level security|permission denied|contacts_one_artist_per_artist_org');
RESET ROLE;
SET ROLE anon;
SELECT public.check_raises('anon cannot either',
  format($q$INSERT INTO public.contacts (org_id, user_id, name, category) VALUES (%L, NULL, 'Twin', 'artist')$q$, :B),
  'row-level security|permission denied|contacts_one_artist_per_artist_org');
RESET ROLE;

-- ── Two sessions add an artist to the same artist org at once ─────────────
-- B is emptied of artists, then each session runs the route's check (zero
-- artists, so both pass) and inserts. Session one holds its insert open;
-- session two's insert must WAIT on the index, then fail once one commits.
UPDATE public.contacts SET category = 'other' WHERE org_id = :B;

SELECT dblink_connect('s1', format('host=127.0.0.1 port=%s dbname=%s user=postgres', current_setting('port'), current_database()));
SELECT dblink_connect('s2', format('host=127.0.0.1 port=%s dbname=%s user=postgres', current_setting('port'), current_database()));
SELECT dblink_exec('s1', 'SET ROLE service_role');
SELECT dblink_exec('s2', 'SET ROLE service_role');

SELECT dblink_exec('s1', 'BEGIN');
SELECT public.check_eq('session one sees no artist in B (the route check passes)',
  (SELECT n FROM dblink('s1', format('SELECT count(*)::int FROM public.contacts WHERE org_id = %L AND org_self_artist', :B)) AS t(n int)), 0);
SELECT dblink_exec('s1', format($q$INSERT INTO public.contacts (org_id, user_id, name, category) VALUES (%L, NULL, 'First', 'artist')$q$, :B));

SELECT dblink_exec('s2', 'BEGIN');
SELECT public.check_eq('session two sees no artist in B either (the race the route cannot see)',
  (SELECT n FROM dblink('s2', format('SELECT count(*)::int FROM public.contacts WHERE org_id = %L AND org_self_artist', :B)) AS t(n int)), 0);
SELECT dblink_send_query('s2', format($q$INSERT INTO public.contacts (org_id, user_id, name, category) VALUES (%L, NULL, 'Second', 'artist')$q$, :B));
SELECT pg_sleep(0.3);
SELECT public.check_eq('session two waits on session one', dblink_is_busy('s2'), 1);

SELECT dblink_exec('s1', 'COMMIT');
SELECT * FROM dblink_get_result('s2', false) AS t(r text);
SELECT public.check_eq('session two failed on the index', dblink_error_message('s2') ~ 'contacts_one_artist_per_artist_org', true);
SELECT * FROM dblink_get_result('s2', false) AS t(r text);
SELECT dblink_exec('s2', 'ROLLBACK');
SELECT dblink_disconnect('s1');
SELECT dblink_disconnect('s2');

SELECT public.check_eq('exactly one artist landed in B',
  (SELECT count(*)::int FROM public.contacts WHERE org_id = :B AND org_self_artist), 1);
SELECT public.check_eq('and it is session one’s',
  (SELECT name FROM public.contacts WHERE org_id = :B AND org_self_artist), 'First');

-- ── Run over data that already breaks the rule, the migration refuses ─────
-- Two artists in A with the index out of the way, then the migration file
-- itself, in its own session: it must raise naming A and leave the data as
-- it found it.
\set mig166 `cat supabase/migrations/166_labelos_one_artist_per_artist_org.sql`
DROP INDEX public.contacts_one_artist_per_artist_org;
INSERT INTO public.contacts (org_id, user_id, name, category) VALUES (:A, NULL, 'Twin', 'artist');
SELECT dblink_connect('m', format('host=127.0.0.1 port=%s dbname=%s user=postgres', current_setting('port'), current_database()));
SELECT dblink_exec('m', 'BEGIN');
SELECT public.check_raises('the migration names the org that has two artists',
  format('SELECT dblink_exec(%L, %L)', 'm', :'mig166'),
  'more than one artist contact: b1660000-0000-4000-8000-000000000001');
SELECT dblink_exec('m', 'ROLLBACK');
SELECT dblink_disconnect('m');
SELECT public.check_eq('and builds no index over it',
  (SELECT count(*)::int FROM pg_indexes WHERE indexname = 'contacts_one_artist_per_artist_org'), 0);
SELECT public.check_eq('nor touches the contacts',
  (SELECT count(*)::int FROM public.contacts WHERE org_id = :A AND public.labelos_is_artist_category(category)), 2);
