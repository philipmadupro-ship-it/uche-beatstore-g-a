-- Behaviour checks for 171_labelos_departments_capabilities.sql (LABEL-49),
-- run by scripts/local-db/check.sh (npm run db:local:check) in its own copy of
-- the throwaway database. Every check RAISEs on failure.
--
-- scripts/local-db/capability-parity.ts already compares the real has_org_cap
-- with capabilitiesFor() over every fixture; this file states the LABEL-49
-- rules themselves, on each member's own JWT, so a parity bug that moved both
-- sides at once would still be caught here.
--
-- Cast (label L, artist org A, producer org P, label L2 licensed for contracts only):
--   OW owner of L    FIN finance   PR pr   EX executive   AD artistic_director
--   CT contracts     LEG legal     OPS operations (finance.approve switched on)
--   ART roster artist of L, holding the department functions AND every
--       department capability as a grant — none of it may count
--   AM a member of A with pr + finance + contracts + executive (A does not
--       offer executive)
--   PM a member of P with finance (P does not offer it)
--   O2 owner of L2

\set OW  '''a1710000-0000-4000-8000-000000000001'''
\set FIN '''a1710000-0000-4000-8000-000000000002'''
\set PR  '''a1710000-0000-4000-8000-000000000003'''
\set EX  '''a1710000-0000-4000-8000-000000000004'''
\set AD  '''a1710000-0000-4000-8000-000000000005'''
\set CT  '''a1710000-0000-4000-8000-000000000006'''
\set LEG '''a1710000-0000-4000-8000-000000000007'''
\set OPS '''a1710000-0000-4000-8000-000000000008'''
\set ART '''a1710000-0000-4000-8000-000000000009'''
\set AM  '''a1710000-0000-4000-8000-00000000000a'''
\set PM  '''a1710000-0000-4000-8000-00000000000b'''
\set O2  '''a1710000-0000-4000-8000-00000000000c'''
\set L   '''b1710000-0000-4000-8000-000000000001'''
\set A   '''b1710000-0000-4000-8000-000000000002'''
\set P   '''b1710000-0000-4000-8000-000000000003'''
\set L2  '''b1710000-0000-4000-8000-000000000004'''

INSERT INTO auth.users (id) VALUES
  (:OW), (:FIN), (:PR), (:EX), (:AD), (:CT), (:LEG), (:OPS), (:ART), (:AM), (:PM), (:O2);
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label', 'label-171', 'label', :OW),
  (:A, 'Artist', 'artist-171', 'artist', :AM),
  (:P, 'Studio', 'studio-171', 'producer', :PM),
  (:L2, 'Label Two', 'label-two-171', 'label', :O2);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope, cap_grants) VALUES
  (:L, :OW, 'owner', '{}', 'org', '{}'),
  (:L, :FIN, 'member', '{finance}', 'org', '{}'),
  (:L, :PR, 'member', '{pr}', 'org', '{}'),
  (:L, :EX, 'member', '{executive}', 'org', '{}'),
  (:L, :AD, 'member', '{artistic_director}', 'org', '{}'),
  (:L, :CT, 'member', '{contracts}', 'org', '{}'),
  (:L, :LEG, 'member', '{legal}', 'org', '{}'),
  (:L, :OPS, 'member', '{operations}', 'org', '{finance.approve}'),
  (:L, :ART, 'artist', '{finance,executive,contracts}', 'artists',
    '{finance.read,finance.write,finance.approve,pr.read,pr.write,exec.read,creative.read,creative.approve,contracts.read,contracts.write,contracts.sign}'),
  (:A, :AM, 'member', '{pr,finance,contracts,executive}', 'org', '{}'),
  (:P, :PM, 'member', '{finance}', 'org', '{}'),
  (:L2, :O2, 'owner', '{}', 'org', '{}');
INSERT INTO public.org_entitlements (org_id, modules) VALUES (:L2, '{contracts}');

CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement) TO anon, authenticated;

-- What this member holds of the LABEL-49 vocabulary in this org, on their own JWT.
CREATE FUNCTION public.dept_caps(p_org uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(c, ',' ORDER BY c), '')
  FROM unnest(ARRAY[
    'finance.read', 'finance.write', 'finance.approve', 'pr.read', 'pr.write', 'exec.read',
    'creative.read', 'creative.approve', 'contracts.read', 'contracts.write', 'contracts.sign'
  ]) AS c
  WHERE public.has_org_cap(p_org, c)
