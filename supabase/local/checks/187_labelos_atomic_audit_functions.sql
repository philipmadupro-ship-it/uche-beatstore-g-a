-- Behaviour checks for 187_labelos_atomic_audit_functions.sql (LABEL-73), run by
-- scripts/local-db/check.sh in its own copy of the throwaway database. Every check RAISEs on failure.
--
-- Cast: OW owner of label L, AD admin, M member (approver), X member (not addressed);
-- C a roster artist, P its project, S1 an org song, RA/RB/RC/RD/RE draft releases, RI an imported release.
--
-- Proven:
--  1. deliver (the four G7 cases): two concurrent deliveries → one wins and one event; a decision recorded
--     between the read and the call → `changed`, nothing written; an item added after delivery fails;
--     the event exists iff the state changed (a refused payload rolls the change back too);
--  2. store listing: consent re-checked under the lock, list / unlist with their events, a stale plan is `changed`;
--  3. import: project + release + events in one transaction, a refused payload leaves nothing;
--  4. org delete / restore / export: owner only, producer org refused, restore is compare-and-set with the grace period;
--  5. digest channel: `replaced` read under the lock, no event for a no-op, the cipher never reaches the event;
--  6. approval decide: addressee, live release, seen, latest row; 157's behaviour without `check`;
--  7. settings: `from` read under the lock;
--  8. has_org_cap: departments_off subtracted;
--  9. caps: artist cap on contacts and on connection accept, seat cap on an artist → staff change (two sessions).

\set OW  '''a1870000-0000-4000-8000-000000000001'''
\set AD  '''a1870000-0000-4000-8000-000000000002'''
\set M   '''a1870000-0000-4000-8000-000000000003'''
\set X   '''a1870000-0000-4000-8000-000000000004'''
\set OW2 '''a1870000-0000-4000-8000-000000000005'''
\set L   '''b1870000-0000-4000-8000-000000000001'''
\set L2  '''b1870000-0000-4000-8000-000000000002'''
\set LP  '''b1870000-0000-4000-8000-000000000003'''
\set C   '''c1870000-0000-4000-8000-000000000001'''
\set P   '''d1870000-0000-4000-8000-000000000001'''
\set S1  '''e1870000-0000-4000-8000-000000000001'''
\set S2  '''e1870000-0000-4000-8000-000000000002'''
\set RA  '''f1870000-0000-4000-8000-000000000001'''
\set RB  '''f1870000-0000-4000-8000-000000000002'''
\set RC  '''f1870000-0000-4000-8000-000000000003'''
\set RD  '''f1870000-0000-4000-8000-000000000004'''
\set RE  '''f1870000-0000-4000-8000-000000000005'''
\set RI  '''f1870000-0000-4000-8000-000000000006'''
\set RF  '''f1870000-0000-4000-8000-000000000007'''

INSERT INTO auth.users (id, email) VALUES
  (:OW, 'ow187@local.test'), (:AD, 'ad187@local.test'), (:M, 'm187@local.test'), (:X, 'x187@local.test'), (:OW2, 'ow2187@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label 187', 'label-187', 'label', :OW),
  (:L2, 'Label Two 187', 'label-two-187', 'label', :OW2),
  (:LP, 'Producer 187', 'producer-187', 'producer', :OW);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :OW, 'owner', '{}', 'org'),
  (:L, :AD, 'admin', '{}', 'org'),
  (:L, :M, 'member', '{project_manager}', 'org'),
  (:L, :X, 'member', '{project_manager}', 'org'),
  (:L2, :OW2, 'owner', '{}', 'org'),
  (:LP, :OW, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES (:C, NULL, :L, 'Nova', 'nova187@local.test', 'artist');
INSERT INTO public.projects (id, user_id, org_id, name) VALUES (:P, NULL, :L, 'Nova EP');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S1, NULL, :L, :OW, 'One', 'song', 'r2://private/orgs/l/s1', 'selected'),
  (:S2, NULL, :L, :OW, 'Two', 'song', 'r2://private/orgs/l/s2', 'selected');
INSERT INTO public.releases (id, org_id, project_id, contact_id, title, created_by) VALUES
  (:RA, :L, :P, :C, 'A', :OW), (:RB, :L, :P, :C, 'B', :OW), (:RC, :L, :P, :C, 'C', :OW),
  (:RD, :L, :P, :C, 'D', :OW), (:RE, :L, :P, :C, 'E', :OW), (:RF, :L, :P, :C, 'F', :OW);
