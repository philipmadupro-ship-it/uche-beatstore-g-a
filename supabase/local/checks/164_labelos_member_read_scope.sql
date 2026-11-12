-- Behaviour checks for 164_labelos_member_read_scope.sql (LABEL-43, review
-- G1 F1), run by scripts/local-db/check.sh (npm run db:local:check) in its own
-- copy of the throwaway database. Every check RAISEs on failure; psql stops at
-- the first.
--
-- What is proven, as `authenticated` with each person's own JWT claims (the
-- way PostgREST reads) and as `anon` — the SQL twin of `mayListMember`
-- (lib/labelos/artist-scope.ts):
--   - THE RULE: a roster artist reads the staff and themselves, never another
--     artist of the label — not their membership row, not their profile
--     (name, last_seen_overview_at);
--   - staff limited to some artists read the staff and the artist logins of
--     THEIR artists only; with an empty list, the staff only;
--   - owners, admins and whole-org staff read everyone of their org;
--   - nobody reads another org's members; a soft-deleted org shows nothing,
--     not even the caller's own row; an outsider and anon read nothing;
--   - the same person is judged per org (a roster artist in one org who is
--     staff in another sees that other org whole);
--   - a profile is visible to its user even with no org;
--   - both policies plan as ONE hashed subplan, no per-row SECURITY DEFINER
--     call and no correlated SubPlan (R-08), unlike 136's org_role(org_id).
--
-- Against 136's policies (before 164) the first "THE RULE" check fails: the
-- roster artist reads every member of the label.
--
-- Cast: label L: owner O, admin D, AR (A&R, whole org), MK (marketing, whole
--   org), SC (A&R limited to Kilo), NS (A&R limited to nobody), ART1 (roster
--   artist, Nova), ART2 (roster artist, Kilo), ART3 (roster artist, Nova AND
--   Juno — two contacts).
--   label L2: owner X, ART1 as whole-org staff (member, marketing).
--   label L3 (soft-deleted): owner ART2, member AR.
--   OUT is a member of nothing; LONE has a profile and no org.

