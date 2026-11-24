-- Behaviour checks for 203_share_events.sql (SHARE-06), run by
-- scripts/local-db/check.sh. Every check RAISEs on failure.
-- Proven: the owner reads only their own rows; no API role can write; the
-- service role can INSERT but not UPDATE / DELETE; the append-only trigger
-- refuses both; deleting the owner's account cascades their events away; the
-- open-dedupe read is answered from the (owner, share, created_at) index.

\set P1 '''a2030000-0000-4000-8000-000000000001'''
\set P2 '''a2030000-0000-4000-8000-000000000002'''
\set S1 '''b2030000-0000-4000-8000-000000000001'''
\set S2 '''b2030000-0000-4000-8000-000000000002'''

INSERT INTO auth.users (id, email) VALUES (:P1, 'p1-203@local.test'), (:P2, 'p2-203@local.test');

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

-- ── service_role: INSERT only ──────────────────────────────────────────────
SET ROLE service_role;
INSERT INTO public.share_events (share_source, share_id, owner_user_id, kind, ip_hash) VALUES
  ('share_links', :S1, :P1, 'open', 'h1'),
  ('share_links', :S1, :P1, 'download', 'h1'),
  ('project_shares', :S2, :P2, 'open', 'h2');
SELECT public.check_eq('service role inserted', (SELECT count(*)::int FROM public.share_events), 3);
SELECT public.check_raises('a bad kind is refused',
  format('INSERT INTO public.share_events (share_source, share_id, owner_user_id, kind) VALUES (''share_links'', %L, %L, ''purchase'')', :S1, :P1),
  'check constraint');
SELECT public.check_raises('a bad source is refused',
  format('INSERT INTO public.share_events (share_source, share_id, owner_user_id, kind) VALUES (''tracks'', %L, %L, ''open'')', :S1, :P1),
  'check constraint');
SELECT public.check_raises('service role has no UPDATE privilege',
  'UPDATE public.share_events SET kind = ''play''', 'permission denied');
SELECT public.check_raises('service role has no DELETE privilege',
  'DELETE FROM public.share_events', 'permission denied');
RESET ROLE;

-- The trigger refuses even a role that holds the privilege (the table owner).
SELECT public.check_raises('append-only trigger refuses UPDATE',
  'UPDATE public.share_events SET kind = ''play''', 'append-only');
SELECT public.check_raises('append-only trigger refuses DELETE while the owner exists',
  format('DELETE FROM public.share_events WHERE owner_user_id = %L', :P1), 'append-only');

-- ── authenticated: reads only their own, writes nothing ───────────────────
SET ROLE authenticated;
SELECT public.as_user(:P1);
SELECT public.check_eq('P1 reads own rows only', (SELECT count(*)::int FROM public.share_events), 2);
SELECT public.check_eq('P1 sees no row of P2', (SELECT count(*)::int FROM public.share_events WHERE owner_user_id = 'a2030000-0000-4000-8000-000000000002'), 0);
SELECT public.check_raises('authenticated cannot insert',
  format('INSERT INTO public.share_events (share_source, share_id, owner_user_id, kind) VALUES (''share_links'', %L, %L, ''open'')', :S1, :P1),
  'permission denied');
SELECT public.check_raises('authenticated cannot update', 'UPDATE public.share_events SET kind = ''play''', 'permission denied');
SELECT public.check_raises('authenticated cannot delete', 'DELETE FROM public.share_events', 'permission denied');
RESET ROLE;

SET ROLE anon;
SELECT public.check_raises('anon cannot read', 'SELECT count(*) FROM public.share_events', 'permission denied');
SELECT public.check_raises('anon cannot insert',
  format('INSERT INTO public.share_events (share_source, share_id, owner_user_id, kind) VALUES (''share_links'', %L, %L, ''open'')', :S1, :P1),
  'permission denied');
RESET ROLE;

-- ── the 30-minute open dedupe read uses the index ─────────────────────────
INSERT INTO public.share_events (share_source, share_id, owner_user_id, kind, ip_hash)
  SELECT 'share_links', 'b2030000-0000-4000-8000-0000000000ff', :P1, 'open', 'x' || g FROM generate_series(1, 2000) g;
ANALYZE public.share_events;
SET enable_seqscan = off;
CREATE FUNCTION public.__explain(q text) RETURNS SETOF text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  FOR r IN EXECUTE 'EXPLAIN ' || q LOOP RETURN NEXT r; END LOOP;
END $f$;
DO $$
DECLARE plan text;
BEGIN
  SELECT string_agg(x, E'\n') INTO plan FROM public.__explain($q$SELECT 1 FROM public.share_events
      WHERE owner_user_id = 'a2030000-0000-4000-8000-000000000001'
        AND share_id = 'b2030000-0000-4000-8000-000000000001'
        AND kind = 'open' AND ip_hash = 'h1'
        AND created_at > now() - interval '30 minutes' LIMIT 1$q$) x;
  IF plan !~ 'idx_share_events_owner_share_created' THEN
    RAISE EXCEPTION 'CHECK FAILED: dedupe read does not use the index: %', plan;
  END IF;
  IF plan ~ 'Seq Scan' THEN RAISE EXCEPTION 'CHECK FAILED: dedupe read seq-scans: %', plan; END IF;
END $$;
RESET enable_seqscan;

-- ── cascade: deleting the owner's account takes their events along ────────
DELETE FROM auth.users WHERE id = :P1;
SELECT public.check_eq('P1 events gone with the account', (SELECT count(*)::int FROM public.share_events WHERE owner_user_id = 'a2030000-0000-4000-8000-000000000001'), 0);
SELECT public.check_eq('P2 events untouched', (SELECT count(*)::int FROM public.share_events WHERE owner_user_id = 'a2030000-0000-4000-8000-000000000002'), 1);
