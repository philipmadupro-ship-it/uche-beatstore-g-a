-- Behaviour checks for 152_labelos_creative_direction.sql (LABEL-26), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- What is proven, as `authenticated` with each member's own JWT claims (the
-- way PostgREST reads) — never only as the service role:
--   - both tables: org-only (no user_id), RLS on, one SELECT policy, no write
--     policy, and nothing writes through the API roles;
--   - integrity: the artist is a contact of the row's own org; a track
--     reference points at a track of that org; a file reference at a visual,
--     non-restricted file of that org; the kind carries exactly its pointer;
--     a link is https; the org and artist never change;
--   - THE RULE: an INTERNAL reference is read by the team (owner / admin /
--     member, in scope) and NEVER by a member whose role is `artist` — also
--     when abilities were switched on for them — nor by another org, an
--     external project member, a stranger or the producer; an artist-visible
--     reference is read by the artist of that contact only;
--   - artist scope: a member limited to some artists reads only those
--     artists' direction and references;
--   - the policies call no per-row SECURITY DEFINER helper (R-08): they plan
--     as hashed subplans;
--   - leaving the org ends reading; deleting the contact / track / file
--     deletes the references.
--
-- Cast (seed: producer P):
--   label L : owner O; AR (A&R, whole org); SC (A&R scoped to artist C2);
--             ART (roster artist C1 Nova, role artist, with a business.read.internal
--             grant as a stand-in for "abilities switched on"); ART2 (roster
--             artist C2 Kilo); MK (marketing, whole org)
--   label L2: owner X.   OUT is a member of nothing.   EXT: external editor on LP1.
--   L : LP1 = Nova's project (artwork F1, contract F2, session F3), LP2 = Kilo's Inbox.
--       Songs S1 in LP1, S2 in LP2.   L2: XS1, XF1 (artwork on XP1).