\set O    '''a1640000-0000-4000-8000-000000000001'''
\set D    '''a1640000-0000-4000-8000-000000000002'''
\set AR   '''a1640000-0000-4000-8000-000000000003'''
\set MK   '''a1640000-0000-4000-8000-000000000004'''
\set SC   '''a1640000-0000-4000-8000-000000000005'''
\set NS   '''a1640000-0000-4000-8000-000000000006'''
\set ART1 '''a1640000-0000-4000-8000-000000000007'''
\set ART2 '''a1640000-0000-4000-8000-000000000008'''
\set ART3 '''a1640000-0000-4000-8000-000000000009'''
\set X    '''a1640000-0000-4000-8000-00000000000a'''
\set OUT  '''a1640000-0000-4000-8000-00000000000b'''
\set LONE '''a1640000-0000-4000-8000-00000000000c'''
\set L    '''b1640000-0000-4000-8000-000000000001'''
\set L2   '''b1640000-0000-4000-8000-000000000002'''
\set L3   '''b1640000-0000-4000-8000-000000000003'''
\set C1   '''c1640000-0000-4000-8000-0000000000c1'''
\set C2   '''c1640000-0000-4000-8000-0000000000c2'''
\set C3   '''c1640000-0000-4000-8000-0000000000c3'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o164@local.test'), (:D, 'd164@local.test'), (:AR, 'ar164@local.test'), (:MK, 'mk164@local.test'),
  (:SC, 'sc164@local.test'), (:NS, 'ns164@local.test'), (:ART1, 'art1164@local.test'), (:ART2, 'art2164@local.test'),
  (:ART3, 'art3164@local.test'), (:X, 'x164@local.test'), (:OUT, 'out164@local.test'), (:LONE, 'lone164@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-164', 'label', :O),
  (:L2, 'Label L2', 'label-l2-164', 'label', :X),
  (:L3, 'Label L3', 'label-l3-164', 'label', :ART2);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :D, 'admin', '{}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org'),
  (:L, :MK, 'member', '{marketing}', 'org'),
  (:L, :SC, 'member', '{a_and_r}', 'artists'),
  (:L, :NS, 'member', '{a_and_r}', 'artists'),
  (:L, :ART1, 'artist', '{}', 'artists'),
  (:L, :ART2, 'artist', '{}', 'artists'),
  (:L, :ART3, 'artist', '{}', 'artists'),
  (:L2, :X, 'owner', '{}', 'org'),
  (:L2, :ART1, 'member', '{marketing}', 'org'),
  (:L3, :ART2, 'owner', '{}', 'org'),
  (:L3, :AR, 'member', '{a_and_r}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova164@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo164@local.test', 'artist'),
  (:C3, NULL, :L, 'Juno', 'juno164@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES
  (:L, :SC, :C2),
  (:L, :ART1, :C1), (:L, :ART2, :C2), (:L, :ART3, :C1), (:L, :ART3, :C3);
UPDATE public.organizations SET deleted_at = now() WHERE id = :L3;
INSERT INTO public.user_profiles (user_id, display_name, last_seen_overview_at)
SELECT u.id, n.name, now()
FROM auth.users u
JOIN (VALUES (:O, 'O'), (:D, 'D'), (:AR, 'AR'), (:MK, 'MK'), (:SC, 'SC'), (:NS, 'NS'), (:ART1, 'ART1'), (:ART2, 'ART2'),
             (:ART3, 'ART3'), (:X, 'X'), (:OUT, 'OUT'), (:LONE, 'LONE')) AS n(id, name) ON n.id::uuid = u.id;

-- Names for the assertions, readable by everyone (not a policy-protected table).
CREATE TABLE public.chk_who (id uuid PRIMARY KEY, name text NOT NULL);
GRANT SELECT ON public.chk_who TO anon, authenticated, service_role;
INSERT INTO public.chk_who SELECT user_id, display_name FROM public.user_profiles WHERE display_name IS NOT NULL;
CREATE TABLE public.chk_org (id uuid PRIMARY KEY, name text NOT NULL);
GRANT SELECT ON public.chk_org TO anon, authenticated, service_role;
INSERT INTO public.chk_org VALUES (:L, 'L'), (:L2, 'L2'), (:L3, 'L3');

CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;
CREATE FUNCTION public.as_user(p_user text) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
-- The membership rows the caller reads, as "org:name", sorted.
CREATE FUNCTION public.visible_members() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(o.name || ':' || w.name, ',' ORDER BY o.name, w.name), '')
  FROM public.org_members m JOIN public.chk_who w ON w.id = m.user_id JOIN public.chk_org o ON o.id = m.org_id
$$;
-- The profiles the caller reads, by display name, sorted.
CREATE FUNCTION public.visible_profiles() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(display_name, ',' ORDER BY display_name), '') FROM public.user_profiles
$$;
CREATE FUNCTION public.plan_filters(q text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r text; filters text := '';
BEGIN
  FOR r IN EXECUTE 'EXPLAIN (COSTS OFF) ' || q LOOP
    -- Only the scan of the table itself (the first Filter): the lines below it
    -- belong to the subplans' own scans.
    IF r ~ 'Filter:' THEN filters := r; EXIT; END IF;
  END LOOP;
  RETURN filters;
END $$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.as_user(text),
  public.visible_members(), public.visible_profiles(), public.plan_filters(text) TO anon, authenticated, service_role;

\set STAFF_L '''L:AR,L:D,L:MK,L:NS,L:O,L:SC'''

SET ROLE authenticated;

-- ── THE RULE: a roster artist ────────────────────────────────────────────

SELECT public.as_user(:ART2);
SELECT public.check_eq('THE RULE: roster artist Kilo reads the staff and herself — no other artist of the label (and nothing of her deleted org L3)',
  public.visible_members(), 'L:AR,L:ART2,L:D,L:MK,L:NS,L:O,L:SC');
SELECT public.check_eq('… not by asking for the artists directly',
  (SELECT count(*) FROM public.org_members WHERE role = 'artist' AND user_id <> :ART2::uuid), 0::bigint);
SELECT public.check_eq('… nor their profiles (name, last_seen_overview_at)', public.visible_profiles(), 'AR,ART2,D,MK,NS,O,SC');
SELECT public.check_eq('… nor by id',
  (SELECT count(*) FROM public.user_profiles WHERE user_id IN (:ART1::uuid, :ART3::uuid)), 0::bigint);

SELECT public.as_user(:ART3);
SELECT public.check_eq('roster artist with two contacts (Nova + Juno): the staff and himself, not Nova''s other login',
  public.visible_members(), 'L:AR,L:ART3,L:D,L:MK,L:NS,L:O,L:SC');

-- The same person, judged per org: an artist in L, whole-org staff in L2.
SELECT public.as_user(:ART1);
SELECT public.check_eq('ART1: in L the staff and herself; in L2 (where she is staff) everyone',
  public.visible_members(), 'L:AR,L:ART1,L:D,L:MK,L:NS,L:O,L:SC,L2:ART1,L2:X');
SELECT public.check_eq('… profiles: the staff of L, X, herself — not ART2 / ART3', public.visible_profiles(), 'AR,ART1,D,MK,NS,O,SC,X');

-- ── Staff limited to some artists ────────────────────────────────────────

SELECT public.as_user(:SC);
SELECT public.check_eq('A&R limited to Kilo: the staff and Kilo''s login only',
  public.visible_members(), 'L:AR,L:ART2,L:D,L:MK,L:NS,L:O,L:SC');
SELECT public.check_eq('… and those profiles', public.visible_profiles(), 'AR,ART2,D,MK,NS,O,SC');

SELECT public.as_user(:NS);
SELECT public.check_eq('A&R limited to nobody: the staff only', public.visible_members(), :STAFF_L);

-- ── Whole-org readers ────────────────────────────────────────────────────

SELECT public.as_user(:O);
SELECT public.check_eq('owner: everyone of L, nothing of L2', public.visible_members(),
  'L:AR,L:ART1,L:ART2,L:ART3,L:D,L:MK,L:NS,L:O,L:SC');
SELECT public.as_user(:D);
SELECT public.check_eq('admin: everyone of L', public.visible_members(),
  'L:AR,L:ART1,L:ART2,L:ART3,L:D,L:MK,L:NS,L:O,L:SC');
SELECT public.as_user(:MK);
SELECT public.check_eq('marketing (whole org): everyone of L', public.visible_members(),
  'L:AR,L:ART1,L:ART2,L:ART3,L:D,L:MK,L:NS,L:O,L:SC');
SELECT public.check_eq('… and their profiles, nobody outside L', public.visible_profiles(), 'AR,ART1,ART2,ART3,D,MK,NS,O,SC');
SELECT public.as_user(:AR);
SELECT public.check_eq('A&R (whole org in L, member of the deleted L3): everyone of L, nothing of L3',
  public.visible_members(), 'L:AR,L:ART1,L:ART2,L:ART3,L:D,L:MK,L:NS,L:O,L:SC');

-- ── Other orgs, outsiders, anon ──────────────────────────────────────────

SELECT public.as_user(:X);
SELECT public.check_eq('L2''s owner: only L2', public.visible_members(), 'L2:ART1,L2:X');
SELECT public.check_eq('… and only L2''s profiles', public.visible_profiles(), 'ART1,X');
SELECT public.as_user(:OUT);
SELECT public.check_eq('an outsider: no members; their own profile only', public.visible_members() || '|' || public.visible_profiles(), '|OUT');
SELECT public.as_user(:LONE);
SELECT public.check_eq('a person in no org still reads their own profile', public.visible_profiles(), 'LONE');
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon: nothing, and no permission error', public.visible_members() || '|' || public.visible_profiles(), '|');
RESET ROLE;

-- ── A change applies on the next read ────────────────────────────────────

DELETE FROM public.member_artist_scopes WHERE user_id = :SC;
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :SC, :C3);
SET ROLE authenticated;
SELECT public.as_user(:SC);
SELECT public.check_eq('SC moved from Kilo to Juno: now sees ART3 (Juno''s login), no longer ART2',
  public.visible_members(), 'L:AR,L:ART3,L:D,L:MK,L:NS,L:O,L:SC');
RESET ROLE;
UPDATE public.org_members SET scope = 'org' WHERE org_id = :L AND user_id = :SC;
SET ROLE authenticated;
SELECT public.as_user(:SC);
SELECT public.check_eq('… and made whole-org: everyone', public.visible_members(),
  'L:AR,L:ART1,L:ART2,L:ART3,L:D,L:MK,L:NS,L:O,L:SC');
RESET ROLE;

-- ── R-08: one hashed subplan, no per-row call ────────────────────────────

SET ROLE authenticated;
SELECT public.as_user(:ART2);
SELECT public.check_eq('org_members plans its policy as a hashed subplan',
  public.plan_filters('SELECT user_id FROM public.org_members') ~ 'hashed SubPlan', true);
SELECT public.check_eq('… with no correlated (per-row) SubPlan and no per-row helper call in the filter',
  public.plan_filters('SELECT user_id FROM public.org_members') ~ '(?<!hashed )SubPlan|org_role|has_org_cap|can_see_', false);
SELECT public.check_eq('user_profiles plans as a hashed subplan too',
  public.plan_filters('SELECT user_id FROM public.user_profiles') ~ 'hashed SubPlan', true);
SELECT public.check_eq('… with no correlated SubPlan and no per-row helper call',
  public.plan_filters('SELECT user_id FROM public.user_profiles') ~ '(?<!hashed )SubPlan|org_role|has_org_cap|can_see_', false);
RESET ROLE;

SELECT public.check_eq('both helpers are postgres-owned, SECURITY DEFINER, pinned search_path, and take no argument',
  (SELECT count(*) FILTER (WHERE pg_get_userbyid(proowner) = 'postgres' AND prosecdef AND proconfig @> ARRAY['search_path=public'] AND pronargs = 0)
   FROM pg_proc WHERE proname IN ('labelos_visible_members', 'labelos_my_live_orgs') AND pronamespace = 'public'::regnamespace), 2::bigint);

-- The own-row fast path keeps 136's rule: a soft-deleted org's row is hidden even from its own member.
SET ROLE authenticated;
SELECT public.as_user(:ART2);
SELECT public.check_eq('own rows: only the live org''s (L), never the deleted L3''s',
  (SELECT string_agg(o.name, ',' ORDER BY o.name) FROM public.org_members m JOIN public.chk_org o ON o.id = m.org_id WHERE m.user_id = :ART2::uuid), 'L');
RESET ROLE;