INSERT INTO public.releases (id, org_id, project_id, contact_id, title, created_by, state, imported_released, delivered_at)
  VALUES (:RI, :L, :P, :C, 'Imported', :OW, 'delivered', true, now());
INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES
  (:RA, :L, 1, :S1, :S1), (:RB, :L, 1, :S1, :S1), (:RC, :L, 1, :S1, :S1), (:RD, :L, 1, :S1, :S1),
  (:RE, :L, 1, :S1, :S1), (:RF, :L, 1, :S1, :S1), (:RI, :L, 1, :S1, :S1);

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
GRANT EXECUTE ON FUNCTION public.labelos_release_items_key(uuid), public.labelos_release_latest_approval(uuid, text) TO service_role;

-- The fingerprint the route would pass for a draft release, read now.
CREATE FUNCTION public.fp(p_release uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'release_updated_at', r.updated_at::text,
    'items', public.labelos_release_items_key(r.id),
    'approvals', jsonb_build_object(
      'master', public.labelos_release_latest_approval(r.id, 'master'),
      'artwork', public.labelos_release_latest_approval(r.id, 'artwork'),
      'legal', public.labelos_release_latest_approval(r.id, 'legal'),
      'marketing', public.labelos_release_latest_approval(r.id, 'marketing'),
      'metadata', public.labelos_release_latest_approval(r.id, 'metadata')))
  FROM public.releases r WHERE r.id = p_release