\set P    '''0b0e1a57-0000-4000-8000-000000000001'''
\set O    '''a1520000-0000-4000-8000-000000000001'''
\set AR   '''a1520000-0000-4000-8000-000000000002'''
\set SC   '''a1520000-0000-4000-8000-000000000003'''
\set ART  '''a1520000-0000-4000-8000-000000000004'''
\set ART2 '''a1520000-0000-4000-8000-000000000005'''
\set X    '''a1520000-0000-4000-8000-000000000006'''
\set OUT  '''a1520000-0000-4000-8000-000000000007'''
\set MK   '''a1520000-0000-4000-8000-000000000008'''
\set EXT  '''a1520000-0000-4000-8000-000000000009'''
\set L    '''b1520000-0000-4000-8000-000000000001'''
\set L2   '''b1520000-0000-4000-8000-000000000002'''
\set C1   '''c1520000-0000-4000-8000-0000000000c1'''
\set C2   '''c1520000-0000-4000-8000-0000000000c2'''
\set CX   '''c1520000-0000-4000-8000-0000000000c3'''
\set LP1  '''d1520000-0000-4000-8000-000000000011'''
\set LP2  '''d1520000-0000-4000-8000-000000000012'''
\set XP1  '''d1520000-0000-4000-8000-000000000021'''
\set S1   '''e1520000-0000-4000-8000-000000000001'''
\set S2   '''e1520000-0000-4000-8000-000000000002'''
\set XS1  '''e1520000-0000-4000-8000-000000000004'''
\set PS1  '''e1520000-0000-4000-8000-000000000006'''
\set F1   '''f1520000-0000-4000-8000-000000000001'''
\set F2   '''f1520000-0000-4000-8000-000000000002'''
\set F3   '''f1520000-0000-4000-8000-000000000003'''
\set XF1  '''f1520000-0000-4000-8000-000000000004'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o152@local.test'), (:AR, 'ar152@local.test'), (:SC, 'sc152@local.test'),
  (:ART, 'art152@local.test'), (:ART2, 'art2152@local.test'), (:MK, 'mk152@local.test'),
  (:EXT, 'ext152@local.test'), (:X, 'x152@local.test'), (:OUT, 'out152@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-152', 'label', :O),
  (:L2, 'Label L2', 'label-l2-152', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope, cap_grants) VALUES
  (:L, :O, 'owner', '{}', 'org', '{}'),
  (:L, :AR, 'member', '{a_and_r}', 'org', '{}'),
  (:L, :SC, 'member', '{a_and_r}', 'artists', '{}'),
  (:L, :ART, 'artist', '{}', 'artists', '{business.read.internal}'),
  (:L, :ART2, 'artist', '{}', 'artists', '{}'),
  (:L, :MK, 'member', '{marketing}', 'org', '{}'),
  (:L2, :X, 'owner', '{}', 'org', '{}');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova152@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo152@local.test', 'artist'),
  (:CX, NULL, :L2, 'Xen', 'xen152@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES
  (:L, :SC, :C2), (:L, :ART, :C1), (:L, :ART2, :C2);
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
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES (:PS1, :P, 'P song', 'song', 'r2://private/p1');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES (:LP1, :S1, 0), (:LP2, :S2, 0), (:XP1, :XS1, 0);
INSERT INTO public.project_assets (id, org_id, project_id, kind, sensitivity, label, file_name, url, created_by) VALUES
  (:F1, :L, :LP1, 'artwork', 'normal', 'Mood board', 'mood.png', 'r2://private/orgs/l/a/f1', :AR),
  (:F2, :L, :LP1, 'contract', 'restricted', 'Deal', 'deal.pdf', 'r2://private/orgs/l/a/f2', :AR),
  (:F3, :L, :LP1, 'session', 'normal', 'DAW session', 'x.zip', 'r2://private/orgs/l/a/f3', :AR),
  (:XF1, :L2, :XP1, 'artwork', 'normal', 'L2 art', 'x.png', 'r2://private/orgs/l2/a/f', :X);

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
-- The reference titles the caller reads, sorted.
CREATE FUNCTION public.visible_refs() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(title, ',' ORDER BY title), '') FROM public.artist_references
$$;
-- The directions the caller reads, sorted by their `sound`.
CREATE FUNCTION public.visible_directions() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(direction ->> 'sound', ',' ORDER BY direction ->> 'sound'), '') FROM public.artist_direction
$$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.rows_changed(text), public.as_user(text), public.visible_refs(), public.visible_directions()
  TO anon, authenticated, service_role;

-- ── Schema ──────────────────────────────────────────────────────────────

SELECT public.check_eq('RLS is on for both tables',
  (SELECT count(*) FROM pg_class WHERE oid IN ('public.artist_direction'::regclass, 'public.artist_references'::regclass) AND relrowsecurity), 2::bigint);
SELECT public.check_eq('each table has one policy, a SELECT — nothing writes through the API roles',
  (SELECT string_agg(policyname || '=' || permissive || '/' || cmd, ' ' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('artist_direction', 'artist_references')),
  'artist_direction_member_read=PERMISSIVE/SELECT artist_references_member_read=PERMISSIVE/SELECT');
SELECT public.check_eq('no user_id column: both are org rows',
  (SELECT count(*) FROM information_schema.columns WHERE table_name IN ('artist_direction', 'artist_references') AND column_name = 'user_id'), 0::bigint);
SELECT public.check_eq('artist_direction is keyed by the contact',
  (SELECT string_agg(a.attname, ',') FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey) WHERE i.indrelid = 'public.artist_direction'::regclass AND i.indisprimary),
  'contact_id');

-- ── Writes (as the service role: what /api/org does) ─────────────────────

INSERT INTO public.artist_direction (contact_id, org_id, direction, updated_by) VALUES
  (:C1, :L, '{"sound":"nova_sound"}', :AR),
  (:C2, :L, '{"sound":"kilo_sound"}', :AR),
  (:CX, :L2, '{"sound":"xen_sound"}', :X);
INSERT INTO public.artist_references (org_id, contact_id, kind, title, note, visibility, created_by) VALUES
  (:L, :C1, 'note', 'nova_open', 'x', 'artist', :AR),
  (:L, :C1, 'note', 'nova_internal', 'x', 'internal', :AR),
  (:L, :C2, 'note', 'kilo_open', 'x', 'artist', :AR),
  (:L, :C2, 'note', 'kilo_internal', 'x', 'internal', :AR),
  (:L2, :CX, 'note', 'xen_open', 'x', 'artist', :X);
INSERT INTO public.artist_references (org_id, contact_id, kind, title, url, visibility, created_by) VALUES
  (:L, :C1, 'link', 'nova_link', 'https://open.spotify.com/x', 'artist', :AR);
INSERT INTO public.artist_references (org_id, contact_id, kind, title, track_id, visibility, created_by) VALUES
  (:L, :C1, 'track', 'nova_track', :S1, 'internal', :AR);
INSERT INTO public.artist_references (org_id, contact_id, kind, title, asset_id, visibility, created_by) VALUES
  (:L, :C1, 'file', 'nova_file', :F1, 'artist', :AR);

-- ── Integrity ───────────────────────────────────────────────────────────

SELECT public.check_raises('an unknown kind is refused',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title, note) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c1', 'wiki', 'x', 'y')$$, 'artist_references_kind_check');
SELECT public.check_raises('an unknown visibility is refused',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title, note, visibility) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c1', 'note', 'x', 'y', 'friends')$$, 'artist_references_visibility_check');
SELECT public.check_raises('an empty title is refused',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title, note) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c1', 'note', '  ', 'y')$$, 'artist_references_title_check');
SELECT public.check_raises('a link must be https',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title, url) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c1', 'link', 'x', 'http://a.com')$$, 'artist_references_url_check');
SELECT public.check_raises('javascript: is not a link',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title, url) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c1', 'link', 'x', 'javascript:alert(1)')$$, 'artist_references_url_check');
SELECT public.check_raises('a track reference carries a track',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c1', 'track', 'x')$$, 'artist_references_shape');
SELECT public.check_raises('a reference carries only its own pointer',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title, url, track_id) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c1', 'link', 'x', 'https://a.com', 'e1520000-0000-4000-8000-000000000001')$$, 'artist_references_shape');
SELECT public.check_raises('a note carries a note',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c1', 'note', 'x')$$, 'artist_references_shape');
SELECT public.check_raises('an artist of another org is refused',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title, note) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c3', 'note', 'x', 'y')$$, 'same organization');
SELECT public.check_raises('a direction under the wrong org is refused',
  $$INSERT INTO public.artist_direction (contact_id, org_id, direction) VALUES ('c1520000-0000-4000-8000-0000000000c3', 'b1520000-0000-4000-8000-000000000001', '{}')$$, 'duplicate key|same organization');
SELECT public.check_raises('a track of another org is refused',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title, track_id) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c1', 'track', 'x', 'e1520000-0000-4000-8000-000000000004')$$, 'same organization');
SELECT public.check_raises('a producer track is refused',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title, track_id) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c1', 'track', 'x', 'e1520000-0000-4000-8000-000000000006')$$, 'same organization');
SELECT public.check_raises('a restricted file (a contract) is refused',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title, asset_id) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c1', 'file', 'x', 'f1520000-0000-4000-8000-000000000002')$$, 'visible artwork');
SELECT public.check_raises('a working file (a DAW session) is refused',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title, asset_id) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c1', 'file', 'x', 'f1520000-0000-4000-8000-000000000003')$$, 'visible artwork');
SELECT public.check_raises('a file of another org is refused',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title, asset_id) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c1', 'file', 'x', 'f1520000-0000-4000-8000-000000000004')$$, 'visible artwork');
SELECT public.check_raises('a reference never moves to another artist',
  $$UPDATE public.artist_references SET contact_id = 'c1520000-0000-4000-8000-0000000000c2' WHERE title = 'nova_open'$$, 'never change');
SELECT public.check_raises('a direction document must be an object',
  $$UPDATE public.artist_direction SET direction = '[]' WHERE contact_id = 'c1520000-0000-4000-8000-0000000000c1'$$, 'artist_direction_is_object');

-- ── Reads, as members, with their own claims ────────────────────────────

SET ROLE authenticated;

SELECT public.as_user(:O);
SELECT public.check_eq('owner: every reference of L, internal ones included, none of L2''s',
  public.visible_refs(), 'kilo_internal,kilo_open,nova_file,nova_internal,nova_link,nova_open,nova_track');
SELECT public.check_eq('owner: both directions of L, not L2''s', public.visible_directions(), 'kilo_sound,nova_sound');

SELECT public.as_user(:AR);
SELECT public.check_eq('A&R (whole org): the team reads internal references too',
  public.visible_refs(), 'kilo_internal,kilo_open,nova_file,nova_internal,nova_link,nova_open,nova_track');

SELECT public.as_user(:MK);
SELECT public.check_eq('marketing (catalog.read, a team member): reads the references of the whole org',
  public.visible_refs(), 'kilo_internal,kilo_open,nova_file,nova_internal,nova_link,nova_open,nova_track');

SELECT public.as_user(:SC);
SELECT public.check_eq('A&R scoped to Kilo: Kilo''s references only (internal included)', public.visible_refs(), 'kilo_internal,kilo_open');
SELECT public.check_eq('… and only Kilo''s direction', public.visible_directions(), 'kilo_sound');

SELECT public.as_user(:ART);
SELECT public.check_eq('THE RULE: roster artist Nova reads her artist-visible references and NONE of the internal ones',
  public.visible_refs(), 'nova_file,nova_link,nova_open');
SELECT public.check_eq('… not even by asking for the internal ones directly',
  (SELECT count(*) FROM public.artist_references WHERE visibility = 'internal'), 0::bigint);
SELECT public.check_eq('… not by title, not by id, not by kind',
  (SELECT count(*) FROM public.artist_references WHERE title IN ('nova_internal', 'nova_track', 'kilo_internal') OR kind = 'track'), 0::bigint);
SELECT public.check_eq('… abilities switched on for her (business.read.internal) do not change it',
  (SELECT count(*) FROM public.artist_references WHERE title = 'nova_internal'), 0::bigint);
SELECT public.check_eq('… she reads her own direction and not Kilo''s', public.visible_directions(), 'nova_sound');

SELECT public.as_user(:ART2);
SELECT public.check_eq('another roster artist: only her own artist-visible reference', public.visible_refs(), 'kilo_open');

SELECT public.as_user(:EXT);
SELECT public.check_eq('an external project member (editor on LP1) reads no reference and no direction',
  public.visible_refs() || '|' || public.visible_directions(), '|');

SELECT public.as_user(:X);
SELECT public.check_eq('L2''s owner: only L2''s reference and direction',
  public.visible_refs() || '|' || public.visible_directions(), 'xen_open|xen_sound');
SELECT public.as_user(:OUT);
SELECT public.check_eq('a user in no org: nothing', public.visible_refs() || public.visible_directions(), '');
SELECT public.as_user(:P);
SELECT public.check_eq('the producer, member of neither: nothing', public.visible_refs() || public.visible_directions(), '');

-- Nothing writes through the API roles.
SELECT public.as_user(:AR);
SELECT public.check_raises('a member cannot insert a reference through the API roles',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title, note) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c1', 'note', 'sneaky', 'x')$$,
  'written through /api/org only|row-level security|permission denied');
SELECT public.check_eq('… nor update one', public.rows_changed($$UPDATE public.artist_references SET title = 'x' WHERE title = 'nova_open'$$), 0);
SELECT public.check_eq('… nor delete one', public.rows_changed($$DELETE FROM public.artist_references WHERE title = 'nova_open'$$), 0);
SELECT public.check_eq('… nor write a direction',
  public.rows_changed($$UPDATE public.artist_direction SET direction = '{"sound":"x"}' WHERE contact_id = 'c1520000-0000-4000-8000-0000000000c1'$$), 0);
SELECT public.as_user(:ART);
SELECT public.check_raises('the roster artist neither: no direct insert of an internal reference',
  $$INSERT INTO public.artist_references (org_id, contact_id, kind, title, note, visibility) VALUES ('b1520000-0000-4000-8000-000000000001', 'c1520000-0000-4000-8000-0000000000c1', 'note', 'forged', 'x', 'internal')$$,
  'written through /api/org only|row-level security|permission denied');
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon: nothing, and no permission error', public.visible_refs() || public.visible_directions(), '');
RESET ROLE;

SELECT public.check_eq('the failed writes changed nothing', (SELECT count(*) FROM public.artist_references), 8::bigint);

-- ── R-08: the policies plan as hashed subplans, not per-row calls ───────

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
GRANT EXECUTE ON FUNCTION public.plan_filters(text) TO authenticated;

SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('the references read plans its tests as hashed subplans',
  public.plan_filters('SELECT * FROM public.artist_references') ~ 'hashed SubPlan', true);
SELECT public.check_eq('… and no correlated (per-row) SubPlan or SECURITY DEFINER call remains in the filter',
  public.plan_filters('SELECT * FROM public.artist_references') ~ '(?<!hashed )SubPlan|can_see_org_|has_org_cap|can_see_artist', false);
SELECT public.check_eq('the direction read plans as hashed subplans too',
  public.plan_filters('SELECT * FROM public.artist_direction') ~ 'hashed SubPlan', true);
SELECT public.check_eq('… with no per-row call',
  public.plan_filters('SELECT * FROM public.artist_direction') ~ '(?<!hashed )SubPlan|can_see_org_|has_org_cap|can_see_artist', false);
RESET ROLE;

-- ── Leaving, and cascades ───────────────────────────────────────────────

DELETE FROM public.org_members WHERE org_id = :L AND user_id = :AR;
SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('a removed member reads nothing of the org', public.visible_refs() || public.visible_directions(), '');
RESET ROLE;

DELETE FROM public.tracks WHERE id = :S1;
SELECT public.check_eq('deleting a track deletes the references to it',
  (SELECT count(*) FROM public.artist_references WHERE title = 'nova_track'), 0::bigint);
DELETE FROM public.project_assets WHERE id = :F1;
SELECT public.check_eq('deleting a file deletes the references to it',
  (SELECT count(*) FROM public.artist_references WHERE title = 'nova_file'), 0::bigint);
DELETE FROM public.contacts WHERE id = :C1;
SELECT public.check_eq('deleting the artist deletes their direction and references',
  (SELECT count(*) FROM public.artist_references WHERE contact_id = 'c1520000-0000-4000-8000-0000000000c1') + (SELECT count(*) FROM public.artist_direction WHERE contact_id = 'c1520000-0000-4000-8000-0000000000c1'), 0::bigint);
DELETE FROM public.organizations WHERE id = :L2;
SELECT public.check_eq('deleting an org deletes its direction and references',
  (SELECT count(*) FROM public.artist_references WHERE title = 'xen_open') + (SELECT count(*) FROM public.artist_direction WHERE contact_id = 'c1520000-0000-4000-8000-0000000000c3'), 0::bigint);
