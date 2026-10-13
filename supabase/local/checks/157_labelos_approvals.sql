-- Behaviour checks for 157_labelos_approvals.sql (LABEL-30), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- What is proven:
--   - the table is INSERT ONLY: no UPDATE, no DELETE, no TRUNCATE for any role
--     (trigger AND privilege), created_at cannot be backdated, and the only
--     delete is the cascade of the organization / release it belongs to;
--   - the constraints: one subject (song XOR release), a song is asked only
--     for `legal`, changes_requested carries a note, a request names an
--     approver who is a member, a decision answers a request of the same
--     subject and gate;
--   - the two audit functions: request refuses a second open request, a bad
--     gate, an approver who is not a member, a foreign subject; decide links
--     the request it answers, refuses a requester approving their own request
--     unless told they are owner/admin, and refuses changes_requested with no
--     note; each writes its `activity_events` row in the same step;
--   - the change and its audit event commit together (a failing event rolls
--     the approval back);
--   - reads, as `authenticated` with each member's own claims: release.write
--     or any release.approve.<gate> + (whole org | artist scope), nobody
--     else — not the producer function, an external member, another org,
--     anon;
--   - nothing writes through the API roles; the functions are service_role
--     only;
--   - the read plans as hashed subplans, no per-row definer call (R-08).
--
-- Cast: label L: owner O; AR (A&R: release.write, approve master); LG (legal:
--   approve legal); MK (marketing: approve artwork + marketing); SC (A&R scoped
--   to Kilo); PRD (producer function, no release ability). label L2: owner X.
--   OUT is a member of nothing. EXT is an external editor.
--   L: S1 = Nova's song (LP1), S2 = Kilo's song (Inbox LP2), R1 = Nova's release
--   (LP1). L2: XS1.