$$;
GRANT EXECUTE ON FUNCTION public.fp(uuid) TO service_role;
CREATE FUNCTION public.exp(p_release uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('state', r.state, 'imported_released', r.imported_released, 'release_date', r.release_date,
    'store_listed', r.store_listed, 'items', public.labelos_release_items_key(r.id)) FROM public.releases r WHERE r.id = p_release
$$;
GRANT EXECUTE ON FUNCTION public.exp(uuid) TO service_role;
CREATE FUNCTION public.chk(p_release uuid, p_seen text, p_key text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('check', jsonb_build_object('latest', public.labelos_release_latest_approval(p_release, 'master'), 'seen', p_seen, 'key', p_key))
$$;
GRANT EXECUTE ON FUNCTION public.chk(uuid, text, text) TO service_role;
CREATE FUNCTION public.events_of(p_verb text, p_release uuid) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.activity_events WHERE verb = p_verb AND release_id = p_release
$$;
CREATE FUNCTION public.peer(p_name text) RETURNS text LANGUAGE sql AS $$
  SELECT dblink_connect(p_name, format('host=127.0.0.1 port=%s dbname=%s user=postgres', current_setting('port'), current_database()));
$$;

-- ═══ 1. deliver ═══════════════════════════════════════════════════════════
SET ROLE authenticated;
SELECT public.check_raises('authenticated cannot call deliver',
  format($$SELECT public.labelos_audit_release_deliver(%L, %L, %L, 'Distro', now(), '{}', '{}', '{}', 'artist')$$, :L, :OW, :RA), 'permission denied');
RESET ROLE;
SET ROLE anon;
SELECT public.check_raises('anon cannot call deliver',
  format($$SELECT public.labelos_audit_release_deliver(%L, %L, %L, 'Distro', now(), '{}', '{}', '{}', 'artist')$$, :L, :OW, :RA), 'permission denied');
RESET ROLE;

SET ROLE service_role;
-- 1a. Happy path: state, delivered_to and the audit event together.
SELECT public.check_eq('deliver: a ready draft is delivered',
  (public.labelos_audit_release_deliver(:L, :OW, :RA, 'Distro', now(), public.fp(:RA),
     jsonb_build_object('artist_id', :C, 'project_id', :P), '{"distributor":"Distro","override":false}', 'artist') -> 'release' ->> 'state'), 'delivered');
SELECT public.check_eq('and its event exists, audit class', (SELECT audit FROM public.activity_events WHERE verb = 'release.delivered' AND release_id = :RA), true);
SELECT public.check_eq('exactly one event', public.events_of('release.delivered', :RA), 1);
-- 1b. A second delivery is refused and writes no second event.
SELECT public.check_eq('deliver: a repeat is not_draft',
  (public.labelos_audit_release_deliver(:L, :OW, :RA, 'Distro', now(), public.fp(:RA), '{}', '{}', 'artist') ->> 'error'), 'not_draft');
SELECT public.check_eq('and still exactly one event', public.events_of('release.delivered', :RA), 1);
-- 1c. An item added after delivery fails (167's lock).
SELECT public.check_raises('an item is not added to the delivered release',
  format('INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES (%L, %L, 2, %L, %L)', :RA, :L, :S2, :S2),
  'a delivered release keeps its tracklist');

-- 1d. A decision recorded between the read and the call: `changed`, nothing written.
CREATE TEMP TABLE fp_b AS SELECT public.fp(:RB) AS fp;
SELECT public.labelos_audit_approval_request(:L, :OW, 'release', :RB, 'master', :M, NULL, '{}', '{}', '{}');
SELECT public.check_eq('deliver: a request after the read → changed',
  (public.labelos_audit_release_deliver(:L, :OW, :RB, 'Distro', now(), (SELECT fp FROM fp_b), '{}', '{}', 'artist') ->> 'error'), 'changed');
SELECT public.check_eq('and the release is still a draft', (SELECT state FROM public.releases WHERE id = :RB), 'draft');
SELECT public.check_eq('and no event', public.events_of('release.delivered', :RB), 0);
-- 1e. A tracklist edit between the read and the call.
CREATE TEMP TABLE fp_c AS SELECT public.fp(:RC) AS fp;
INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES (:RC, :L, 2, :S2, :S2);
SELECT public.check_eq('deliver: an item added after the read → changed',
  (public.labelos_audit_release_deliver(:L, :OW, :RC, 'Distro', now(), (SELECT fp FROM fp_c), '{}', '{}', 'artist') ->> 'error'), 'changed');
-- 1f. A field edit (raw updated_at string compared at microsecond precision).
CREATE TEMP TABLE fp_d AS SELECT public.fp(:RD) AS fp;
SELECT pg_sleep(0.01);
UPDATE public.releases SET title = 'D2' WHERE id = :RD;
SELECT public.check_eq('deliver: a release edit after the read → changed',
  (public.labelos_audit_release_deliver(:L, :OW, :RD, 'Distro', now(), (SELECT fp FROM fp_d), '{}', '{}', 'artist') ->> 'error'), 'changed');
-- 1g. A payload the audit refuses rolls the state change back with it (no put-back exists).
SELECT public.check_raises('a refused payload raises',
  format($$SELECT public.labelos_audit_release_deliver(%L, %L, %L, 'Distro', now(), public.fp(%L), '{}', '{"token":"x"}', 'artist')$$, :L, :OW, :RD, :RD),
  'secret-looking key');
SELECT public.check_eq('and the draft is a draft', (SELECT state FROM public.releases WHERE id = :RD), 'draft');
SELECT public.check_eq('another org cannot deliver it', 
  (public.labelos_audit_release_deliver(:L2, :OW2, :RD, 'Distro', now(), public.fp(:RD), '{}', '{}', 'artist') ->> 'error'), 'not_found');
RESET ROLE;

-- 1h. Two deliveries at the same moment: one wins, one event.
SELECT public.peer('s1');
SELECT public.peer('s2');
SELECT dblink_exec('s1', 'SET ROLE service_role');
SELECT dblink_exec('s2', 'SET ROLE service_role');
CREATE TEMP TABLE fp_e AS SELECT public.fp(:RE) AS fp;
SELECT dblink_exec('s1', 'BEGIN');
SELECT (SELECT r FROM dblink('s1', format($q$SELECT public.labelos_audit_release_deliver(%L, %L, %L, 'Distro', now(), %L::jsonb, '{}', '{}', 'artist')::text$q$, :L, :OW, :RE, (SELECT fp FROM fp_e))) AS t(r text)) IS NOT NULL;
SELECT dblink_send_query('s2', format($q$SELECT public.labelos_audit_release_deliver(%L, %L, %L, 'Other', now(), %L::jsonb, '{}', '{}', 'artist')::text$q$, :L, :OW, :RE, (SELECT fp FROM fp_e)));
SELECT pg_sleep(0.3);
SELECT public.check_eq('the second delivery waits for the first', dblink_is_busy('s2'), 1);
SELECT dblink_exec('s1', 'COMMIT');
SELECT public.check_eq('and is then not_draft',
  (SELECT r::jsonb ->> 'error' FROM dblink_get_result('s2') AS t(r text)), 'not_draft');
SELECT * FROM dblink_get_result('s2') AS t(r text);
SELECT public.check_eq('one winner, one event', public.events_of('release.delivered', :RE), 1);
SELECT public.check_eq('and the first distributor stands', (SELECT delivered_to FROM public.releases WHERE id = :RE), 'Distro');

-- ═══ 2. store listing ═════════════════════════════════════════════════════
SET ROLE service_role;
SELECT public.check_eq('list: a draft is not_released',
  (public.labelos_audit_release_store(:L, :OW, :RF, true, 'preview',
     jsonb_build_object('state','draft','imported_released',false,'release_date',NULL,'store_listed',false,'items', public.labelos_release_items_key(:RF)),
     '{}', '{}') ->> 'error'), 'not_released');
SELECT public.check_eq('list: a delivered release goes on the store with its event',
  (public.labelos_audit_release_store(:L, :OW, :RA, true, 'preview', public.exp(:RA), jsonb_build_object('artist_id', :C, 'project_id', :P), '{"playback":"preview"}') -> 'release' ->> 'store_listed'), 'true');
SELECT public.check_eq('and the event', public.events_of('release.store_listed', :RA), 1);
SELECT public.check_eq('and store_listed_at is set', (SELECT store_listed_at IS NOT NULL FROM public.releases WHERE id = :RA), true);
SELECT public.check_eq('a stale plan (it was listed since) → changed',
  (public.labelos_audit_release_store(:L, :OW, :RA, true, 'preview', jsonb_set(public.exp(:RA), '{store_listed}', 'false'), '{}', '{}') ->> 'error'), 'changed');
SELECT public.check_eq('unlist: back to preview, event',
  (public.labelos_audit_release_store(:L, :OW, :RA, false, NULL, public.exp(:RA), '{}', '{"deletePreviews":false}') -> 'release' ->> 'store_playback'), 'preview');
SELECT public.check_eq('unlist event', public.events_of('release.store_unlisted', :RA), 1);
SELECT public.check_eq('unlist again → not_listed, no second event',
  (public.labelos_audit_release_store(:L, :OW, :RA, false, NULL, public.exp(:RA), '{}', '{}') ->> 'error'), 'not_listed');
SELECT public.check_eq('...', public.events_of('release.store_unlisted', :RA), 1);
-- Consent: an artist's "no" that lands after the route's read stops the listing under the lock.
CREATE TEMP TABLE exp_e AS SELECT public.exp(:RE) AS e;
RESET ROLE;
INSERT INTO public.listing_consents (org_id, release_id, artist_contact_id, state, decided_at) VALUES (:L, :RE, :C, 'no', now());
SET ROLE service_role;
SELECT public.check_eq('list: an artist said no meanwhile → consent',
  (public.labelos_audit_release_store(:L, :OW, :RE, true, 'preview', (SELECT e FROM exp_e), '{}', '{}') ->> 'error'), 'consent');
SELECT public.check_eq('and it is not listed, no event', (SELECT store_listed FROM public.releases WHERE id = :RE) OR public.events_of('release.store_listed', :RE) > 0, false);
-- The readiness-vs-claim window: an imported, unlisted release whose tracklist moved after the read.
CREATE TEMP TABLE exp_i AS SELECT public.exp(:RI) AS e;
INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES (:RI, :L, 2, :S2, :S2);
SELECT public.check_eq('list: an item added after the read → changed',
  (public.labelos_audit_release_store(:L, :OW, :RI, true, 'preview', (SELECT e FROM exp_i), '{}', '{}') ->> 'error'), 'changed');
RESET ROLE;

-- ═══ 3. import ════════════════════════════════════════════════════════════
SET ROLE service_role;
CREATE TEMP TABLE imp AS
SELECT public.labelos_audit_release_import(:L, :OW,
  jsonb_build_object('title', 'Old Hit', 'contact_id', :C, 'release_date', '2020-01-01', 'delivered_at', '2020-01-01T12:00:00Z', 'created_by', :OW, 'territories', jsonb_build_array('NG','GB')),
  '{"releaseDate":"2020-01-01"}') AS r;
SELECT public.check_eq('import: a delivered, imported release', (SELECT r -> 'release' ->> 'state' FROM imp), 'delivered');
SELECT public.check_eq('with its project made', (SELECT (r ->> 'created_project')::boolean FROM imp), true);
SELECT public.check_eq('the artist is linked to it', (SELECT count(*)::int FROM public.project_contacts WHERE project_id = (SELECT (r ->> 'project_id')::uuid FROM imp) AND contact_id = :C), 1);
SELECT public.check_eq('three events: project.created, release.created, release.imported',
  (SELECT count(*)::int FROM public.activity_events WHERE verb IN ('project.created','release.created','release.imported') AND release_id IS NOT DISTINCT FROM (SELECT (r -> 'release' ->> 'id')::uuid FROM imp) OR (verb = 'project.created' AND subject_id = (SELECT (r ->> 'project_id')::uuid FROM imp))), 3);
SELECT public.check_eq('release.imported is audit, internal', (SELECT audit AND visibility = 'internal' FROM public.activity_events WHERE verb = 'release.imported' AND release_id = (SELECT (r -> 'release' ->> 'id')::uuid FROM imp)), true);
SELECT public.check_eq('import of an artist outside the org → not_found',
  (public.labelos_audit_release_import(:L2, :OW2, jsonb_build_object('title', 'x', 'contact_id', :C, 'delivered_at', now()::text), '{}') ->> 'error'), 'not_found');
SELECT public.check_raises('a refused payload leaves nothing (no project, no release)',
  format($$SELECT public.labelos_audit_release_import(%L, %L, jsonb_build_object('title','Ghost','contact_id',%L,'delivered_at',now()::text), '{"secret":"x"}')$$, :L, :OW, :C),
  'secret-looking key');
SELECT public.check_eq('no ghost project', (SELECT count(*)::int FROM public.projects WHERE org_id = :L AND name = 'Ghost'), 0);
RESET ROLE;

-- ═══ 4. org delete / restore / export ═════════════════════════════════════
SET ROLE service_role;
SELECT public.check_eq('delete: a member who is not the owner', (public.labelos_audit_org_delete(:L, :AD, now(), '{}') ->> 'error'), 'not_owner');
SELECT public.check_eq('delete: the producer org is refused', (public.labelos_audit_org_delete(:LP, :OW, now(), '{}') ->> 'error'), 'producer_org');
SELECT public.check_eq('export: not the owner', (public.labelos_audit_org_export(:L, :AD, '{"format":"json"}') ->> 'error'), 'not_owner');
SELECT public.check_eq('export: the event is written', (public.labelos_audit_org_export(:L, :OW, '{"format":"json","rows":3}') ->> 'recorded'), 'true');
SELECT public.check_eq('...as an audit event', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'org.exported' AND org_id = :L AND audit), 1);
CREATE TEMP TABLE del AS SELECT public.labelos_audit_org_delete(:L, :OW, now(), '{"graceDays":30}') AS r;
SELECT public.check_eq('delete: stamped', (SELECT deleted_at IS NOT NULL FROM public.organizations WHERE id = :L), true);
SELECT public.check_eq('...with its event', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'org.deletion_scheduled' AND org_id = :L), 1);
SELECT public.check_eq('delete again → not_found', (public.labelos_audit_org_delete(:L, :OW, now(), '{}') ->> 'error'), 'not_found');
SELECT public.check_eq('export of a deleted org → not_found', (public.labelos_audit_org_export(:L, :OW, '{}') ->> 'error'), 'not_found');
SELECT public.check_eq('restore: another stamp → changed',
  (public.labelos_audit_org_restore(:L, :OW, now() - interval '1 day', '{}') ->> 'error'), 'changed');
SELECT public.check_eq('restore: not the owner',
  (public.labelos_audit_org_restore(:L, :AD, (SELECT deleted_at FROM public.organizations WHERE id = :L), '{}') ->> 'error'), 'not_owner');
SELECT public.check_eq('restore: inside the grace period',
  (public.labelos_audit_org_restore(:L, :OW, (SELECT deleted_at FROM public.organizations WHERE id = :L), '{"deletedAt":"x"}') ->> 'restored'), 'true');
SELECT public.check_eq('...deleted_at cleared', (SELECT deleted_at IS NULL FROM public.organizations WHERE id = :L), true);
SELECT public.check_eq('...with its event', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'org.restored' AND org_id = :L), 1);
SELECT public.check_eq('restore of a live org → not_deleted', (public.labelos_audit_org_restore(:L, :OW, now(), '{}') ->> 'error'), 'not_deleted');
RESET ROLE;
UPDATE public.organizations SET deleted_at = now() - interval '31 days' WHERE id = :L2;
SET ROLE service_role;
SELECT public.check_eq('restore past the grace period → expired',
  (public.labelos_audit_org_restore(:L2, :OW2, (SELECT deleted_at FROM public.organizations WHERE id = :L2), '{}') ->> 'error'), 'expired');
