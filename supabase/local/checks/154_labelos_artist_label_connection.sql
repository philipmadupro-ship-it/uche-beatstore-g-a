-- Behaviour checks for 154_labelos_artist_label_connection.sql, run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- Cast:
--   artist org A1 : owner AO1 (+ member AM1, role member)   — projects AP1, AP2; track AS1 in AP1
--   artist org A2 : owner AO2                               — project BP1
--   label  org L  : owner OWN; AR (A&R, whole org); SC (A&R, scoped to a
--                   DIFFERENT roster artist, so not to the connection's
--                   contact); MKT (marketing)
--   label  org L2 : owner X2
--   NOBODY        : no membership anywhere
-- The point of this file: the connection is the ONLY way a label member
-- reaches an artist org's project, and only the projects the ARTIST shared;
-- ending it ends the reach; nothing about the artist org (members, contacts,
-- activity, files, other projects) opens through it; every audit function
-- does its mutation AND its events in one transaction, service_role only.

\set OWN  '''a1540000-0000-4000-8000-000000000001'''
\set AR   '''a1540000-0000-4000-8000-000000000002'''
\set SC   '''a1540000-0000-4000-8000-000000000003'''
\set MKT  '''a1540000-0000-4000-8000-000000000004'''
\set X2   '''a1540000-0000-4000-8000-000000000005'''
\set AO1  '''a1540000-0000-4000-8000-000000000011'''
\set AM1  '''a1540000-0000-4000-8000-000000000012'''
\set AO2  '''a1540000-0000-4000-8000-000000000013'''
\set NOBODY '''a1540000-0000-4000-8000-000000000021'''
\set SADM '''a1540000-0000-4000-8000-000000000022'''
\set L    '''b1540000-0000-4000-8000-000000000001'''
\set L2   '''b1540000-0000-4000-8000-000000000002'''
\set A1   '''b1540000-0000-4000-8000-000000000011'''
\set A2   '''b1540000-0000-4000-8000-000000000012'''
\set LC_OTHER '''c1540000-0000-4000-8000-0000000000c9'''
\set LC_OTHER_X '''c1540000-0000-4000-8000-0000000000d9'''
\set AP1  '''d1540000-0000-4000-8000-000000000011'''
\set AP2  '''d1540000-0000-4000-8000-000000000012'''
\set BP1  '''d1540000-0000-4000-8000-000000000021'''
\set LP1  '''d1540000-0000-4000-8000-000000000031'''
\set PP1  '''d1540000-0000-4000-8000-000000000041'''
\set AS1  '''e1540000-0000-4000-8000-000000000011'''

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (:OWN, 'own154@local.test', now()), (:AR, 'ar154@local.test', now()), (:SC, 'sc154@local.test', now()),
  (:MKT, 'mkt154@local.test', now()), (:X2, 'x2154@local.test', now()),
  (:AO1, 'ao1154@local.test', now()), (:AM1, 'am1154@local.test', now()), (:AO2, 'ao2154@local.test', now()),
  (:NOBODY, 'nobody154@local.test', now()), (:SADM, 'sadm154@local.test', now());
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-154', 'label', :OWN),
  (:L2, 'Label L2', 'label-l2-154', 'label', :X2),
  (:A1, 'Nova', 'nova-154', 'artist', :AO1),
  (:A2, 'Kilo', 'kilo-154', 'artist', :AO2);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :OWN, 'owner', '{}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org'),
  (:L, :SC, 'member', '{a_and_r}', 'artists'),
  (:L, :MKT, 'member', '{marketing}', 'org'),
  (:L, :SADM, 'admin', '{}', 'artists'),
  (:L2, :X2, 'owner', '{}', 'org'),
  (:A1, :AO1, 'owner', '{}', 'org'),
  (:A1, :AM1, 'member', '{}', 'org'),
  (:A2, :AO2, 'owner', '{}', 'org');
-- A different roster artist of L, the one SC is limited to.
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:LC_OTHER, NULL, :L, 'Someone else', 'else154@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :SC, :LC_OTHER);
INSERT INTO public.projects (id, user_id, org_id, name) VALUES
  (:AP1, NULL, :A1, 'Nova demos'),
  (:AP2, NULL, :A1, 'Nova private'),
  (:BP1, NULL, :A2, 'Kilo project'),
  (:LP1, NULL, :L, 'Label project');
