-- Behaviour checks for 196_labelos_artwork_min_px.sql (LABEL-76), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven: the settings validator accepts `artwork_min_px` as a whole number
-- from 600 to 10000 (both ends), refuses 599, 10001, a fraction, a string and
-- null, still refuses an unknown key, still validates the keys it already had,
-- and the atomic settings function stores the value and records the event.
-- Only service_role can call the validator (the grants are 192's).

\set OW '''a1960000-0000-4000-8000-000000000001'''
\set L  '''b1960000-0000-4000-8000-000000000001'''

INSERT INTO auth.users (id, email) VALUES (:OW, 'ow196@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by, settings) VALUES
  (:L, 'Label', 'label-196', 'label', :OW, '{}');
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES (:L, :OW, 'owner', '{}', 'org');

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

SET ROLE authenticated;
SELECT public.check_raises('authenticated cannot call the validator', $$SELECT public.labelos_validate_org_settings_patch('{"artwork_min_px":3000}')$$, 'permission denied');
RESET ROLE;

SET ROLE service_role;
SELECT public.labelos_validate_org_settings_patch('{"artwork_min_px":600}');
SELECT public.labelos_validate_org_settings_patch('{"artwork_min_px":3000}');
SELECT public.labelos_validate_org_settings_patch('{"artwork_min_px":10000}');
SELECT public.labelos_validate_org_settings_patch('{"artwork_min_px":4000,"legal_gate":"off"}');
SELECT public.check_raises('599 is refused', $$SELECT public.labelos_validate_org_settings_patch('{"artwork_min_px":599}')$$, 'pixels from 600 to 10000');
SELECT public.check_raises('10001 is refused', $$SELECT public.labelos_validate_org_settings_patch('{"artwork_min_px":10001}')$$, 'pixels from 600 to 10000');
SELECT public.check_raises('a fraction is refused', $$SELECT public.labelos_validate_org_settings_patch('{"artwork_min_px":3000.5}')$$, 'pixels from 600 to 10000');
SELECT public.check_raises('a string is refused', $$SELECT public.labelos_validate_org_settings_patch('{"artwork_min_px":"3000"}')$$, 'pixels from 600 to 10000');
SELECT public.check_raises('null is refused', $$SELECT public.labelos_validate_org_settings_patch('{"artwork_min_px":null}')$$, 'pixels from 600 to 10000');
SELECT public.check_raises('an unknown key is still refused', $$SELECT public.labelos_validate_org_settings_patch('{"artwork_px":3000}')$$, 'unknown setting');
SELECT public.check_raises('the old rules still hold', $$SELECT public.labelos_validate_org_settings_patch('{"attention_release_days":0}')$$, 'whole number of days');

-- The audit function stores it, merged, with its event.
SELECT public.check_eq('the owner sets the minimum',
  public.labelos_audit_org_settings(:L, :OW, '{"artwork_min_px":2400}', '{"keys":["artwork_min_px"],"changes":{"artwork_min_px":{"from":3000,"to":2400}}}') -> 'settings' ->> 'artwork_min_px', '2400');
SELECT public.check_eq('it is stored', (SELECT settings ->> 'artwork_min_px' FROM public.organizations WHERE id = :L), '2400');
SELECT public.check_eq('one audit event names the key', (SELECT count(*) FROM public.activity_events WHERE org_id = :L AND verb = 'org.settings_changed' AND payload -> 'keys' ->> 0 = 'artwork_min_px'), 1::bigint);
SELECT public.check_raises('a bad value through the audit function changes nothing',
  $$SELECT public.labelos_audit_org_settings('b1960000-0000-4000-8000-000000000001', 'a1960000-0000-4000-8000-000000000001', '{"artwork_min_px":100}', '{}')$$, 'pixels from 600 to 10000');
SELECT public.check_eq('still 2400', (SELECT settings ->> 'artwork_min_px' FROM public.organizations WHERE id = :L), '2400');
RESET ROLE;