SELECT public.check_eq('...and it stays deleted', (SELECT deleted_at IS NOT NULL FROM public.organizations WHERE id = :L2), true);
RESET ROLE;
UPDATE public.organizations SET deleted_at = NULL WHERE id = :L2;

-- ═══ 5. digest channel ════════════════════════════════════════════════════
SET ROLE service_role;
SELECT public.check_eq('digest set: first save', (public.labelos_audit_digest_channel_set(:L, :OW, 'v1:cipher-one', '{}') ->> 'replaced'), 'false');
SELECT public.check_eq('...stored', (SELECT slack_webhook_cipher FROM public.org_digest_channels WHERE org_id = :L), 'v1:cipher-one');
SELECT public.check_eq('digest set: second save replaces', (public.labelos_audit_digest_channel_set(:L, :OW, 'v1:cipher-two', '{}') ->> 'replaced'), 'true');
SELECT public.check_eq('...events carry replaced from the row, not the caller',
  (SELECT string_agg(payload ->> 'replaced', ',' ORDER BY created_at) FROM public.activity_events WHERE verb = 'digest.channel_set' AND org_id = :L), 'false,true');
SELECT public.check_eq('the cipher is in no event', (SELECT count(*)::int FROM public.activity_events WHERE org_id = :L AND payload::text LIKE '%cipher-%'), 0);
SELECT public.check_eq('digest remove: changed', (public.labelos_audit_digest_channel_remove(:L, :OW, '{}') ->> 'changed'), 'true');
SELECT public.check_eq('...cleared', (SELECT slack_webhook_cipher IS NULL FROM public.org_digest_channels WHERE org_id = :L), true);
SELECT public.check_eq('digest remove again: no change, no event', (public.labelos_audit_digest_channel_remove(:L, :OW, '{}') ->> 'changed'), 'false');
SELECT public.check_eq('...', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'digest.channel_removed' AND org_id = :L), 1);
RESET ROLE;