$$;
GRANT EXECUTE ON FUNCTION public.dept_caps(uuid) TO anon, authenticated;

CREATE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, false);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO anon, authenticated;

SET ROLE authenticated;

SELECT pg_temp.as_user('a1710000-0000-4000-8000-000000000001');
SELECT public.check_eq('owner holds every department capability', public.dept_caps(:L),
  'contracts.read,contracts.sign,contracts.write,creative.approve,creative.read,exec.read,finance.approve,finance.read,finance.write,pr.read,pr.write');

SELECT pg_temp.as_user('a1710000-0000-4000-8000-000000000002');
SELECT public.check_eq('finance: read + write, never approve', public.dept_caps(:L), 'finance.read,finance.write');
SELECT public.check_eq('finance reads the catalogue', public.has_org_cap(:L, 'catalog.read'), true);
SELECT public.check_eq('finance hears nothing', public.has_org_cap(:L, 'audio.finished'), false);

SELECT pg_temp.as_user('a1710000-0000-4000-8000-000000000003');
SELECT public.check_eq('pr: read + write', public.dept_caps(:L), 'pr.read,pr.write');
SELECT public.check_eq('pr hears finished music only (D4)', public.has_org_cap(:L, 'audio.finished')::text || public.has_org_cap(:L, 'audio.working')::text, 'truefalse');

SELECT pg_temp.as_user('a1710000-0000-4000-8000-000000000004');
SELECT public.check_eq('executive reads every department', public.dept_caps(:L),
  'contracts.read,creative.read,exec.read,finance.read,pr.read');
SELECT public.check_eq('executive writes nothing', (
  SELECT count(*) FROM unnest(ARRAY['catalog.write','rights.write','release.write','tasks.write','share.external',
    'finance.write','pr.write','contracts.write','creative.approve','audio.working']) c
  WHERE public.has_org_cap('b1710000-0000-4000-8000-000000000001', c)), 0::bigint);

SELECT pg_temp.as_user('a1710000-0000-4000-8000-000000000005');
SELECT public.check_eq('artistic director: creative read + approve', public.dept_caps(:L), 'creative.approve,creative.read');
SELECT public.check_eq('artistic director hears working material', public.has_org_cap(:L, 'audio.working'), true);

SELECT pg_temp.as_user('a1710000-0000-4000-8000-000000000006');
SELECT public.check_eq('contracts: read + write, never sign', public.dept_caps(:L), 'contracts.read,contracts.write');

SELECT pg_temp.as_user('a1710000-0000-4000-8000-000000000007');
SELECT public.check_eq('legal drafts contracts too', public.dept_caps(:L), 'contracts.read,contracts.write');

SELECT pg_temp.as_user('a1710000-0000-4000-8000-000000000008');
SELECT public.check_eq('a switched-on finance.approve brings finance.read', public.dept_caps(:L), 'finance.approve,finance.read');

SELECT pg_temp.as_user('a1710000-0000-4000-8000-000000000009');
SELECT public.check_eq('the roster artist holds none, whatever is granted', public.dept_caps(:L), '');
SELECT public.check_eq('and keeps their own catalogue', public.has_org_cap(:L, 'catalog.read'), true);

SELECT pg_temp.as_user('a1710000-0000-4000-8000-00000000000a');
SELECT public.check_eq('an artist org offers finance, pr and contracts, not executive', public.dept_caps(:A),
  'contracts.read,contracts.write,finance.read,finance.write,pr.read,pr.write');

SELECT pg_temp.as_user('a1710000-0000-4000-8000-00000000000b');
SELECT public.check_eq('the producer org does not offer finance', public.dept_caps(:P), '');

SELECT pg_temp.as_user('a1710000-0000-4000-8000-00000000000c');
SELECT public.check_eq('licensed for contracts only: the owner holds contracts.* and nothing else', public.dept_caps(:L2),
  'contracts.read,contracts.sign,contracts.write');
SELECT public.check_eq('another org''s owner holds nothing in L', public.dept_caps(:L), '');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);

SET ROLE anon;
SELECT public.check_eq('anon holds nothing', public.dept_caps('b1710000-0000-4000-8000-000000000001'), '');
RESET ROLE;
RESET request.jwt.claims;