INSERT INTO public.projects (id, user_id, name) VALUES (:PP1, '0b0e1a57-0000-4000-8000-000000000001', 'Producer project');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:AS1, NULL, :A1, :AO1, 'Nova demo', 'song', 'r2://private/as1', 'inbox');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES (:AP1, :AS1, 0);

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
CREATE FUNCTION public.as_user(p_user text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
CREATE FUNCTION public.rows_seen(stmt text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE format('SELECT count(*) FROM (%s) q', stmt) INTO n;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.as_user(text), public.rows_seen(text) TO anon, authenticated, service_role;

-- ── Shape, grants, constraints ──────────────────────────────────────────

SELECT public.check_eq('RLS is on (org_connections)', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.org_connections'::regclass), true);
SELECT public.check_eq('RLS is on (connection_projects)', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.connection_projects'::regclass), true);
SELECT public.check_eq('the API roles have SELECT and nothing else on both tables',
  (SELECT string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' ORDER BY table_name, grantee, privilege_type)
   FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name IN ('org_connections', 'connection_projects') AND grantee IN ('anon', 'authenticated')),
  'connection_projects:authenticated:SELECT');
SELECT public.check_eq('org_connections: authenticated has SELECT on columns only, never on the actor columns, and no write',
  (SELECT string_agg(privilege_type || ':' || column_name, ',' ORDER BY column_name)
   FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'org_connections' AND grantee = 'authenticated'
     AND column_name IN ('requested_by', 'accepted_by', 'ended_by', 'status')),
  'SELECT:status');

SELECT public.check_raises('an artist org cannot be the label side',
  format($$INSERT INTO public.org_connections (label_org_id, artist_org_id, initiated_by) VALUES (%L, %L, 'label')$$, 'b1540000-0000-4000-8000-000000000011', 'b1540000-0000-4000-8000-000000000012'),
  'not a label organization');
SELECT public.check_raises('a label org cannot be the artist side',
  format($$INSERT INTO public.org_connections (label_org_id, artist_org_id, initiated_by) VALUES (%L, %L, 'label')$$, 'b1540000-0000-4000-8000-000000000001', 'b1540000-0000-4000-8000-000000000002'),
  'not an artist organization');
SELECT public.check_raises('a connection starts as a request',
  format($$INSERT INTO public.org_connections (label_org_id, artist_org_id, initiated_by, status) VALUES (%L, %L, 'label', 'active')$$, 'b1540000-0000-4000-8000-000000000001', 'b1540000-0000-4000-8000-000000000011'),
  'starts as a request');

-- ── request → events in BOTH orgs, one transaction ──────────────────────

SELECT public.check_eq('a request to an unknown slug is not_found',
  (public.labelos_audit_connection_request(:L, :OWN, 'label', 'no-such-org', NULL, NULL, '{}'))->>'error', 'not_found');
SELECT public.check_eq('a request to a label slug (wrong kind) reads the same',
  (public.labelos_audit_connection_request(:L, :OWN, 'label', 'label-l2-154', NULL, NULL, '{}'))->>'error', 'not_found');
SELECT public.check_eq('an email that owns no artist org reads the same',
  (public.labelos_audit_connection_request(:L, :OWN, 'label', NULL, 'nobody154@local.test', NULL, '{}'))->>'error', 'not_found');
SELECT public.check_eq('an artist org cannot ask AS a label',
  (public.labelos_audit_connection_request(:A1, :AO1, 'label', 'nova-154', NULL, NULL, '{}'))->>'error', 'not_found');
SELECT public.check_eq('a contact of another org is refused',
  (public.labelos_audit_connection_request(:A1, :AO1, 'artist', 'label-l-154', NULL, :LC_OTHER, '{}'))->>'error', 'bad_contact');
SELECT public.check_eq('a bad contact answers the same for an existing target and a missing one (no existence oracle)',
  ((public.labelos_audit_connection_request(:L, :OWN, 'label', 'nova-154', NULL, :LC_OTHER_X, '{}'))->>'error')
  || ((public.labelos_audit_connection_request(:L, :OWN, 'label', 'no-such-org', NULL, :LC_OTHER_X, '{}'))->>'error')
  || ((public.labelos_audit_connection_request(:L, :OWN, 'label', NULL, 'nobody154@local.test', :LC_OTHER_X, '{}'))->>'error'),
  'bad_contactbad_contactbad_contact');
SELECT public.check_eq('no event, no row for any refusal',
  (SELECT count(*)::int FROM public.org_connections) + (SELECT count(*)::int FROM public.activity_events WHERE verb LIKE 'connection.%'), 0);

CREATE TEMP TABLE conn(id uuid);
INSERT INTO conn SELECT (((public.labelos_audit_connection_request(:L, :OWN, 'label', NULL, 'ao1154@local.test', NULL,
  '{"note":"hello"}'))->'connection'->>'id'))::uuid;
SELECT public.check_eq('the label found the artist org by the email of its owner',
  (SELECT (artist_org_id::text, status, initiated_by, share_mode, allow_copies)::text FROM public.org_connections),
  '(b1540000-0000-4000-8000-000000000011,requested,label,selected,f)');
SELECT public.check_eq('connection.requested is recorded in BOTH orgs, as an audit row',
  (SELECT string_agg(org_id::text, ',' ORDER BY org_id) FROM public.activity_events WHERE verb = 'connection.requested' AND audit AND visibility = 'internal' AND subject_id = (SELECT id FROM conn)),
  'b1540000-0000-4000-8000-000000000001,b1540000-0000-4000-8000-000000000011');
SELECT public.check_eq('the event carries both names and no secret',
  (SELECT payload->>'label' || '/' || (payload->>'artist') FROM public.activity_events WHERE verb = 'connection.requested' AND org_id = :L), 'Label L/Nova');
SELECT public.check_eq('a second request for the same pair is pending, not stacked',
  (public.labelos_audit_connection_request(:L, :OWN, 'label', 'nova-154', NULL, NULL, '{}'))->>'error', 'pending');
SELECT public.check_eq('...from the artist side too',
  (public.labelos_audit_connection_request(:A1, :AO1, 'artist', 'label-l-154', NULL, NULL, '{}'))->>'error', 'pending');
SELECT public.check_raises('the unique index allows ONE open connection per pair',
  format($$INSERT INTO public.org_connections (label_org_id, artist_org_id, initiated_by) VALUES (%L, %L, 'artist')$$, 'b1540000-0000-4000-8000-000000000001', 'b1540000-0000-4000-8000-000000000011'),
  'duplicate key');

-- Nothing is reachable while it is only a request.
SELECT public.check_eq('a requested connection shares nothing yet',
  (SELECT count(*)::int FROM public.org_connections WHERE status = 'active'), 0);
SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('can_see_via_connection is false while requested', public.can_see_via_connection(:AP1), false);
RESET ROLE;

-- ── accept ──────────────────────────────────────────────────────────────

SELECT public.check_eq('the label cannot accept its own request',
  (public.labelos_audit_connection_accept(:L, :OWN, (SELECT id FROM conn), '{}'))->>'error', 'not_found');
SELECT public.check_eq('a third org cannot accept it',
  (public.labelos_audit_connection_accept(:A2, :AO2, (SELECT id FROM conn), '{}'))->>'error', 'not_found');
SELECT public.check_eq('the artist org accepts; a roster contact is created for the label',
  (public.labelos_audit_connection_accept(:A1, :AO1, (SELECT id FROM conn), '{}'))->'connection'->>'status', 'active');
SELECT public.check_eq('the roster contact is a contact of the LABEL and points at the artist org',
  (SELECT (c.org_id::text, c.artist_org_id::text, c.name, c.user_id IS NULL)::text
   FROM public.org_connections oc JOIN public.contacts c ON c.id = oc.label_contact_id),
  '(b1540000-0000-4000-8000-000000000001,b1540000-0000-4000-8000-000000000011,Nova,t)');
SELECT public.check_eq('connection.accepted is recorded in both orgs',
  (SELECT count(*)::int FROM public.activity_events WHERE verb = 'connection.accepted' AND audit AND subject_id = (SELECT id FROM conn)), 2);
SELECT public.check_eq('accepting twice finds nothing',
  (public.labelos_audit_connection_accept(:A1, :AO1, (SELECT id FROM conn), '{}'))->>'error', 'not_found');

-- ── contacts.artist_org_id cannot be forged ─────────────────────────────

SELECT public.check_raises('a contact cannot point at an artist org it has no open connection with',
  format($$UPDATE public.contacts SET artist_org_id = %L WHERE id = %L$$, 'b1540000-0000-4000-8000-000000000012', 'c1540000-0000-4000-8000-0000000000c9'),
  'needs an open connection');
SELECT public.check_raises('one roster contact per artist org',
  format($$INSERT INTO public.contacts (org_id, user_id, name, category, artist_org_id) VALUES (%L, NULL, 'Dup', 'artist', %L)$$, 'b1540000-0000-4000-8000-000000000001', 'b1540000-0000-4000-8000-000000000011'),
  'duplicate key');
SELECT public.check_raises('a producer contact cannot carry an artist org',
  format($$INSERT INTO public.contacts (user_id, name, artist_org_id) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'P', %L)$$, 'b1540000-0000-4000-8000-000000000011'),
  'contacts_artist_org_is_org_contact|needs an open connection');
SELECT public.check_raises('the connected roster contact cannot be deleted from under the connection',
  format($$DELETE FROM public.contacts WHERE id = (SELECT label_contact_id FROM public.org_connections WHERE artist_org_id = %L)$$, 'b1540000-0000-4000-8000-000000000011'),
  'violates foreign key');

-- ── the artist's share ──────────────────────────────────────────────────

SELECT public.check_eq('nothing is shared until the artist chooses (selected, empty)',
  (SELECT count(*)::int FROM public.connection_projects), 0);
SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('...so a connected A&R reaches no project', public.can_see_via_connection(:AP1) OR public.can_see_via_connection(:AP2), false);
RESET ROLE;

SELECT public.check_eq('only the ARTIST side can change what is shared (the label org is not found)',
  (public.labelos_audit_connection_share(:L, :OWN, (SELECT id FROM conn), '{"share_mode":"all"}', NULL, '{}'))->>'error', 'not_found');
SELECT public.check_eq('a project of another org cannot be shared',
  (public.labelos_audit_connection_share(:A1, :AO1, (SELECT id FROM conn), '{}', ARRAY[:BP1]::uuid[], '{}'))->>'error', 'bad_project');
SELECT public.check_eq('a producer project cannot be shared',
  (public.labelos_audit_connection_share(:A1, :AO1, (SELECT id FROM conn), '{}', ARRAY[:PP1]::uuid[], '{}'))->>'error', 'bad_project');
SELECT public.check_eq('a label project cannot be shared',
  (public.labelos_audit_connection_share(:A1, :AO1, (SELECT id FROM conn), '{}', ARRAY[:LP1]::uuid[], '{}'))->>'error', 'bad_project');
SELECT public.check_eq('...and none of those wrote anything', (SELECT count(*)::int FROM public.connection_projects), 0);

SELECT public.check_eq('the artist shares one project',
  (public.labelos_audit_connection_share(:A1, :AO1, (SELECT id FROM conn), '{}', ARRAY[:AP1]::uuid[], '{}'))->'project_ids'->>0, 'd1540000-0000-4000-8000-000000000011');
SELECT public.check_eq('...recorded as share.created in the ARTIST org only',
  (SELECT string_agg(org_id::text, ',') FROM public.activity_events WHERE verb = 'share.created' AND payload->>'via' = 'connection'), 'b1540000-0000-4000-8000-000000000011');

SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('a connected A&R reaches the shared project', public.can_see_via_connection(:AP1), true);
SELECT public.check_eq('...and not the artist''s other project', public.can_see_via_connection(:AP2), false);
SELECT public.check_eq('...not another artist org''s', public.can_see_via_connection(:BP1), false);
SELECT public.check_eq('...not a producer project', public.can_see_via_connection(:PP1), false);
SELECT public.as_user(:OWN);
SELECT public.check_eq('the label owner too', public.can_see_via_connection(:AP1), true);
SELECT public.as_user(:MKT);
SELECT public.check_eq('marketing holds catalog.read, so the project is reachable (audio classes still apply in the route)', public.can_see_via_connection(:AP1), true);
SELECT public.as_user(:SC);
SELECT public.check_eq('a member scoped to ANOTHER roster artist does not reach it', public.can_see_via_connection(:AP1), false);
SELECT public.as_user(:X2);
SELECT public.check_eq('another label does not', public.can_see_via_connection(:AP1), false);
SELECT public.as_user(:NOBODY);
SELECT public.check_eq('a stranger does not', public.can_see_via_connection(:AP1), false);
SELECT public.as_user(:AO1);
SELECT public.check_eq('the artist owner is not a label member (the function answers for the label side only)', public.can_see_via_connection(:AP1), false);
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon does not', public.can_see_via_connection(:AP1), false);
RESET ROLE;

-- Mode `all` covers every project of the artist org (and still no one else's).
SELECT public.check_eq('mode all is a widening (share.created)',
  (public.labelos_audit_connection_share(:A1, :AO1, (SELECT id FROM conn), '{"share_mode":"all","allow_copies":true}', NULL, '{}'))->'connection'->>'share_mode', 'all');
SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('all: the other project of the artist org is reachable', public.can_see_via_connection(:AP2), true);
SELECT public.check_eq('all: another artist org''s still is not', public.can_see_via_connection(:BP1), false);
RESET ROLE;
SELECT public.check_eq('narrowing back is share.revoked',
  (SELECT 1 FROM (SELECT public.labelos_audit_connection_share(:A1, :AO1, (SELECT id FROM conn), '{"share_mode":"selected"}', ARRAY[:AP1]::uuid[], '{}')) q),
  1);
SELECT public.check_eq('...as share.revoked in the artist org',
  (SELECT count(*)::int FROM public.activity_events WHERE verb = 'share.revoked' AND org_id = :A1), 1);
SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('selected again: AP2 is out', public.can_see_via_connection(:AP2), false);
RESET ROLE;

-- Real verbs, no revived rows.
SELECT public.check_eq('an unchanged share records nothing',
  (SELECT 1 FROM (SELECT public.labelos_audit_connection_share(:A1, :AO1, (SELECT id FROM conn), '{}', ARRAY[:AP1]::uuid[], '{}')) q)
  * 0 + (SELECT count(*)::int FROM public.activity_events WHERE verb IN ('share.created', 'share.revoked') AND org_id = :A1),
  (SELECT count(*)::int FROM public.activity_events WHERE verb IN ('share.created', 'share.revoked') AND org_id = :A1));
CREATE TEMP TABLE share_events AS SELECT count(*)::int AS n FROM public.activity_events WHERE verb IN ('share.created', 'share.revoked') AND org_id = :A1;
SELECT public.labelos_audit_connection_share(:A1, :AO1, (SELECT id FROM conn), '{}', ARRAY[:AP1]::uuid[], '{}');
SELECT public.check_eq('...again: still nothing new',
  (SELECT count(*)::int FROM public.activity_events WHERE verb IN ('share.created', 'share.revoked') AND org_id = :A1), (SELECT n FROM share_events));
SELECT public.labelos_audit_connection_share(:A1, :AO1, (SELECT id FROM conn), '{"allow_copies":false}', NULL, '{}');
SELECT public.check_eq('turning copies OFF is a revocation',
  (SELECT verb FROM public.activity_events WHERE org_id = :A1 AND verb IN ('share.created', 'share.revoked') ORDER BY created_at DESC, id DESC LIMIT 1), 'share.revoked');
SELECT public.labelos_audit_connection_share(:A1, :AO1, (SELECT id FROM conn), '{"allow_copies":true}', NULL, '{}');
SELECT public.check_eq('turning copies ON widens',
  (SELECT verb FROM public.activity_events WHERE org_id = :A1 AND verb IN ('share.created', 'share.revoked') ORDER BY created_at DESC, id DESC LIMIT 1), 'share.created');
SELECT public.labelos_audit_connection_share(:A1, :AO1, (SELECT id FROM conn), '{"share_mode":"all"}', NULL, '{}');
SELECT public.labelos_audit_connection_share(:A1, :AO1, (SELECT id FROM conn), '{"share_mode":"selected"}', NULL, '{}');
SELECT public.check_eq('all → selected without ids shares NOTHING (old rows do not come back)',
  (SELECT count(*)::int FROM public.connection_projects), 0);
SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('...so AP1 is unreachable again', public.can_see_via_connection(:AP1), false);
RESET ROLE;
SELECT public.labelos_audit_connection_share(:A1, :AO1, (SELECT id FROM conn), '{}', ARRAY[:AP1]::uuid[], '{}');

-- A scoped admin reads no connection with their own JWT; columns of the other side's people are not readable.
SET ROLE authenticated;
SELECT public.as_user(:SADM);
SELECT public.check_eq('an admin limited to some artists reads no connection', public.rows_seen('SELECT 1 FROM public.org_connections'), 0);
SELECT public.as_user(:OWN);
SELECT public.check_raises('nobody reads requested_by', 'SELECT requested_by FROM public.org_connections', 'permission denied');
SELECT public.check_raises('...nor accepted_by', 'SELECT accepted_by FROM public.org_connections', 'permission denied');
SELECT public.check_raises('...nor ended_by', 'SELECT ended_by FROM public.org_connections', 'permission denied');
SELECT public.check_eq('...but the connection itself reads', public.rows_seen('SELECT id, status, share_mode FROM public.org_connections'), 1);
RESET ROLE;

-- ── nothing else of the artist org opens through the connection ─────────

SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('a label member''s own JWT reads no project of the artist org', public.rows_seen($q$SELECT 1 FROM public.projects WHERE org_id = 'b1540000-0000-4000-8000-000000000011'$q$), 0);
SELECT public.check_eq('...no track', public.rows_seen($q$SELECT 1 FROM public.tracks WHERE org_id = 'b1540000-0000-4000-8000-000000000011'$q$), 0);
SELECT public.check_eq('...no contact of the artist org', public.rows_seen($q$SELECT 1 FROM public.contacts WHERE org_id = 'b1540000-0000-4000-8000-000000000011'$q$), 0);
SELECT public.check_eq('...no member of it', public.rows_seen($q$SELECT 1 FROM public.org_members WHERE org_id = 'b1540000-0000-4000-8000-000000000011'$q$), 0);
SELECT public.check_eq('...none of its activity', public.rows_seen($q$SELECT 1 FROM public.activity_events WHERE org_id = 'b1540000-0000-4000-8000-000000000011'$q$), 0);
SELECT public.check_eq('...and not what it chose to share (connection_projects is the artist side''s)', public.rows_seen('SELECT 1 FROM public.connection_projects'), 0);
SELECT public.check_eq('an A&R (not owner / admin) does not even read the connection row', public.rows_seen('SELECT 1 FROM public.org_connections'), 0);
SELECT public.as_user(:OWN);
SELECT public.check_eq('the label owner reads the connection row', public.rows_seen('SELECT 1 FROM public.org_connections'), 1);
SELECT public.check_eq('...but not the artist''s shared list', public.rows_seen('SELECT 1 FROM public.connection_projects'), 0);
SELECT public.as_user(:AO1);
SELECT public.check_eq('the artist owner reads the connection and the shared list', public.rows_seen('SELECT 1 FROM public.org_connections') * 10 + public.rows_seen('SELECT 1 FROM public.connection_projects'), 11);
SELECT public.check_eq('...and reaches no label object', public.rows_seen($q$SELECT 1 FROM public.projects WHERE org_id = 'b1540000-0000-4000-8000-000000000001'$q$)
  + public.rows_seen($q$SELECT 1 FROM public.contacts WHERE org_id = 'b1540000-0000-4000-8000-000000000001'$q$), 0);
SELECT public.as_user(:AM1);
SELECT public.check_eq('an ordinary artist-org member reads no connection', public.rows_seen('SELECT 1 FROM public.org_connections'), 0);
SELECT public.as_user(:X2);
SELECT public.check_eq('another label reads no connection', public.rows_seen('SELECT 1 FROM public.org_connections'), 0);
SELECT public.as_user(:NOBODY);
SELECT public.check_eq('a stranger reads none', public.rows_seen('SELECT 1 FROM public.org_connections') + public.rows_seen('SELECT 1 FROM public.connection_projects'), 0);
SELECT public.check_raises('no API role writes a connection',
  $$UPDATE public.org_connections SET share_mode = 'all'$$, 'permission denied');
SELECT public.check_raises('...or its shared list',
  format($$INSERT INTO public.connection_projects (connection_id, project_id, org_id) SELECT id, %L, %L FROM public.org_connections$$, 'd1540000-0000-4000-8000-000000000012', 'b1540000-0000-4000-8000-000000000011'),
  'permission denied');
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_raises('anon reads nothing', 'SELECT 1 FROM public.org_connections', 'permission denied');
RESET ROLE;

-- R-08: the connection policies plan as hashed subplans.
CREATE FUNCTION public.plan_filters(q text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r text; filters text := '';
BEGIN
  FOR r IN EXECUTE 'EXPLAIN (COSTS OFF) ' || q LOOP
    IF r ~ 'Filter:' THEN filters := r; EXIT; END IF;
  END LOOP;
  RETURN filters;
END $$;
GRANT EXECUTE ON FUNCTION public.plan_filters(text) TO authenticated;
SET ROLE authenticated;
SELECT public.as_user(:OWN);
SELECT public.check_eq('org_connections plans its membership test as a hashed subplan',
  public.plan_filters('SELECT id, status FROM public.org_connections') ~ 'hashed SubPlan', true);
SELECT public.check_eq('...with no per-row SECURITY DEFINER call',
  public.plan_filters('SELECT id, status FROM public.org_connections') ~ '(?<!hashed )SubPlan|can_see_|has_org_cap|org_role', false);
SELECT public.as_user(:AO1);
SELECT public.check_eq('connection_projects plans as a hashed subplan too',
  public.plan_filters('SELECT * FROM public.connection_projects') ~ 'hashed SubPlan', true);
RESET ROLE;

-- ── provenance ──────────────────────────────────────────────────────────

SELECT public.check_raises('a producer track has no provenance',
  $$INSERT INTO public.tracks (user_id, title, type, audio_url, provenance) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'x', 'beat', 'r2://x', '{"source_track_id":"a","copied_at":"now","copied_by":"b"}')$$,
  'tracks_provenance_shape');
SELECT public.check_raises('provenance must name its source, time and copier',
  format($$INSERT INTO public.tracks (user_id, org_id, created_by, title, type, audio_url, provenance) VALUES (NULL, %L, %L, 'x', 'beat', 'r2://x', '{"source_track_id":"a"}')$$, 'b1540000-0000-4000-8000-000000000001', 'a1540000-0000-4000-8000-000000000001'),
  'tracks_provenance_shape');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, provenance) VALUES
  ('e1540000-0000-4000-8000-000000000099', NULL, :L, :OWN, 'Copied beat', 'beat', 'r2://private/orgs/x',
   jsonb_build_object('source_org_id', :A1::text, 'source_track_id', :AS1::text, 'copied_at', now(), 'copied_by', :OWN::text));
SELECT public.check_raises('a copy''s provenance never changes',
  $$UPDATE public.tracks SET provenance = provenance || '{"x":1}' WHERE id = 'e1540000-0000-4000-8000-000000000099'$$, 'cannot change');
SELECT public.check_raises('...nor is removed',
  $$UPDATE public.tracks SET provenance = NULL WHERE id = 'e1540000-0000-4000-8000-000000000099'$$, 'cannot change');
SELECT public.check_eq('the source is unchanged (it is a copy, not a reference)',
  (SELECT (org_id::text, audio_url, provenance IS NULL)::text FROM public.tracks WHERE id = :AS1), '(b1540000-0000-4000-8000-000000000011,r2://private/as1,t)');

-- ── end: access goes on the next read, the contact is released ──────────

SELECT public.check_eq('the artist org cannot end a connection it is not in',
  (public.labelos_audit_connection_end(:A2, :AO2, (SELECT id FROM conn), '{}'))->>'error', 'not_found');
SELECT public.check_eq('a stranger org: not found',
  (public.labelos_audit_connection_end(:L2, :X2, (SELECT id FROM conn), '{}'))->>'error', 'not_found');
SELECT public.check_eq('either side may end it: the label does',
  (public.labelos_audit_connection_end(:L, :OWN, (SELECT id FROM conn), '{}'))->'connection'->>'status', 'ended');
SELECT public.check_eq('connection.ended is recorded in both orgs',
  (SELECT count(*)::int FROM public.activity_events WHERE verb = 'connection.ended' AND audit AND subject_id = (SELECT id FROM conn)), 2);
SELECT public.check_eq('the shared list is gone', (SELECT count(*)::int FROM public.connection_projects), 0);
SELECT public.check_eq('an ended connection holds no roster contact (the contact can be deleted again)',
  (SELECT label_contact_id IS NULL FROM public.org_connections WHERE id = (SELECT id FROM conn)), true);
SELECT public.check_eq('the roster contact stays, and stops pointing at the artist org',
  (SELECT (artist_org_id IS NULL)::text FROM public.contacts WHERE name = 'Nova' AND org_id = :L), 'true');
SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('after the end the A&R reaches nothing', public.can_see_via_connection(:AP1) OR public.can_see_via_connection(:AP2), false);
RESET ROLE;
SELECT public.check_eq('an ended connection cannot be accepted, shared or ended again',
  ((public.labelos_audit_connection_accept(:A1, :AO1, (SELECT id FROM conn), '{}'))->>'error')
  || ((public.labelos_audit_connection_share(:A1, :AO1, (SELECT id FROM conn), '{"share_mode":"all"}', NULL, '{}'))->>'error')
  || ((public.labelos_audit_connection_end(:A1, :AO1, (SELECT id FROM conn), '{}'))->>'error'),
  'not_foundnot_foundnot_found');
SELECT public.check_raises('an ended connection never comes back',
  format($$UPDATE public.org_connections SET status = 'active' WHERE id = %L$$, (SELECT id FROM conn)), 'is not a valid move');

-- A fresh request after the end is allowed (the unique index covers only open ones).
SELECT public.check_eq('after an end the pair can connect again',
  (public.labelos_audit_connection_request(:A1, :AO1, 'artist', 'label-l-154', NULL, NULL, '{}'))->'connection'->>'status', 'requested');
SELECT public.check_eq('...and the label declining it records declined',
  (public.labelos_audit_connection_end(:L, :OWN,
     (SELECT id FROM public.org_connections WHERE status = 'requested'), '{}'))->'connection'->>'status', 'declined');
SELECT public.check_eq('the starter withdrawing its own request records ended',
  (public.labelos_audit_connection_end(:A1, :AO1,
     ((public.labelos_audit_connection_request(:A1, :AO1, 'artist', 'label-l-154', NULL, NULL, '{}'))->'connection'->>'id')::uuid, '{}'))->'connection'->>'status', 'ended');

-- The artist org asking a label that names an existing roster contact is the
-- label's own business: only the label side may pick one.
SELECT public.check_eq('an artist-initiated request accepted by the label creates the roster contact',
  (public.labelos_audit_connection_accept(:L, :OWN,
     ((public.labelos_audit_connection_request(:A1, :AO1, 'artist', 'label-l-154', NULL, NULL, '{}'))->'connection'->>'id')::uuid, '{}'))->'connection'->>'status', 'active');
SELECT public.check_eq('a label may name an existing roster contact when it asks',
  (public.labelos_audit_connection_request(:L, :OWN, 'label', 'kilo-154', NULL, :LC_OTHER, '{}'))->'connection'->>'label_contact_id', 'c1540000-0000-4000-8000-0000000000c9');
SELECT public.check_eq('...which then stands for that artist org once accepted',
  (public.labelos_audit_connection_accept(:A2, :AO2, (SELECT id FROM public.org_connections WHERE artist_org_id = :A2 AND status = 'requested'), '{}'))->'connection'->>'status', 'active');
SELECT public.check_eq('the contact now carries the org', (SELECT artist_org_id::text FROM public.contacts WHERE id = :LC_OTHER), 'b1540000-0000-4000-8000-000000000012');

-- ── Grants on the new functions ─────────────────────────────────────────

SELECT public.check_eq('execute grants on ' || p.oid::regprocedure::text,
  (has_function_privilege('service_role', p.oid, 'EXECUTE'),
   has_function_privilege('authenticated', p.oid, 'EXECUTE'),
   has_function_privilege('anon', p.oid, 'EXECUTE'))::text,
  '(t,f,f)')
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('labelos_audit_connection_request', 'labelos_audit_connection_accept',
                    'labelos_audit_connection_end', 'labelos_audit_connection_share');
SELECT public.check_eq('the private payload helpers have no caller but their owner',
  (SELECT count(*)::int FROM pg_proc p WHERE p.proname IN ('labelos_connection_payload', 'labelos_connection_json')
     AND (has_function_privilege('service_role', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))), 0);
SELECT public.check_eq('can_see_via_connection is callable by the roles a caller runs as',
  (has_function_privilege('authenticated', 'public.can_see_via_connection(uuid)', 'EXECUTE'),
   has_function_privilege('anon', 'public.can_see_via_connection(uuid)', 'EXECUTE'))::text, '(t,t)');
SET ROLE authenticated;
SELECT public.check_raises('authenticated cannot call an audit function',
  format($$SELECT public.labelos_audit_connection_end(%L, %L, gen_random_uuid(), '{}')$$, 'b1540000-0000-4000-8000-000000000001', 'a1540000-0000-4000-8000-000000000001'),
  'permission denied');
RESET ROLE;

-- ── An audit failure takes the mutation with it ─────────────────────────

SELECT public.check_raises('a payload with a secret-looking key is refused and nothing is written',
  format($$SELECT public.labelos_audit_connection_request(%L, %L, 'label', 'nova-154', NULL, NULL, '{"token":"x"}')$$, 'b1540000-0000-4000-8000-000000000002', 'a1540000-0000-4000-8000-000000000005'),
  'secret-looking key');
SELECT public.check_eq('...and no row for L2', (SELECT count(*)::int FROM public.org_connections WHERE label_org_id = :L2), 0);