-- ═══ 6. approval decide ═══════════════════════════════════════════════════
SET ROLE service_role;
-- RF: M is asked, M approves with the plan's facts.
CREATE TEMP TABLE req AS SELECT public.labelos_audit_approval_request(:L, :OW, 'release', :RF, 'master', :M, NULL, '{}', '{}', '{}') AS r;
SELECT public.check_eq('decide: a member not addressed → no_request',
  (public.labelos_audit_approval_decide(:L, :X, 'release', :RF, 'master', 'approved', NULL, '{}', false, public.chk(:RF, 'k', 'k'), '{}') ->> 'error'), 'no_request');
SELECT public.check_eq('decide: seen is required',
  (public.labelos_audit_approval_decide(:L, :M, 'release', :RF, 'master', 'approved', NULL, '{}', false, public.chk(:RF, '', 'k'), '{}') ->> 'error'), 'seen_required');
SELECT public.check_eq('decide: seen must equal the key',
  (public.labelos_audit_approval_decide(:L, :M, 'release', :RF, 'master', 'approved', NULL, '{}', false, public.chk(:RF, 'old', 'new'), '{}') ->> 'error'), 'changed_since_seen');
SELECT public.check_eq('decide: a stale latest row → changed',
  (public.labelos_audit_approval_decide(:L, :M, 'release', :RF, 'master', 'approved', NULL, '{}', false,
     jsonb_build_object('check', jsonb_build_object('latest', '00000000-0000-4000-8000-000000000000', 'seen', 'k', 'key', 'k')), '{}') ->> 'error'), 'changed');
