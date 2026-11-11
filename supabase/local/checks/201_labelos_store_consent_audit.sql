-- Behaviour checks for 201_labelos_store_consent_audit.sql (review G17), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven: service_role only; an answer moves the consent row by compare-and-set and writes ONE audit
-- `listing.consent_decided` (internal) in the same transaction; a repeat / a lost race writes nothing; a no takes a
-- LISTED release off the store with `release.store_unlisted` (artist visibility) in the same transaction, and
-- "enforce" (p_from NULL) does that for a no that already stands; unknown release / org is not_found; an event that
-- cannot be written (a secret-looking payload key, a context id that is not a uuid) leaves the row, the listing and
-- the events exactly as they were; the veto is made / lifted with its label-org event AND its artist-org copy, a
-- repeat writes nothing, an org with no active connection is not_connected, and a failing event leaves no veto.

\set O  '''a2010000-0000-4000-8000-000000000001'''
\set X  '''a2010000-0000-4000-8000-000000000002'''
\set Z  '''a2010000-0000-4000-8000-000000000003'''
\set L  '''b2010000-0000-4000-8000-000000000001'''
\set AR '''b2010000-0000-4000-8000-000000000002'''
\set L2 '''b2010000-0000-4000-8000-000000000003'''
\set CL '''c2010000-0000-4000-8000-0000000000c1'''
\set CA '''c2010000-0000-4000-8000-0000000000c2'''
\set CB '''c2010000-0000-4000-8000-0000000000c3'''
\set PA '''d2010000-0000-4000-8000-000000000001'''
\set REL  '''e2010000-0000-4000-8000-000000000001'''
\set CONN '''f2010000-0000-4000-8000-000000000001'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o201@local.test'), (:X, 'x201@local.test'), (:Z, 'z201@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-201', 'label', :O),
  (:AR, 'Artist AR', 'artist-ar-201', 'artist', :X),
  (:L2, 'Label L2', 'label-l2-201', 'label', :Z);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope, cap_grants) VALUES
  (:L, :O, 'owner', '{}', 'org', '{}'),
  (:AR, :X, 'owner', '{}', 'org', '{}'),
  (:L2, :Z, 'owner', '{}', 'org', '{}');
UPDATE public.contacts SET id = :CA WHERE org_id = :AR AND org_self_artist;
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:CL, NULL, :L, 'Ara', 'ara201@local.test', 'artist'),
  (:CB, NULL, :AR, 'Feature', 'feat201@local.test', 'producer');
INSERT INTO public.projects (id, user_id, org_id, name) VALUES (:PA, NULL, :AR, 'Ara EP');
INSERT INTO public.releases (id, org_id, project_id, contact_id, title, created_by, state, imported_released, delivered_at)
  VALUES (:REL, :AR, :PA, :CA, 'Ara single', :X, 'delivered', true, now());
INSERT INTO public.org_connections (id, label_org_id, artist_org_id, initiated_by) VALUES (:CONN, :L, :AR, 'label');
UPDATE public.org_connections SET status = 'active', label_contact_id = :CL, accepted_by = :X, accepted_at = now() WHERE id = :CONN;
INSERT INTO public.listing_consents (org_id, release_id, artist_contact_id, proposed_by) VALUES
  (:AR, :REL, :CA, :X), (:AR, :REL, :CB, :X);

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

SELECT public.check_eq('API roles cannot execute either function',
  (SELECT count(*)::int FROM pg_proc p WHERE p.proname IN ('labelos_audit_consent_decide','labelos_audit_listing_veto')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE') OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))), 0);

-- ── An answer ───────────────────────────────────────────────────────────

SELECT public.check_eq('a yes changes the row',
  (SELECT public.labelos_audit_consent_decide(:AR, :X, :REL, :CA, 'proposed', 'yes', jsonb_build_object('release_artist_id', :CA, 'project_id', :PA), '{"decision":"yes","from":"proposed","withdrew":false}', '{}') ->> 'changed'), 'true');
SELECT public.check_eq('the consent row says who and when',
  (SELECT state || '/' || (decided_by = :X::uuid)::text || '/' || (decided_at IS NOT NULL)::text FROM public.listing_consents WHERE release_id = :REL AND artist_contact_id = :CA), 'yes/true/true');
SELECT public.check_eq('one audit event, internal, filed under the artist',
  (SELECT count(*)::int FROM public.activity_events WHERE org_id = :AR AND verb = 'listing.consent_decided' AND audit AND visibility = 'internal'
     AND subject_id = :REL AND release_id = :REL AND artist_id = :CA AND project_id = :PA AND actor_id = :X
     AND payload = '{"decision":"yes","from":"proposed","withdrew":false}'::jsonb), 1);
SELECT public.check_eq('a repeat from the old state writes nothing (someone answered first)',
  (SELECT public.labelos_audit_consent_decide(:AR, :X, :REL, :CA, 'proposed', 'yes', '{}', '{"decision":"yes"}', '{}') ->> 'changed'), 'false');
SELECT public.check_eq('and no second event',
  (SELECT count(*)::int FROM public.activity_events WHERE org_id = :AR AND verb = 'listing.consent_decided'), 1);

-- An event that cannot be written leaves the row as it was.
SELECT public.check_raises('a secret-looking payload key is refused',
  format($$SELECT public.labelos_audit_consent_decide(%L, %L, %L, %L, 'yes', 'no', '{}', '{"token":"x"}', '{}')$$, 'b2010000-0000-4000-8000-000000000002', 'a2010000-0000-4000-8000-000000000002', 'e2010000-0000-4000-8000-000000000001', 'c2010000-0000-4000-8000-0000000000c2'),
  'secret-looking');
SELECT public.check_raises('an event that fails AFTER the change takes the change with it',
  format($$SELECT public.labelos_audit_consent_decide(%L, %L, %L, %L, 'yes', 'no', '{"project_id":"not-a-uuid"}', '{}', '{}')$$, 'b2010000-0000-4000-8000-000000000002', 'a2010000-0000-4000-8000-000000000002', 'e2010000-0000-4000-8000-000000000001', 'c2010000-0000-4000-8000-0000000000c2'),
  'invalid input syntax for type uuid');
SELECT public.check_eq('the answer is still a yes', (SELECT state FROM public.listing_consents WHERE release_id = :REL AND artist_contact_id = :CA), 'yes');
SELECT public.check_eq('and still one event', (SELECT count(*)::int FROM public.activity_events WHERE org_id = :AR AND verb = 'listing.consent_decided'), 1);

SELECT public.check_eq('an unknown release is not_found',
  (SELECT public.labelos_audit_consent_decide(:AR, :X, 'e2010000-0000-4000-8000-0000000000ff', :CA, 'yes', 'no', '{}', '{}', '{}') ->> 'error'), 'not_found');
SELECT public.check_eq('another org cannot reach the release',
  (SELECT public.labelos_audit_consent_decide(:L2, :Z, :REL, :CA, 'yes', 'no', '{}', '{}', '{}') ->> 'error'), 'not_found');
SELECT public.check_eq('enforcing a no that does not stand is no_row',
  (SELECT public.labelos_audit_consent_decide(:AR, :X, :REL, :CA, NULL, 'no', '{}', '{}', '{}') ->> 'error'), 'no_row');
SELECT public.check_raises('only a no can be enforced',
  format($$SELECT public.labelos_audit_consent_decide(%L, %L, %L, %L, NULL, 'yes', '{}', '{}', '{}')$$, 'b2010000-0000-4000-8000-000000000002', 'a2010000-0000-4000-8000-000000000002', 'e2010000-0000-4000-8000-000000000001', 'c2010000-0000-4000-8000-0000000000c2'),
  'only a no can be enforced');

-- ── A no unlists, in the same transaction ───────────────────────────────

UPDATE public.releases SET store_listed = true, store_listed_at = now(), store_playback = 'full' WHERE id = :REL;
SELECT public.check_eq('yes → no on a listed release changes and unlists',
  (SELECT public.labelos_audit_consent_decide(:AR, :X, :REL, :CA, 'yes', 'no', jsonb_build_object('release_artist_id', :CA, 'project_id', :PA), '{"decision":"no","from":"yes","withdrew":true}', '{"reason":"artist_declined"}')::text),
  '{"changed": true, "unlisted": true}');
SELECT public.check_eq('the release is off the store, playback back to preview',
  (SELECT store_listed::text || '/' || (store_listed_at IS NULL)::text || '/' || store_playback FROM public.releases WHERE id = :REL), 'false/true/preview');
SELECT public.check_eq('the unlist event is audit, artist visibility, filed under the release artist',
  (SELECT count(*)::int FROM public.activity_events WHERE org_id = :AR AND verb = 'release.store_unlisted' AND audit AND visibility = 'artist'
     AND release_id = :REL AND artist_id = :CA AND project_id = :PA AND payload = '{"reason":"artist_declined"}'::jsonb), 1);
SELECT public.check_eq('a no that already stands and a release that is off writes nothing more',
  (SELECT public.labelos_audit_consent_decide(:AR, :X, :REL, :CA, NULL, 'no', '{}', '{}', '{"reason":"artist_declined"}')::text), '{"changed": false, "unlisted": false}');
SELECT public.check_eq('still one unlist event', (SELECT count(*)::int FROM public.activity_events WHERE org_id = :AR AND verb = 'release.store_unlisted'), 1);

-- Enforce: a no whose unlisting did not finish.
UPDATE public.releases SET store_listed = true, store_listed_at = now() WHERE id = :REL;
SELECT public.check_eq('enforcing a standing no unlists a listed release with its event',
  (SELECT public.labelos_audit_consent_decide(:AR, :X, :REL, :CA, NULL, 'no', jsonb_build_object('release_artist_id', :CA, 'project_id', :PA), '{}', '{"reason":"artist_declined"}')::text), '{"changed": false, "unlisted": true}');
SELECT public.check_eq('and no consent event for it', (SELECT count(*)::int FROM public.activity_events WHERE org_id = :AR AND verb = 'listing.consent_decided'), 2);
SELECT public.check_eq('two unlist events now', (SELECT count(*)::int FROM public.activity_events WHERE org_id = :AR AND verb = 'release.store_unlisted'), 2);

-- A failing unlist event takes the whole answer with it (the answer, the unlisting and the first event).
UPDATE public.releases SET store_listed = true, store_listed_at = now() WHERE id = :REL;
SELECT public.labelos_audit_consent_decide(:AR, :X, :REL, :CA, 'no', 'yes', '{}', '{"decision":"yes"}', '{}');
SELECT public.check_raises('a failing unlist event rolls the answer back',
  format($$SELECT public.labelos_audit_consent_decide(%L, %L, %L, %L, 'yes', 'no', '{}', '{"decision":"no"}', '{"token":"x"}')$$, 'b2010000-0000-4000-8000-000000000002', 'a2010000-0000-4000-8000-000000000002', 'e2010000-0000-4000-8000-000000000001', 'c2010000-0000-4000-8000-0000000000c2'),
  'secret-looking');
SELECT public.check_eq('the yes stands and the release is still listed',
  (SELECT (SELECT state FROM public.listing_consents WHERE release_id = :REL AND artist_contact_id = :CA) || '/' || store_listed::text FROM public.releases WHERE id = :REL), 'yes/true');
-- Another artist's no does not unlist on this artist's yes.
SELECT public.check_eq('a yes never unlists',
  (SELECT public.labelos_audit_consent_decide(:AR, :X, :REL, :CB, 'proposed', 'yes', '{}', '{"decision":"yes"}', '{}')::text), '{"changed": true, "unlisted": false}');
SELECT public.check_eq('the release is still listed', (SELECT store_listed FROM public.releases WHERE id = :REL), true);

-- ── The store owner's veto ──────────────────────────────────────────────

SELECT public.check_eq('a veto is made',
  (SELECT public.labelos_audit_listing_veto(:L, :O, :REL, true, '{"listed":false}', jsonb_build_object('artist_id', :CA, 'project_id', :PA), '{"listed":false}') ->> 'changed'), 'true');
SELECT public.check_eq('the veto row names the label and who',
  (SELECT org_id::text || '/' || vetoed_by::text FROM public.store_listing_vetoes WHERE release_id = :REL), 'b2010000-0000-4000-8000-000000000001/a2010000-0000-4000-8000-000000000001');
SELECT public.check_eq('the label org holds the audit event (internal, no artist keys)',
  (SELECT count(*)::int FROM public.activity_events WHERE org_id = :L AND verb = 'listing.vetoed' AND audit AND visibility = 'internal' AND release_id = :REL AND artist_id IS NULL AND actor_id = :O), 1);
SELECT public.check_eq('and the artist org a copy filed under its artist and project',
  (SELECT count(*)::int FROM public.activity_events WHERE org_id = :AR AND verb = 'listing.vetoed' AND audit AND release_id = :REL AND artist_id = :CA AND project_id = :PA AND actor_id = :O), 1);
SELECT public.check_eq('a repeat veto changes nothing',
  (SELECT public.labelos_audit_listing_veto(:L, :O, :REL, true, '{}', '{}', '{}') ->> 'changed'), 'false');
SELECT public.check_eq('and writes no event', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'listing.vetoed'), 2);

SELECT public.check_eq('an org with no active connection is not_connected',
  (SELECT public.labelos_audit_listing_veto(:L2, :Z, :REL, true, '{}', '{}', '{}') ->> 'error'), 'not_connected');
SELECT public.check_eq('an unknown release is not_found',
  (SELECT public.labelos_audit_listing_veto(:L, :O, 'e2010000-0000-4000-8000-0000000000ff', true, '{}', '{}', '{}') ->> 'error'), 'not_found');

SELECT public.check_eq('lifting a veto',
  (SELECT public.labelos_audit_listing_veto(:L, :O, :REL, false, '{"listed":true}', jsonb_build_object('artist_id', :CA, 'project_id', :PA), '{"listed":true}') ->> 'changed'), 'true');
SELECT public.check_eq('removes the row', (SELECT count(*)::int FROM public.store_listing_vetoes WHERE release_id = :REL), 0);
SELECT public.check_eq('and writes both events',
  (SELECT count(*)::int FROM public.activity_events WHERE verb = 'listing.veto_lifted' AND audit AND release_id = :REL), 2);
SELECT public.check_eq('lifting again changes nothing',
  (SELECT public.labelos_audit_listing_veto(:L, :O, :REL, false, '{}', '{}', '{}') ->> 'changed'), 'false');
SELECT public.check_eq('and writes no event', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'listing.veto_lifted'), 2);

-- A failing event leaves no veto (and a failing lift leaves the veto in place).
SELECT public.check_raises('an event that fails after the insert takes the veto with it',
  format($$SELECT public.labelos_audit_listing_veto(%L, %L, %L, true, '{}', '{"artist_id":"not-a-uuid"}', '{}')$$, 'b2010000-0000-4000-8000-000000000001', 'a2010000-0000-4000-8000-000000000001', 'e2010000-0000-4000-8000-000000000001'),
  'invalid input syntax for type uuid');
SELECT public.check_eq('no veto was left behind', (SELECT count(*)::int FROM public.store_listing_vetoes WHERE release_id = :REL), 0);
SELECT public.labelos_audit_listing_veto(:L, :O, :REL, true, '{}', '{}', '{}');
SELECT public.check_raises('a failing lift leaves the veto in place',
  format($$SELECT public.labelos_audit_listing_veto(%L, %L, %L, false, '{"token":"x"}', '{}', '{}')$$, 'b2010000-0000-4000-8000-000000000001', 'a2010000-0000-4000-8000-000000000001', 'e2010000-0000-4000-8000-000000000001'),
  'secret-looking');
SELECT public.check_eq('the veto stands', (SELECT count(*)::int FROM public.store_listing_vetoes WHERE release_id = :REL), 1);

DROP FUNCTION public.check_eq(text, anyelement, anyelement);
DROP FUNCTION public.check_raises(text, text, text);
