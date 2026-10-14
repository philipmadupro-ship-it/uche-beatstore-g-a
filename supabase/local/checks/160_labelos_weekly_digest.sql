-- Behaviour checks for 160_labelos_weekly_digest.sql (LABEL-38), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven:
--   - org_digest_channels (the encrypted Slack URL) and org_digest_members are
--     unreadable and unwritable for anon and authenticated, even for the org's
--     own owner with their own claims;
--   - service_role reads and writes both;
--   - the weekly claim is a compare-and-set: the statement the cron runs
--     returns a row once per ISO week, then nothing, and a released claim can
--     be taken again;
--   - the shape checks (week format);
--   - deleting the organization removes both tables' rows (LABEL-39).

\set O  '''a1600000-0000-4000-8000-000000000001'''
\set M  '''a1600000-0000-4000-8000-000000000002'''
\set L  '''b1600000-0000-4000-8000-000000000001'''

INSERT INTO auth.users (id, email) VALUES (:O, 'o160@local.test'), (:M, 'm160@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES (:L, 'Label L', 'label-l-160', 'label', :O);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :M, 'member', '{a_and_r}', 'org');

CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement) TO anon, authenticated, service_role;

-- service_role writes both tables.
SET ROLE service_role;
INSERT INTO public.org_digest_members (org_id, user_id, enabled) VALUES (:L, :O, true), (:L, :M, true);
INSERT INTO public.org_digest_channels (org_id, slack_webhook_cipher, configured_by) VALUES (:L, 'v1.k1.nonce.cipher', :O);
SELECT public.check_eq('service_role reads members', (SELECT count(*) FROM public.org_digest_members), 2::bigint);
SELECT public.check_eq('service_role reads the channel', (SELECT count(*) FROM public.org_digest_channels), 1::bigint);
RESET ROLE;

-- Nobody else sees or touches either table, owner included.
DO $$
DECLARE r text; t text; denied int := 0;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH t IN ARRAY ARRAY['org_digest_members', 'org_digest_channels'] LOOP
      EXECUTE format('SET LOCAL ROLE %I', r);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', 'a1600000-0000-4000-8000-000000000001', 'role', r)::text, true);
      BEGIN
        EXECUTE format('SELECT count(*) FROM public.%I', t);
        RAISE EXCEPTION 'CHECK FAILED: % read %', r, t;
      EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1;
      END;
      BEGIN
        EXECUTE format('INSERT INTO public.%I (org_id) VALUES (%L)', t, 'b1600000-0000-4000-8000-000000000001');
        RAISE EXCEPTION 'CHECK FAILED: % wrote %', r, t;
      EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1;
      END;
      RESET ROLE;
    END LOOP;
  END LOOP;
  IF denied <> 8 THEN RAISE EXCEPTION 'CHECK FAILED: expected 8 denials, got %', denied; END IF;
END $$;

-- The claim: once per week.
SET ROLE service_role;
CREATE TEMP TABLE claims (n int);
WITH c AS (UPDATE public.org_digest_members SET last_sent_week = '2026-W42' WHERE org_id = :L AND user_id = :M AND enabled AND last_sent_week <> '2026-W42' RETURNING 1)
INSERT INTO claims SELECT count(*) FROM c;
WITH c AS (UPDATE public.org_digest_members SET last_sent_week = '2026-W42' WHERE org_id = :L AND user_id = :M AND enabled AND last_sent_week <> '2026-W42' RETURNING 1)
INSERT INTO claims SELECT count(*) FROM c;
SELECT public.check_eq('first claim wins, the second gets nothing', (SELECT array_agg(n ORDER BY n DESC) FROM claims), ARRAY[1, 0]);
-- A failed send puts the previous value back; the next run can claim again.
UPDATE public.org_digest_members SET last_sent_week = '' WHERE org_id = :L AND user_id = :M AND last_sent_week = '2026-W42';
WITH c AS (UPDATE public.org_digest_members SET last_sent_week = '2026-W42' WHERE org_id = :L AND user_id = :M AND last_sent_week <> '2026-W42' RETURNING 1)
SELECT public.check_eq('a released claim can be taken again', (SELECT count(*) FROM c), 1::bigint);
-- Next week it is due again.
WITH c AS (UPDATE public.org_digest_members SET last_sent_week = '2026-W43' WHERE org_id = :L AND user_id = :M AND last_sent_week <> '2026-W43' RETURNING 1)
SELECT public.check_eq('a new week claims again', (SELECT count(*) FROM c), 1::bigint);

-- Shape.
DO $$
BEGIN
  BEGIN
    UPDATE public.org_digest_members SET last_sent_week = 'last tuesday' WHERE org_id = 'b1600000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'CHECK FAILED: a malformed week was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;

-- Cascade.
DELETE FROM public.organizations WHERE id = :L;
SELECT public.check_eq('members cascade with the org', (SELECT count(*) FROM public.org_digest_members), 0::bigint);
SELECT public.check_eq('the channel cascades with the org', (SELECT count(*) FROM public.org_digest_channels), 0::bigint);