SELECT public.check_eq('...nothing was written by any refusal', (SELECT count(*)::int FROM public.approvals WHERE release_id = :RF), 1);
SELECT public.check_eq('decide: the addressee approves',
  (public.labelos_audit_approval_decide(:L, :M, 'release', :RF, 'master', 'approved', NULL, '{}', false, public.chk(:RF, 'k', 'k'), '{}') -> 'approval' ->> 'decision'), 'approved');
SELECT public.check_eq('decide: an owner or admin needs no request (exempt)',
  (public.labelos_audit_approval_decide(:L, :AD, 'release', :RF, 'artwork', 'approved', NULL, '{}', true, jsonb_build_object('check', jsonb_build_object('latest', '', 'seen', 'k', 'key', 'k')), '{}') -> 'approval' ->> 'decision'), 'approved');
-- S1 is on releases that are going out: its legal approval is the release's.
SELECT public.check_eq('decide: a song on a live release → decided_on_release',
  (public.labelos_audit_approval_decide(:L, :AD, 'song', :S1, 'legal', 'approved', NULL, '{}', true, jsonb_build_object('check', jsonb_build_object('latest', '', 'seen', 'k', 'key', 'k')), '{}') ->> 'error'), 'decided_on_release');
-- Without `check` it is 157's function: no addressee rule, no seen.
SELECT public.check_eq('decide without check: 157 unchanged',
  (public.labelos_audit_approval_decide(:L, :X, 'release', :RF, 'marketing', 'approved', NULL, '{}', false, '{}', '{}') -> 'approval' ->> 'decision'), 'approved');
