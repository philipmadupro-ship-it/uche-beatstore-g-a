-- Behaviour checks for 169_labelos_overview_seen_per_org.sql (LABEL-46), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven:
--   - a member reads only THEIR OWN per-org rows on their own JWT: not another
--     member's row in the same org, and not a row of an org they have left;
--   - the API roles cannot insert, update or delete (anon cannot even read);
--   - service_role writes, and the (org, user) key holds two orgs' marks apart:
--     moving org A's mark leaves org B's alone;
--   - the backfill copies the user-level value to every membership and is
--     idempotent;
--   - deleting the organization removes its marks, and only its marks.

\set O  '''a1690000-0000-4000-8000-000000000001'''
\set M  '''a1690000-0000-4000-8000-000000000002'''
\set LA '''b1690000-0000-4000-8000-000000000001'''
\set LB '''b1690000-0000-4000-8000-000000000002'''

INSERT INTO auth.users (id, email) VALUES (:O, 'o169@local.test'), (:M, 'm169@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:LA, 'Label A', 'label-a-169', 'label', :O),
  (:LB, 'Label B', 'label-b-169', 'label', :O);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:LA, :O, 'owner', '{}', 'org'),
  (:LB, :O, 'owner', '{}', 'org'),
  (:LA, :M, 'member', '{a_and_r}', 'org'),
  (:LB, :M, 'member', '{a_and_r}', 'org');

CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement) TO anon, authenticated, service_role;

-- Backfill: re-run the migration's statement against a user-level value.
INSERT INTO public.user_profiles (user_id, last_seen_overview_at) VALUES (:M, '2026-10-01T00:00:00Z')
  ON CONFLICT (user_id) DO UPDATE SET last_seen_overview_at = EXCLUDED.last_seen_overview_at;
INSERT INTO public.org_overview_seen (org_id, user_id, last_seen_at)
SELECT om.org_id, om.user_id, up.last_seen_overview_at
FROM public.org_members om JOIN public.user_profiles up ON up.user_id = om.user_id
WHERE up.last_seen_overview_at IS NOT NULL
ON CONFLICT (org_id, user_id) DO NOTHING;
INSERT INTO public.org_overview_seen (org_id, user_id, last_seen_at)
SELECT om.org_id, om.user_id, up.last_seen_overview_at
FROM public.org_members om JOIN public.user_profiles up ON up.user_id = om.user_id
WHERE up.last_seen_overview_at IS NOT NULL
ON CONFLICT (org_id, user_id) DO NOTHING;
SELECT public.check_eq('backfill: one row per membership, idempotent', (SELECT count(*) FROM public.org_overview_seen WHERE user_id = :M), 2::bigint);
SELECT public.check_eq('backfill: carries the user-level value', (SELECT min(last_seen_at) FROM public.org_overview_seen WHERE user_id = :M), '2026-10-01T00:00:00Z'::timestamptz);

-- service_role: org A's mark moves, org B's does not; the owner gets their own rows.
SET ROLE service_role;
UPDATE public.org_overview_seen SET last_seen_at = '2026-10-05T00:00:00Z' WHERE org_id = :LA AND user_id = :M;
INSERT INTO public.org_overview_seen (org_id, user_id, last_seen_at) VALUES (:LA, :O, '2026-10-03T00:00:00Z'), (:LB, :O, '2026-10-04T00:00:00Z');
SELECT public.check_eq('moving org A leaves org B alone', (SELECT last_seen_at FROM public.org_overview_seen WHERE org_id = :LB AND user_id = :M), '2026-10-01T00:00:00Z'::timestamptz);
SELECT public.check_eq('org A moved', (SELECT last_seen_at FROM public.org_overview_seen WHERE org_id = :LA AND user_id = :M), '2026-10-05T00:00:00Z'::timestamptz);
RESET ROLE;

-- The member M reads exactly their two rows, none of the owner's.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'a1690000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, false);
SELECT public.check_eq('member reads their own rows only', (SELECT count(*) FROM public.org_overview_seen), 2::bigint);
SELECT public.check_eq('member reads no row of another member', (SELECT count(*) FROM public.org_overview_seen WHERE user_id = 'a1690000-0000-4000-8000-000000000001'), 0::bigint);
RESET ROLE;
RESET request.jwt.claims;

-- Leaving an org removes that member's mark (trigger) and hides it meanwhile (the org_role gate).
SET ROLE service_role;
DELETE FROM public.org_members WHERE org_id = :LB AND user_id = :M;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'a1690000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, false);
SELECT public.check_eq('a former member reads nothing of that org', (SELECT count(*) FROM public.org_overview_seen WHERE org_id = :LB), 0::bigint);
RESET ROLE;
RESET request.jwt.claims;
SELECT public.check_eq('and the mark itself is gone, not just hidden', (SELECT count(*) FROM public.org_overview_seen WHERE org_id = :LB AND user_id = :M), 0::bigint);
SELECT public.check_eq('the owner’s mark in that org stays', (SELECT count(*) FROM public.org_overview_seen WHERE org_id = :LB AND user_id = :O), 1::bigint);
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'a1690000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, false);
SELECT public.check_eq('and still reads the org they remain in', (SELECT count(*) FROM public.org_overview_seen WHERE org_id = :LA), 1::bigint);
RESET ROLE;
RESET request.jwt.claims;

-- Writes are refused for the API roles; anon cannot read.
DO $$
DECLARE r text; denied int := 0;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', 'a1690000-0000-4000-8000-000000000002', 'role', r)::text, true);
    BEGIN
      INSERT INTO public.org_overview_seen (org_id, user_id, last_seen_at) VALUES ('b1690000-0000-4000-8000-000000000001', 'a1690000-0000-4000-8000-000000000002', now());
      RAISE EXCEPTION 'CHECK FAILED: % inserted', r;
    EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1;
    END;
    BEGIN
      UPDATE public.org_overview_seen SET last_seen_at = now();
      RAISE EXCEPTION 'CHECK FAILED: % updated', r;
    EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1;
    END;
    BEGIN
      DELETE FROM public.org_overview_seen;
      RAISE EXCEPTION 'CHECK FAILED: % deleted', r;
    EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1;
    END;
    RESET ROLE;
  END LOOP;
  IF denied <> 6 THEN RAISE EXCEPTION 'CHECK FAILED: expected 6 denials, got %', denied; END IF;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM count(*) FROM public.org_overview_seen;
    RAISE EXCEPTION 'CHECK FAILED: anon read';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END $$;

-- Cascade: org A goes, org B's marks stay.
DELETE FROM public.organizations WHERE id = :LA;
SELECT public.check_eq('deleting org A removes its marks', (SELECT count(*) FROM public.org_overview_seen WHERE org_id = :LA), 0::bigint);
SELECT public.check_eq('and only its marks', (SELECT count(*) FROM public.org_overview_seen WHERE org_id = :LB), 1::bigint);
