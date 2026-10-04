-- Behaviour checks for 145_labelos_ownerless_workspace_rows.sql, run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- Cast (seed: producer P with a creator_profiles row):
--   label L : owner O; artist C1 (Nova); project LP1 with song S1 on beat B1.
--   P : contact PC, project PP1, song PS1 on beat PB1.
--
-- The rule: an org row on project_contacts / contact_track_states /
-- artist_portals / artist_messages / song_beats has no user_id; a producer
-- row must have its owner. Cross-org refusals are 141's and stay there.

\set P   '''0b0e1a57-0000-4000-8000-000000000001'''
\set O   '''a1450000-0000-4000-8000-000000000001'''
\set L   '''b1450000-0000-4000-8000-000000000001'''
\set C1  '''c1450000-0000-4000-8000-0000000000c1'''
\set PC  '''c1450000-0000-4000-8000-0000000000c4'''
\set PP1 '''d1450000-0000-4000-8000-000000000001'''
\set LP1 '''d1450000-0000-4000-8000-000000000011'''
\set PS1 '''e1450000-0000-4000-8000-000000000001'''
\set PB1 '''e1450000-0000-4000-8000-000000000002'''
\set S1  '''e1450000-0000-4000-8000-000000000011'''
\set B1  '''e1450000-0000-4000-8000-000000000012'''

INSERT INTO auth.users (id, email) VALUES (:O, 'o145@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES (:L, 'Label L', 'label-l-145', 'label', :O);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES (:L, :O, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova145@local.test', 'artist'),
  (:PC, :P, NULL, 'P artist', 'pc145@local.test', 'artist');
INSERT INTO public.projects (id, user_id, org_id, name) VALUES (:PP1, :P, NULL, 'P project'), (:LP1, NULL, :L, 'Nova EP');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:PS1, :P, NULL, NULL, 'P song', 'song', 'r2://private/p1', NULL),
  (:PB1, :P, NULL, NULL, 'P beat', 'beat', 'r2://private/p2', NULL),
  (:S1, NULL, :L, :O, 'Nova single', 'song', 'r2://private/s1', 'inbox'),
  (:B1, NULL, :L, :O, 'Pool beat', 'beat', 'r2://private/b1', NULL);

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
CREATE FUNCTION public.check_ok(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'CHECK FAILED: % — raised "%"', label, SQLERRM;
END $$;
CREATE FUNCTION public.as_user(p_user text) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.check_ok(text, text), public.as_user(text) TO anon, authenticated, service_role;

-- ── Org rows: ownerless accepted, owned refused ─────────────────────────

SELECT public.check_ok('project_contacts: an ownerless org link',
  $$INSERT INTO public.project_contacts (user_id, project_id, contact_id) VALUES (NULL, 'd1450000-0000-4000-8000-000000000011', 'c1450000-0000-4000-8000-0000000000c1')$$);
SELECT public.check_ok('contact_track_states: an ownerless org decision',
  $$INSERT INTO public.contact_track_states (user_id, contact_id, track_id, project_id, decision) VALUES (NULL, 'c1450000-0000-4000-8000-0000000000c1', 'e1450000-0000-4000-8000-000000000011', 'd1450000-0000-4000-8000-000000000011', 'interested')$$);
SELECT public.check_ok('artist_portals: an ownerless org portal',
  $$INSERT INTO public.artist_portals (user_id, contact_id, token) VALUES (NULL, 'c1450000-0000-4000-8000-0000000000c1', 'l-portal-145')$$);
SELECT public.check_ok('artist_messages: an ownerless org message',
  $$INSERT INTO public.artist_messages (user_id, contact_id, project_id, author, body) VALUES (NULL, 'c1450000-0000-4000-8000-0000000000c1', 'd1450000-0000-4000-8000-000000000011', 'producer', 'hi')$$);
SELECT public.check_ok('song_beats: an ownerless org song beat',
  $$INSERT INTO public.song_beats (song_track_id, beat_track_id, user_id) VALUES ('e1450000-0000-4000-8000-000000000011', 'e1450000-0000-4000-8000-000000000012', NULL)$$);

SELECT public.check_raises('project_contacts: an org link with an owner',
  $$INSERT INTO public.project_contacts (user_id, project_id, contact_id, role) VALUES ('a1450000-0000-4000-8000-000000000001', 'd1450000-0000-4000-8000-000000000011', 'c1450000-0000-4000-8000-0000000000c1', 'featured')$$,
  'an org row has no owner');
SELECT public.check_raises('contact_track_states: an org decision with an owner',
  $$INSERT INTO public.contact_track_states (user_id, contact_id, track_id) VALUES ('a1450000-0000-4000-8000-000000000001', 'c1450000-0000-4000-8000-0000000000c1', 'e1450000-0000-4000-8000-000000000012')$$,
  'an org row has no owner');
SELECT public.check_raises('artist_messages: an org message with an owner',
  $$INSERT INTO public.artist_messages (user_id, contact_id, author, body) VALUES ('a1450000-0000-4000-8000-000000000001', 'c1450000-0000-4000-8000-0000000000c1', 'producer', 'x')$$,
  'an org row has no owner');
SELECT public.check_raises('song_beats: an org song beat with an owner',
  $$INSERT INTO public.song_beats (song_track_id, beat_track_id, user_id, position) VALUES ('e1450000-0000-4000-8000-000000000011', 'e1450000-0000-4000-8000-000000000012', 'a1450000-0000-4000-8000-000000000001', 1)$$,
  'an org row has no owner');
SELECT public.check_raises('giving an existing org portal an owner later is refused',
  $$UPDATE public.artist_portals SET user_id = 'a1450000-0000-4000-8000-000000000001' WHERE token = 'l-portal-145'$$,
  'an org row has no owner');
SELECT public.check_raises('… and an existing org link',
  $$UPDATE public.project_contacts SET user_id = 'a1450000-0000-4000-8000-000000000001' WHERE project_id = 'd1450000-0000-4000-8000-000000000011'$$,
  'an org row has no owner');

-- ── Producer rows: owned accepted, ownerless refused ────────────────────

SELECT public.check_ok('project_contacts: a producer link with its owner',
  $$INSERT INTO public.project_contacts (user_id, project_id, contact_id) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'd1450000-0000-4000-8000-000000000001', 'c1450000-0000-4000-8000-0000000000c4')$$);