RESET ROLE;

-- ═══ 7. settings: `from` under the lock ═══════════════════════════════════
UPDATE public.organizations SET settings = '{"attention_release_days": 30}' WHERE id = :L;
SET ROLE service_role;
SELECT public.labelos_audit_org_settings_atomic(:L, :OW, '{"attention_release_days": 10}',
  '{"keys":["attention_release_days"],"changes":{"attention_release_days":{"from":99,"to":10}}}');
SELECT public.check_eq('settings: from is what the row held, not what the caller read',
  (SELECT payload -> 'changes' -> 'attention_release_days' ->> 'from' FROM public.activity_events WHERE verb = 'org.settings_changed' AND org_id = :L), '30');
SELECT public.check_eq('...and to', (SELECT payload -> 'changes' -> 'attention_release_days' ->> 'to' FROM public.activity_events WHERE verb = 'org.settings_changed' AND org_id = :L), '10');
-- A key never saved keeps the caller's default.
SELECT public.labelos_audit_org_settings_atomic(:L, :OW, '{"legal_gate": "off"}', '{"keys":["legal_gate"],"changes":{"legal_gate":{"from":"on","to":"off"}}}');
SELECT public.check_eq('settings: an unsaved key keeps the default from',
  (SELECT payload -> 'changes' -> 'legal_gate' ->> 'from' FROM public.activity_events WHERE verb = 'org.settings_changed' AND org_id = :L ORDER BY created_at DESC LIMIT 1), 'on');
RESET ROLE;

-- ═══ 8. has_org_cap: departments_off ══════════════════════════════════════
CREATE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, false);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;
SET ROLE authenticated;
SELECT pg_temp.as_user(:OW);
SELECT public.check_eq('the owner holds finance.write', public.has_org_cap(:L, 'finance.write'), true);
SELECT public.check_eq('...and a core capability', public.has_org_cap(:L, 'catalog.write'), true);
RESET ROLE;
SET ROLE service_role;
SELECT public.labelos_audit_org_settings_atomic(:L, :OW, '{"departments_off": ["finance"]}', '{"keys":["departments_off"]}');
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.as_user(:OW);
SELECT public.check_eq('finance switched off: finance.write is false', public.has_org_cap(:L, 'finance.write'), false);
SELECT public.check_eq('...finance.read too', public.has_org_cap(:L, 'finance.read'), false);
SELECT public.check_eq('...another department is untouched', public.has_org_cap(:L, 'pr.write'), true);
SELECT public.check_eq('...and a core capability', public.has_org_cap(:L, 'catalog.write'), true);
RESET ROLE;
SET ROLE service_role;
SELECT public.labelos_audit_org_settings_atomic(:L, :OW, '{"departments_off": []}', '{"keys":["departments_off"]}');
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.as_user(:OW);
SELECT public.check_eq('switched back on', public.has_org_cap(:L, 'finance.write'), true);
RESET ROLE;
RESET request.jwt.claims;

-- ═══ 9. caps ══════════════════════════════════════════════════════════════
-- 9a. Artist cap on contacts.
INSERT INTO public.org_entitlements (org_id, modules, max_seats, max_artists) VALUES (:L2, '{}', 2, 1);
INSERT INTO public.contacts (user_id, org_id, name, email, category) VALUES (NULL, :L2, 'First', 'first187@local.test', 'artist');
SELECT public.check_raises('a second artist passes the cap of 1',
  format($$INSERT INTO public.contacts (user_id, org_id, name, email, category) VALUES (NULL, %L, 'Second', 'second187@local.test', 'rapper')$$, :L2),
  'artist_limit');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES ('c1870000-0000-4000-8000-000000000009', NULL, :L2, 'Eng', 'eng187@local.test', 'engineer');
SELECT public.check_eq('a non-artist is not counted', (SELECT count(*)::int FROM public.contacts WHERE org_id = :L2), 2);
SELECT public.check_raises('making them an artist is one more',
  $$UPDATE public.contacts SET secondary_category = 'artist' WHERE id = 'c1870000-0000-4000-8000-000000000009'$$, 'artist_limit');