\set O    '''a1570000-0000-4000-8000-000000000001'''
\set AR   '''a1570000-0000-4000-8000-000000000002'''
\set LG   '''a1570000-0000-4000-8000-000000000003'''
\set MK   '''a1570000-0000-4000-8000-000000000004'''
\set SC   '''a1570000-0000-4000-8000-000000000005'''
\set PRD  '''a1570000-0000-4000-8000-000000000006'''
\set X    '''a1570000-0000-4000-8000-000000000007'''
\set OUT  '''a1570000-0000-4000-8000-000000000008'''
\set EXT  '''a1570000-0000-4000-8000-000000000009'''
\set L    '''b1570000-0000-4000-8000-000000000001'''
\set L2   '''b1570000-0000-4000-8000-000000000002'''
\set C1   '''c1570000-0000-4000-8000-0000000000c1'''
\set C2   '''c1570000-0000-4000-8000-0000000000c2'''
\set LP1  '''d1570000-0000-4000-8000-000000000011'''
\set LP2  '''d1570000-0000-4000-8000-000000000012'''
\set XP1  '''d1570000-0000-4000-8000-000000000021'''
\set S1   '''e1570000-0000-4000-8000-000000000001'''
\set S2   '''e1570000-0000-4000-8000-000000000002'''
\set XS1  '''e1570000-0000-4000-8000-000000000003'''
\set PT   '''e1570000-0000-4000-8000-000000000004'''
\set R1   '''f1570000-0000-4000-8000-0000000000a1'''
\set R2   '''f1570000-0000-4000-8000-0000000000a2'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o157@local.test'), (:AR, 'ar157@local.test'), (:LG, 'lg157@local.test'), (:MK, 'mk157@local.test'),
  (:SC, 'sc157@local.test'), (:PRD, 'prd157@local.test'), (:X, 'x157@local.test'), (:OUT, 'out157@local.test'), (:EXT, 'ext157@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-157', 'label', :O),
  (:L2, 'Label L2', 'label-l2-157', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org'),
  (:L, :LG, 'member', '{legal}', 'org'),
  (:L, :MK, 'member', '{marketing}', 'org'),
  (:L, :SC, 'member', '{a_and_r}', 'artists'),
  (:L, :PRD, 'member', '{producer}', 'org'),
  (:L2, :X, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova157@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo157@local.test', 'artist');
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
INSERT INTO public.releases (id, org_id, project_id, contact_id, title, created_by) VALUES
  (:R1, :L, :LP1, :C1, 'Nova EP release', :O),
  (:R2, :L, :LP2, :C2, 'Kilo single', :O);

CREATE TABLE public.chk_lbl (id uuid PRIMARY KEY, name text NOT NULL);
GRANT SELECT ON public.chk_lbl TO anon, authenticated, service_role;
INSERT INTO public.chk_lbl VALUES (:S1, 'S1'), (:S2, 'S2'), (:XS1, 'XS1'), (:R1, 'R1'), (:R2, 'R2');

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
-- The approvals the caller reads, as "subject/gate/decision", sorted.
CREATE FUNCTION public.visible_approvals() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(s2.name || '/' || a.gate || '/' || a.decision, ',' ORDER BY s2.name, a.gate, a.created_at), '')
  FROM public.approvals a JOIN public.chk_lbl s2 ON s2.id = coalesce(a.song_id, a.release_id)
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
  public.rows_changed(text), public.as_user(text), public.visible_approvals(), public.plan_filters(text)
  TO anon, authenticated, service_role;

-- ── Schema ──────────────────────────────────────────────────────────────

SELECT public.check_eq('RLS is on', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.approvals'::regclass), true);
SELECT public.check_eq('ONE policy, a SELECT',
  (SELECT string_agg(policyname || '=' || permissive || '/' || cmd, ' ') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approvals'),
  'approvals_member_read=PERMISSIVE/SELECT');
SELECT public.check_eq('the guard, the truncate guard and the service-only write trigger are on',
  (SELECT string_agg(t.tgname, ',' ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid = 'public.approvals'::regclass AND NOT t.tgisinternal),
  'approvals_guard,approvals_no_truncate,labelos_org_rows_service_only');
SELECT public.check_eq('nobody holds UPDATE, DELETE or TRUNCATE on the table',
  (SELECT string_agg(r || '=' || has_table_privilege(r, 'public.approvals', 'UPDATE')::text || has_table_privilege(r, 'public.approvals', 'DELETE')::text
        || has_table_privilege(r, 'public.approvals', 'TRUNCATE')::text, ' ' ORDER BY r)
   FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r),
  'anon=falsefalsefalse authenticated=falsefalsefalse service_role=falsefalsefalse');
SELECT public.check_eq('the API roles cannot INSERT either',
  (SELECT string_agg(r || '=' || has_table_privilege(r, 'public.approvals', 'INSERT')::text, ' ' ORDER BY r) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r),
  'anon=false authenticated=false service_role=true');
SELECT public.check_eq('the functions are service_role only',
  (SELECT string_agg(p.proname || '=' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
      || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || has_function_privilege('anon', p.oid, 'EXECUTE')::text, ' ' ORDER BY p.proname)
   FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('labelos_audit_approval_request', 'labelos_audit_approval_decide')),
  'labelos_audit_approval_decide=truefalsefalse labelos_audit_approval_request=truefalsefalse');

-- ── Requests ────────────────────────────────────────────────────────────

SET ROLE service_role;
SELECT public.check_eq('AR asks LG to approve legal on S1: a requested row',
  (public.labelos_audit_approval_request(:L, :AR, 'song', :S1, 'legal', :LG, 'please look at the splits',
     jsonb_build_object('v', 1, 'gate', 'legal', 'parts', jsonb_build_object('songs', '[]'::jsonb)),
     jsonb_build_object('song_id', :S1::text, 'project_id', :LP1::text, 'artist_id', :C1::text),
     jsonb_build_object('gate', 'legal', 'blockers', 2)) -> 'approval' ->> 'decision'), 'requested');
RESET ROLE;
SELECT public.check_eq('… with its event, in the same step: audit, internal, filed under the song and the artist',
  (SELECT count(*) FROM public.activity_events WHERE verb = 'approval.requested' AND org_id = :L AND song_id = :S1 AND artist_id = :C1
     AND audit AND visibility = 'internal' AND subject_type = 'approval' AND payload ->> 'gate' = 'legal'), 1::bigint);

SET ROLE service_role;
SELECT public.check_eq('a second request while one is open is refused',
  (public.labelos_audit_approval_request(:L, :AR, 'song', :S1, 'legal', :LG, NULL, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb))::text, '{"error": "already_requested"}');
SELECT public.check_eq('a song is asked for legal only',
  (public.labelos_audit_approval_request(:L, :AR, 'song', :S2, 'artwork', :MK, NULL, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb))::text, '{"error": "bad_gate"}');
SELECT public.check_eq('an approver who is not a member is refused',
  (public.labelos_audit_approval_request(:L, :AR, 'song', :S2, 'legal', :OUT, NULL, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb))::text, '{"error": "approver_not_member"}');
SELECT public.check_eq('another organization''s song is not found',
  (public.labelos_audit_approval_request(:L, :AR, 'song', :XS1, 'legal', :LG, NULL, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb))::text, '{"error": "not_found"}');
SELECT public.check_eq('a beat is not a song',
  (public.labelos_audit_approval_request(:L, :AR, 'song', :PT, 'legal', :LG, NULL, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb))::text, '{"error": "not_found"}');
SELECT public.check_raises('a payload with a secret-looking key is refused',
  $$SELECT public.labelos_audit_approval_request('b1570000-0000-4000-8000-000000000001', 'a1570000-0000-4000-8000-000000000002', 'song', 'e1570000-0000-4000-8000-000000000002', 'legal', 'a1570000-0000-4000-8000-000000000003', NULL, '{}'::jsonb, '{}'::jsonb, '{"share_token": "x"}'::jsonb)$$,
  'secret-looking key');
RESET ROLE;
SELECT public.check_eq('the refusals wrote nothing', (SELECT count(*) FROM public.approvals), 1::bigint);

-- ── Decisions ───────────────────────────────────────────────────────────

SET ROLE service_role;
SELECT public.check_eq('changes requested with no note is refused',
  (public.labelos_audit_approval_decide(:L, :LG, 'song', :S1, 'legal', 'changes_requested', '  ', '{}'::jsonb, false, '{}'::jsonb, '{}'::jsonb))::text, '{"error": "note_required"}');
SELECT public.check_eq('an unknown decision is refused',
  (public.labelos_audit_approval_decide(:L, :LG, 'song', :S1, 'legal', 'maybe', 'x', '{}'::jsonb, false, '{}'::jsonb, '{}'::jsonb))::text, '{"error": "bad_decision"}');
SELECT public.check_eq('LG asks for changes: a changes_requested row that answers the request',
  (public.labelos_audit_approval_decide(:L, :LG, 'song', :S1, 'legal', 'changes_requested', 'Nova needs an IPI',
     '{}'::jsonb, false, jsonb_build_object('song_id', :S1::text, 'artist_id', :C1::text), '{}'::jsonb) -> 'approval' ->> 'decision'), 'changes_requested');
RESET ROLE;
SELECT public.check_eq('… linked to the request it answers',
  (SELECT d.request_id = r.id FROM public.approvals d JOIN public.approvals r ON r.decision = 'requested' AND r.song_id = d.song_id WHERE d.decision = 'changes_requested'), true);
SELECT public.check_eq('… and an approval.decided event, audit and internal',
  (SELECT count(*) FROM public.activity_events WHERE verb = 'approval.decided' AND org_id = :L AND song_id = :S1 AND audit AND visibility = 'internal'
     AND payload ->> 'decision' = 'changes_requested' AND payload ->> 'gate' = 'legal'), 1::bigint);

-- AR asks again after the changes; AR approving their own request is the self-approval rule.
SET ROLE service_role;
SELECT public.check_eq('a new request after a change request is allowed',
  (public.labelos_audit_approval_request(:L, :AR, 'song', :S1, 'legal', :AR, NULL, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb) -> 'approval' ->> 'decision'), 'requested');
SELECT public.check_eq('the requester cannot approve their own request',
  (public.labelos_audit_approval_decide(:L, :AR, 'song', :S1, 'legal', 'approved', NULL, '{}'::jsonb, false, '{}'::jsonb, '{}'::jsonb))::text, '{"error": "self_approval"}');
SELECT public.check_eq('… not even with the other fields right: nothing was written',
  (SELECT count(*) FROM public.approvals WHERE song_id = :S1), 3::bigint);
SELECT public.check_eq('an owner or admin (told so by the route) may',
  (public.labelos_audit_approval_decide(:L, :AR, 'song', :S1, 'legal', 'approved', NULL,
     jsonb_build_object('v', 1, 'gate', 'legal', 'parts', jsonb_build_object('songs', '[{"id":"x"}]'::jsonb)), true, '{}'::jsonb, '{}'::jsonb) -> 'approval' ->> 'decision'), 'approved');
SELECT public.check_eq('… and the snapshot is stored as given',
  (SELECT subject_snapshot -> 'parts' -> 'songs' -> 0 ->> 'id' FROM public.approvals WHERE song_id = :S1 AND decision = 'approved'), 'x');
-- The other member of the pair: a decision by someone else on a request is fine.
SELECT public.check_eq('LG approves a request AR made',
  (public.labelos_audit_approval_request(:L, :AR, 'song', :S2, 'legal', :LG, NULL, '{}'::jsonb, jsonb_build_object('song_id', :S2::text, 'artist_id', :C2::text), '{}'::jsonb) -> 'approval' ->> 'decision'), 'requested');
SELECT public.check_eq('… LG approves it',
  (public.labelos_audit_approval_decide(:L, :LG, 'song', :S2, 'legal', 'approved', NULL, '{}'::jsonb, false, jsonb_build_object('song_id', :S2::text, 'artist_id', :C2::text), '{}'::jsonb) -> 'approval' ->> 'decision'), 'approved');
SELECT public.check_eq('a decision with no open request is allowed and links nothing',
  (public.labelos_audit_approval_decide(:L, :LG, 'song', :S2, 'legal', 'changes_requested', 'splits moved', '{}'::jsonb, false, '{}'::jsonb, '{}'::jsonb) -> 'approval' ->> 'request_id'), NULL);

-- Releases take every gate.
SELECT public.check_eq('AR asks MK to approve the artwork of R1',
  (public.labelos_audit_approval_request(:L, :AR, 'release', :R1, 'artwork', :MK, NULL, '{}'::jsonb, jsonb_build_object('release_id', :R1::text, 'artist_id', :C1::text), '{}'::jsonb) -> 'approval' ->> 'gate'), 'artwork');
SELECT public.check_eq('a release of another organization is not found',
  (public.labelos_audit_approval_request(:L, :AR, 'release', gen_random_uuid(), 'artwork', :MK, NULL, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb))::text, '{"error": "not_found"}');
SELECT public.check_eq('Kilo''s release is asked for marketing',
  (public.labelos_audit_approval_request(:L, :AR, 'release', :R2, 'marketing', :MK, NULL, '{}'::jsonb, jsonb_build_object('release_id', :R2::text, 'artist_id', :C2::text), '{}'::jsonb) -> 'approval' ->> 'gate'), 'marketing');
RESET ROLE;

-- ── Atomic with the audit event ─────────────────────────────────────────

SELECT public.check_raises('a failing event rolls the approval back (the whole function)',
  $$ SET LOCAL ROLE service_role;
     SELECT public.labelos_audit_approval_request('b1570000-0000-4000-8000-000000000001', 'a1570000-0000-4000-8000-000000000002', 'release', 'f1570000-0000-4000-8000-0000000000a1', 'metadata', 'a1570000-0000-4000-8000-000000000003', NULL, '{}'::jsonb, '{"artist_id": "not-a-uuid"}'::jsonb, '{}'::jsonb) $$,
  'invalid input syntax for type uuid');
SELECT public.check_eq('… and no metadata approval exists', (SELECT count(*) FROM public.approvals WHERE gate = 'metadata'), 0::bigint);

-- ── Append-only ─────────────────────────────────────────────────────────

SELECT public.check_raises('UPDATE is refused for the table owner',
  $$UPDATE public.approvals SET note = 'edited'$$, 'append-only');
SELECT public.check_raises('… a decision cannot be flipped', $$UPDATE public.approvals SET decision = 'approved' WHERE decision = 'changes_requested'$$, 'append-only');
SELECT public.check_raises('DELETE is refused while the organization and release exist', $$DELETE FROM public.approvals$$, 'append-only');
SELECT public.check_raises('TRUNCATE is refused', $$TRUNCATE public.approvals$$, 'append-only');
SET ROLE service_role;
SELECT public.check_raises('the service role has no UPDATE privilege', $$UPDATE public.approvals SET note = 'x'$$, 'permission denied');
SELECT public.check_raises('… no DELETE', $$DELETE FROM public.approvals$$, 'permission denied');
SELECT public.check_raises('… no TRUNCATE', $$TRUNCATE public.approvals$$, 'permission denied');
RESET ROLE;

-- ── Constraints (raw inserts, as the owner) ─────────────────────────────

SELECT public.check_raises('a song is asked for legal only',
  $$INSERT INTO public.approvals (org_id, song_id, gate, decision, approver_id, actor_id) VALUES ('b1570000-0000-4000-8000-000000000001', 'e1570000-0000-4000-8000-000000000001', 'artwork', 'requested', 'a1570000-0000-4000-8000-000000000003', 'a1570000-0000-4000-8000-000000000002')$$,
  'approvals_song_gate_check');
SELECT public.check_raises('exactly one subject: neither',
  $$INSERT INTO public.approvals (org_id, gate, decision, approver_id, actor_id) VALUES ('b1570000-0000-4000-8000-000000000001', 'legal', 'requested', 'a1570000-0000-4000-8000-000000000003', 'a1570000-0000-4000-8000-000000000002')$$,
  'approvals_subject_check');
SELECT public.check_raises('… and both',
  $$INSERT INTO public.approvals (org_id, song_id, release_id, gate, decision, approver_id, actor_id) VALUES ('b1570000-0000-4000-8000-000000000001', 'e1570000-0000-4000-8000-000000000001', 'f1570000-0000-4000-8000-0000000000a1', 'legal', 'requested', 'a1570000-0000-4000-8000-000000000003', 'a1570000-0000-4000-8000-000000000002')$$,
  'approvals_subject_check');
SELECT public.check_raises('changes requested needs a note',
  $$INSERT INTO public.approvals (org_id, song_id, gate, decision, actor_id) VALUES ('b1570000-0000-4000-8000-000000000001', 'e1570000-0000-4000-8000-000000000001', 'legal', 'changes_requested', 'a1570000-0000-4000-8000-000000000002')$$,
  'approvals_changes_note_check');
SELECT public.check_raises('a request needs an approver',
  $$INSERT INTO public.approvals (org_id, song_id, gate, decision, actor_id) VALUES ('b1570000-0000-4000-8000-000000000001', 'e1570000-0000-4000-8000-000000000001', 'legal', 'requested', 'a1570000-0000-4000-8000-000000000002')$$,
  'approvals_request_shape_check|approver must be a member');
SELECT public.check_raises('an unknown gate',
  $$INSERT INTO public.approvals (org_id, release_id, gate, decision, actor_id) VALUES ('b1570000-0000-4000-8000-000000000001', 'f1570000-0000-4000-8000-0000000000a1', 'distribution', 'approved', 'a1570000-0000-4000-8000-000000000002')$$,
  'approvals_gate_check');
SELECT public.check_raises('another organization''s song',
  $$INSERT INTO public.approvals (org_id, song_id, gate, decision, actor_id) VALUES ('b1570000-0000-4000-8000-000000000001', 'e1570000-0000-4000-8000-000000000003', 'legal', 'approved', 'a1570000-0000-4000-8000-000000000002')$$,
  'same organization');
SELECT public.check_raises('a producer track is not a song',
  $$INSERT INTO public.approvals (org_id, song_id, gate, decision, actor_id) VALUES ('b1570000-0000-4000-8000-000000000001', 'e1570000-0000-4000-8000-000000000004', 'legal', 'approved', 'a1570000-0000-4000-8000-000000000002')$$,
  'same organization');
SELECT public.check_raises('a request''s approver must be a member',
  $$INSERT INTO public.approvals (org_id, song_id, gate, decision, approver_id, actor_id) VALUES ('b1570000-0000-4000-8000-000000000001', 'e1570000-0000-4000-8000-000000000001', 'legal', 'requested', 'a1570000-0000-4000-8000-000000000008', 'a1570000-0000-4000-8000-000000000002')$$,
  'approver must be a member');
SELECT public.check_raises('a decision answers a request of the same subject and gate',
  format($$INSERT INTO public.approvals (org_id, release_id, gate, decision, actor_id, request_id) VALUES ('b1570000-0000-4000-8000-000000000001', 'f1570000-0000-4000-8000-0000000000a1', 'artwork', 'approved', 'a1570000-0000-4000-8000-000000000002', %L)$$,
         (SELECT id FROM public.approvals WHERE song_id = 'e1570000-0000-4000-8000-000000000001' AND decision = 'requested' LIMIT 1)),
  'same subject and gate');
INSERT INTO public.approvals (org_id, release_id, gate, decision, actor_id, created_at) VALUES (:L, :R2, 'master', 'approved', :AR, '2000-01-01');
SELECT public.check_eq('created_at cannot be backdated: the trigger stamps it',
  (SELECT created_at > now() - interval '1 day' FROM public.approvals WHERE release_id = :R2 AND gate = 'master'), true);
SELECT public.check_raises('a snapshot must be an object',
  $$INSERT INTO public.approvals (org_id, release_id, gate, decision, actor_id, subject_snapshot) VALUES ('b1570000-0000-4000-8000-000000000001', 'f1570000-0000-4000-8000-0000000000a2', 'master', 'approved', 'a1570000-0000-4000-8000-000000000002', '[]'::jsonb)$$,
  'approvals_snapshot_check');

-- ── Reads, as each member ───────────────────────────────────────────────

SET ROLE authenticated;
SELECT public.as_user(:O);
SELECT public.check_eq('owner reads everything in L',
  public.visible_approvals(),
  'R1/artwork/requested,R2/marketing/requested,R2/master/approved,S1/legal/requested,S1/legal/changes_requested,S1/legal/requested,S1/legal/approved,S2/legal/requested,S2/legal/approved,S2/legal/changes_requested');
SELECT public.as_user(:AR);
SELECT public.check_eq('A&R (release.write, whole org) reads the same', (SELECT count(*) FROM public.approvals), 10::bigint);
SELECT public.as_user(:LG);
SELECT public.check_eq('legal (approve.legal, whole org) reads them', (SELECT count(*) FROM public.approvals), 10::bigint);
SELECT public.as_user(:MK);
SELECT public.check_eq('marketing (approve.artwork / marketing, whole org) reads them', (SELECT count(*) FROM public.approvals), 10::bigint);
SELECT public.as_user(:SC);
SELECT public.check_eq('A&R scoped to Kilo: only Kilo''s song and Kilo''s release',
  public.visible_approvals(), 'R2/marketing/requested,R2/master/approved,S2/legal/requested,S2/legal/approved,S2/legal/changes_requested');
SELECT public.as_user(:PRD);
SELECT public.check_eq('the producer function holds no release ability: nothing', public.visible_approvals(), '');
SELECT public.as_user(:EXT);
SELECT public.check_eq('an external project member reads nothing through the database', public.visible_approvals(), '');
SELECT public.as_user(:X);
SELECT public.check_eq('L2''s owner: nothing of L', public.visible_approvals(), '');
SELECT public.as_user(:OUT);
SELECT public.check_eq('a user in no org: nothing', public.visible_approvals(), '');

-- Nothing writes through the API roles.
SELECT public.as_user(:O);
SELECT public.check_raises('even the owner cannot insert through the API roles',
  $$INSERT INTO public.approvals (org_id, song_id, gate, decision, actor_id) VALUES ('b1570000-0000-4000-8000-000000000001', 'e1570000-0000-4000-8000-000000000001', 'legal', 'approved', 'a1570000-0000-4000-8000-000000000001')$$,
  'written through /api/org only|row-level security|permission denied');
SELECT public.check_raises('… nor update', $$UPDATE public.approvals SET note = 'x'$$, 'permission denied');
SELECT public.check_raises('… nor delete', $$DELETE FROM public.approvals$$, 'permission denied');
SELECT public.check_raises('authenticated cannot call the request function',
  $$SELECT public.labelos_audit_approval_request('b1570000-0000-4000-8000-000000000001', 'a1570000-0000-4000-8000-000000000001', 'song', 'e1570000-0000-4000-8000-000000000001', 'legal', 'a1570000-0000-4000-8000-000000000003', NULL, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)$$,
  'permission denied');
SELECT public.check_raises('… nor the decide function',
  $$SELECT public.labelos_audit_approval_decide('b1570000-0000-4000-8000-000000000001', 'a1570000-0000-4000-8000-000000000001', 'song', 'e1570000-0000-4000-8000-000000000001', 'legal', 'approved', NULL, '{}'::jsonb, true, '{}'::jsonb, '{}'::jsonb)$$,
  'permission denied');
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_raises('anon has no access to the table', $$SELECT count(*) FROM public.approvals$$, 'permission denied');
RESET ROLE;

-- ── R-08: hashed subplans, no per-row definer call ──────────────────────

SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('the read plans its membership tests as hashed subplans',
  public.plan_filters('SELECT * FROM public.approvals') ~ 'hashed SubPlan', true);
SELECT public.check_eq('… and no correlated (per-row) SubPlan or SECURITY DEFINER call remains in the filter',
  public.plan_filters('SELECT * FROM public.approvals') ~ '(?<!hashed )SubPlan|can_see_org_|has_org_cap|can_see_artist|labelos_scoped', false);
RESET ROLE;

-- ── Cascades ────────────────────────────────────────────────────────────

DELETE FROM public.releases WHERE id = :R2;
SELECT public.check_eq('deleting a release takes its approvals with it',
  (SELECT count(*) FROM public.approvals WHERE release_id = :R2), 0::bigint);
SELECT public.check_eq('… and not the others', (SELECT count(*) FROM public.approvals WHERE release_id = :R1), 1::bigint);
DELETE FROM public.organizations WHERE id = :L;
SELECT public.check_eq('deleting an organization deletes its approvals, decisions included',
  (SELECT count(*) FROM public.approvals), 0::bigint);