SELECT public.check_ok('song_beats: a producer song beat with its owner',
  $$INSERT INTO public.song_beats (song_track_id, beat_track_id, user_id) VALUES ('e1450000-0000-4000-8000-000000000001', 'e1450000-0000-4000-8000-000000000002', '0b0e1a57-0000-4000-8000-000000000001')$$);

SELECT public.check_raises('project_contacts: a producer link with no owner',
  $$INSERT INTO public.project_contacts (user_id, project_id, contact_id, role) VALUES (NULL, 'd1450000-0000-4000-8000-000000000001', 'c1450000-0000-4000-8000-0000000000c4', 'featured')$$,
  'is not owned by');
SELECT public.check_raises('contact_track_states: a producer decision with no owner',
  $$INSERT INTO public.contact_track_states (user_id, contact_id, track_id) VALUES (NULL, 'c1450000-0000-4000-8000-0000000000c4', 'e1450000-0000-4000-8000-000000000002')$$,
  'is not owned by');
SELECT public.check_raises('artist_portals: a producer portal with no owner',
  $$INSERT INTO public.artist_portals (user_id, contact_id, token) VALUES (NULL, 'c1450000-0000-4000-8000-0000000000c4', 'p-portal-145')$$,
  'is not owned by');
SELECT public.check_raises('artist_messages: a producer message with no owner',
  $$INSERT INTO public.artist_messages (user_id, contact_id, author, body) VALUES (NULL, 'c1450000-0000-4000-8000-0000000000c4', 'producer', 'x')$$,
  'is not owned by');
SELECT public.check_raises('song_beats: a producer song beat with no owner',
  $$INSERT INTO public.song_beats (song_track_id, beat_track_id, user_id, position) VALUES ('e1450000-0000-4000-8000-000000000001', 'e1450000-0000-4000-8000-000000000002', NULL, 1)$$,
  'is not owned by');
SELECT public.check_raises('removing the owner of a producer link later is refused',
  $$UPDATE public.project_contacts SET user_id = NULL WHERE project_id = 'd1450000-0000-4000-8000-000000000001'$$,
  'is not owned by');

-- ── Who can read them ───────────────────────────────────────────────────
-- An ownerless org row matches no owner policy: the producer, who is no
-- member of L, sees none of them.
SET ROLE authenticated;
SELECT public.as_user(:P);
SELECT public.check_eq('the producer sees no org link', (SELECT count(*) FROM public.project_contacts WHERE project_id = 'd1450000-0000-4000-8000-000000000011'), 0::bigint);
SELECT public.check_eq('… no org portal', (SELECT count(*) FROM public.artist_portals WHERE token = 'l-portal-145'), 0::bigint);
SELECT public.check_eq('… and still their own link', (SELECT count(*) FROM public.project_contacts WHERE project_id = 'd1450000-0000-4000-8000-000000000001'), 1::bigint);
SELECT public.as_user(:O);
SELECT public.check_eq('the org owner reads the org link (141 org_member_read)', (SELECT count(*) FROM public.project_contacts WHERE project_id = 'd1450000-0000-4000-8000-000000000011'), 1::bigint);
RESET ROLE;