UPDATE public.contacts SET name = 'First Renamed' WHERE org_id = :L2 AND email = 'first187@local.test';
SELECT public.check_eq('editing an existing artist is never one more', (SELECT name FROM public.contacts WHERE org_id = :L2 AND email = 'first187@local.test'), 'First Renamed');
SELECT public.check_eq('a producer org (no licence row) is unlimited', (public.labelos_artist_cap_ok(:LP, NULL)), true);
-- 9b. Connection accept at the cap.
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES ('b1870000-0000-4000-8000-000000000010', 'Nova Org 187', 'nova-org-187', 'artist', :OW2);
INSERT INTO public.org_connections (id, label_org_id, artist_org_id, initiated_by) VALUES ('99870000-0000-4000-8000-000000000001', :L2, 'b1870000-0000-4000-8000-000000000010', 'artist');
SET ROLE service_role;
SELECT public.check_eq('accept: the label is at its artist cap',
  (public.labelos_audit_connection_accept(:L2, :OW2, '99870000-0000-4000-8000-000000000001', '{}') ->> 'error'), 'artist_limit');
RESET ROLE;
SELECT public.check_eq('...the connection stays requested', (SELECT status FROM public.org_connections WHERE id = '99870000-0000-4000-8000-000000000001'), 'requested');
UPDATE public.org_entitlements SET max_artists = 2 WHERE org_id = :L2;
SET ROLE service_role;
SELECT public.check_eq('accept: with room it succeeds',
  (public.labelos_audit_connection_accept(:L2, :OW2, '99870000-0000-4000-8000-000000000001', '{}') -> 'connection' ->> 'status'), 'active');
RESET ROLE;
-- 9c. Seat cap on an artist → staff change; two at once queue on the entitlement lock.
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES ('b1870000-0000-4000-8000-000000000011', 'Seats 187', 'seats-187', 'label', :OW);
INSERT INTO auth.users (id, email) VALUES
  ('a1870000-0000-4000-8000-000000000021', 'ar1-187@local.test'), ('a1870000-0000-4000-8000-000000000022', 'ar2-187@local.test');
INSERT INTO public.org_entitlements (org_id, modules, max_seats) VALUES ('b1870000-0000-4000-8000-000000000011', '{}', 2);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  ('b1870000-0000-4000-8000-000000000011', :OW, 'owner', '{}', 'org'),
  ('b1870000-0000-4000-8000-000000000011', 'a1870000-0000-4000-8000-000000000021', 'artist', '{}', 'artists'),
  ('b1870000-0000-4000-8000-000000000011', 'a1870000-0000-4000-8000-000000000022', 'artist', '{}', 'artists');
SELECT dblink_exec('s1', 'BEGIN');
SELECT (SELECT r FROM dblink('s1', $q$SELECT public.labelos_audit_member_update('b1870000-0000-4000-8000-000000000011', 'a1870000-0000-4000-8000-000000000001', 'a1870000-0000-4000-8000-000000000021', '{"role":"member"}', 'member.role_changed', '{}')::text$q$) AS t(r text)) IS NOT NULL;
SELECT dblink_send_query('s2', $q$SELECT public.labelos_audit_member_update('b1870000-0000-4000-8000-000000000011', 'a1870000-0000-4000-8000-000000000001', 'a1870000-0000-4000-8000-000000000022', '{"role":"member"}', 'member.role_changed', '{}')::text$q$);
SELECT pg_sleep(0.3);
SELECT public.check_eq('the second artist → staff change waits for the first (entitlement lock)', dblink_is_busy('s2'), 1);
SELECT dblink_exec('s1', 'COMMIT');
SELECT public.check_eq('...and is then refused: seat_limit',
  (SELECT r::jsonb ->> 'error' FROM dblink_get_result('s2') AS t(r text)), 'seat_limit');
SELECT * FROM dblink_get_result('s2') AS t(r text);
SELECT public.check_eq('...exactly one became staff',
  (SELECT count(*)::int FROM public.org_members WHERE org_id = 'b1870000-0000-4000-8000-000000000011' AND role <> 'artist'), 2);
SELECT public.check_eq('...and only one role-changed event',
  (SELECT count(*)::int FROM public.activity_events WHERE verb = 'member.role_changed' AND org_id = 'b1870000-0000-4000-8000-000000000011'), 1);
