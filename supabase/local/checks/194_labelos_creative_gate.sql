-- Behaviour checks for 194_labelos_creative_gate.sql (LABEL-68), run by scripts/local-db/check.sh
-- (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven, as the roles PostgREST uses:
--   - approvals accept the 'creative' gate on a RELEASE, and still refuse any other word;
--   - a SONG still takes `legal` only (approvals_song_gate_check is untouched);
--   - labelos_audit_approval_request / _decide record a creative request and decision, with their events, and the
--     previous behaviour of the other gates is unchanged (addressee, seen, self-approval);
--   - labelos_audit_release_deliver accepts a fingerprint that names the creative gate and detects a creative decision
--     that landed after the read (`changed`), and still refuses an unknown gate;
--   - labelos_audit_creative_gate: owner only, merges one key without losing others, derives `from` itself, writes
--     the audit event in the same transaction, a repeat changes nothing and writes nothing, the API roles cannot call it;
--   - nothing in organizations.settings changes for an org that never calls it (off by default).
--
-- Cast: label L owner O, member M (project manager), member X; label L2 owner Y. Song S, releases RA / RB in L.

\set O  '''a1850000-0000-4000-8000-000000000001'''
\set M  '''a1850000-0000-4000-8000-000000000002'''
\set X  '''a1850000-0000-4000-8000-000000000003'''
\set Y  '''a1850000-0000-4000-8000-000000000004'''
\set L  '''b1850000-0000-4000-8000-000000000001'''
\set L2 '''b1850000-0000-4000-8000-000000000002'''
\set C  '''c1850000-0000-4000-8000-0000000000c1'''
\set P  '''d1850000-0000-4000-8000-0000000000d1'''
\set S  '''e1850000-0000-4000-8000-0000000000e1'''
\set RA '''f1850000-0000-4000-8000-0000000000a1'''
\set RB '''f1850000-0000-4000-8000-0000000000a2'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o185@local.test'), (:M, 'm185@local.test'), (:X, 'x185@local.test'), (:Y, 'y185@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by, settings) VALUES
  (:L, 'Label 185', 'label-185', 'label', :O, '{"legal_gate":"off"}'),
  (:L2, 'Label Two 185', 'label-two-185', 'label', :Y, '{}');
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :M, 'member', '{project_manager}', 'org'),
  (:L, :X, 'member', '{project_manager}', 'org'),
  (:L2, :Y, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES (:C, NULL, :L, 'Nova', 'nova185@local.test', 'artist');
INSERT INTO public.projects (id, user_id, org_id, name) VALUES (:P, NULL, :L, 'Nova EP');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S, NULL, :L, :O, 'One', 'song', 'r2://private/orgs/l/s1', 'selected');
INSERT INTO public.releases (id, org_id, project_id, contact_id, title, created_by) VALUES
  (:RA, :L, :P, :C, 'A', :O), (:RB, :L, :P, :C, 'B', :O);
INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES
  (:RA, :L, 1, :S, :S), (:RB, :L, 1, :S, :S);

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
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.labelos_release_items_key(uuid), public.labelos_release_latest_approval(uuid, text) TO service_role;

-- The fingerprint the route would pass for a draft release, read now, naming the creative gate.
CREATE FUNCTION public.fp185(p_release uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'release_updated_at', r.updated_at::text,
    'items', public.labelos_release_items_key(r.id),
    'approvals', jsonb_build_object(
      'master', public.labelos_release_latest_approval(r.id, 'master'),
      'creative', public.labelos_release_latest_approval(r.id, 'creative')))
  FROM public.releases r WHERE r.id = p_release
$$;
GRANT EXECUTE ON FUNCTION public.fp185(uuid) TO service_role;

-- ═══ 1. the vocabulary ════════════════════════════════════════════════════
SELECT public.check_eq('the constraint lists creative',
  (SELECT pg_get_constraintdef(oid) ~ '''creative''' FROM pg_constraint WHERE conname = 'approvals_gate_check'), true);

SET ROLE authenticated;
SELECT public.check_raises('authenticated cannot call the request function',
  format($$SELECT public.labelos_audit_approval_request(%L, %L, 'release', %L, 'creative', %L, NULL, '{}', '{}', '{}')$$, :L, :O, :RA, :M), 'permission denied');
SELECT public.check_raises('authenticated cannot call the switch',
  format($$SELECT public.labelos_audit_creative_gate(%L, %L, true)$$, :L, :O), 'permission denied');
RESET ROLE;

SELECT public.check_eq('an unknown gate is still refused (request)',
  public.labelos_audit_approval_request(:L, :O, 'release', :RA, 'bogus', :M, NULL, '{}', '{}', '{}') ->> 'error', 'bad_gate');
SELECT public.check_eq('a song takes legal only: creative is refused on a song',
  public.labelos_audit_approval_request(:L, :O, 'song', :S, 'creative', :M, NULL, '{}', '{}', '{}') ->> 'error', 'bad_gate');
SELECT public.check_eq('an unknown gate is still refused (decide)',
  public.labelos_audit_approval_decide(:L, :O, 'release', :RA, 'bogus', 'approved', NULL, '{}', true, '{}', '{}') ->> 'error', 'bad_gate');

-- ═══ 2. a creative request and decision ═══════════════════════════════════
SELECT public.check_eq('a creative request is recorded',
  (public.labelos_audit_approval_request(:L, :O, 'release', :RA, 'creative', :M, NULL, '{}', '{}', '{}') -> 'approval' ->> 'gate'), 'creative');
SELECT public.check_eq('asking again while it waits is refused',
  public.labelos_audit_approval_request(:L, :O, 'release', :RA, 'creative', :M, NULL, '{}', '{}', '{}') ->> 'error', 'already_requested');
SELECT public.check_eq('a request event names the gate',
  (SELECT payload ->> 'gate' FROM public.activity_events WHERE org_id = :L AND verb = 'approval.requested' ORDER BY created_at LIMIT 1), 'creative');
SELECT public.check_eq('someone not addressed cannot approve it (187 rule holds for the new gate)',
  public.labelos_audit_approval_decide(:L, :X, 'release', :RA, 'creative', 'approved', NULL, '{}', false,
    jsonb_build_object('check', jsonb_build_object('latest', public.labelos_release_latest_approval(:RA, 'creative'), 'seen', 'k', 'key', 'k')), '{}') ->> 'error', 'no_request');
SELECT public.check_eq('the addressee approves',
  (public.labelos_audit_approval_decide(:L, :M, 'release', :RA, 'creative', 'approved', NULL, '{}', false,
    jsonb_build_object('check', jsonb_build_object('latest', public.labelos_release_latest_approval(:RA, 'creative'), 'seen', 'k', 'key', 'k')), '{}') -> 'approval' ->> 'decision'), 'approved');
SELECT public.check_eq('a decision event names gate and decision',
  (SELECT payload ->> 'gate' || '/' || (payload ->> 'decision') FROM public.activity_events WHERE org_id = :L AND verb = 'approval.decided' ORDER BY created_at LIMIT 1), 'creative/approved');
SELECT public.check_eq('the rows are append-only: the request and the decision are two rows',
  (SELECT count(*)::int FROM public.approvals WHERE release_id = :RA AND gate = 'creative'), 2);

-- ═══ 3. delivery fingerprint ══════════════════════════════════════════════
CREATE TEMP TABLE fp_b AS SELECT public.fp185(:RB) AS fp;
SELECT public.labelos_audit_approval_request(:L, :O, 'release', :RB, 'creative', :M, NULL, '{}', '{}', '{}');
SELECT public.check_eq('a creative request between the read and the claim is `changed`',
  (public.labelos_audit_release_deliver(:L, :O, :RB, 'Distro', now(), (SELECT fp FROM fp_b), '{}', '{}', 'artist') ->> 'error'), 'changed');
SELECT public.check_eq('and nothing was delivered', (SELECT state FROM public.releases WHERE id = :RB), 'draft');
SELECT public.check_eq('a fingerprint naming the creative gate delivers when nothing moved',
  (public.labelos_audit_release_deliver(:L, :O, :RA, 'Distro', now(), public.fp185(:RA), '{}', '{}', 'artist') -> 'release' ->> 'state'), 'delivered');
SELECT public.check_raises('an unknown gate in a fingerprint is still refused',
  format($$SELECT public.labelos_audit_release_deliver(%L, %L, %L, 'Distro', now(), %L::jsonb, '{}', '{}', 'artist')$$,
    :L, :O, :RB, jsonb_build_object('release_updated_at', (SELECT updated_at::text FROM public.releases WHERE id = :RB),
      'items', public.labelos_release_items_key(:RB), 'approvals', jsonb_build_object('bogus', ''))), 'unknown gate');

-- ═══ 4. the switch ════════════════════════════════════════════════════════
SELECT public.check_eq('off by default: the key is absent', (SELECT settings ? 'creative_gate' FROM public.organizations WHERE id = :L), false);
SELECT public.check_eq('a member who is not the owner is refused', public.labelos_audit_creative_gate(:L, :M, true) ->> 'error', 'not_owner');
SELECT public.check_eq('a missing org is refused', public.labelos_audit_creative_gate(gen_random_uuid(), :O, true) ->> 'error', 'not_found');
SELECT public.check_eq('another org''s owner is refused', public.labelos_audit_creative_gate(:L, :Y, true) ->> 'error', 'not_owner');
SELECT public.check_eq('nothing changed after the refusals', (SELECT settings::text FROM public.organizations WHERE id = :L), '{"legal_gate": "off"}');
SELECT public.check_eq('the owner turns it on', (public.labelos_audit_creative_gate(:L, :O, true) ->> 'changed')::boolean, true);
SELECT public.check_eq('the key is merged as the string on and others are kept',
  (SELECT settings::text FROM public.organizations WHERE id = :L), '{"legal_gate": "off", "creative_gate": "on"}');
SELECT public.check_eq('one audit event, from off to on, internal',
  (SELECT payload::text || '/' || audit::text || '/' || visibility FROM public.activity_events WHERE org_id = :L AND verb = 'creative_gate.changed'),
  '{"to": "on", "from": "off"}/true/internal');
SELECT public.check_eq('a repeat changes nothing', (public.labelos_audit_creative_gate(:L, :O, true) ->> 'changed')::boolean, false);
SELECT public.check_eq('and writes no second event', (SELECT count(*)::int FROM public.activity_events WHERE org_id = :L AND verb = 'creative_gate.changed'), 1);
SELECT public.check_eq('turning it off records from on', (public.labelos_audit_creative_gate(:L, :O, false) ->> 'changed')::boolean, true);
SELECT public.check_eq('and stores the string off', (SELECT settings ->> 'creative_gate' FROM public.organizations WHERE id = :L), 'off');
SELECT public.check_eq('the other org was not touched', (SELECT settings::text FROM public.organizations WHERE id = :L2), '{}');
