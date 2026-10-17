-- Behaviour checks for 189_labelos_setup_org.sql (LABEL-48, first slice), run
-- by scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven:
--   - 'artist' creates the org, the caller as owner (scope org) and exactly
--     one roster artist (139's trigger), with the caller's email;
--   - 'label' creates the org and the owner, and no contact;
--   - asking again answers the same org (created false), nothing new;
--   - a taken slug gets a suffix; 'producer' and a blank name are refused;
--   - anon and authenticated cannot execute it.

\set A '''a1890000-0000-4000-8000-000000000001'''
\set B '''a1890000-0000-4000-8000-000000000002'''
\set C '''a1890000-0000-4000-8000-000000000003'''

INSERT INTO auth.users (id, email) VALUES (:A, 'A189@Local.TEST'), (:B, 'b189@local.test'), (:C, 'c189@local.test');

CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;

SET ROLE service_role;
SELECT public.labelos_setup_org(:A, 'artist', '  Nova   Sky ') AS first \gset
SELECT public.labelos_setup_org(:A, 'artist', 'Someone else') AS again \gset
SELECT public.labelos_setup_org(:B, 'label', 'Nova Sky') AS lbl \gset
RESET ROLE;

SELECT public.check_eq('artist: created', (:'first'::jsonb ->> 'created')::boolean, true);
SELECT public.check_eq('artist: slug', :'first'::jsonb ->> 'slug', 'nova-sky');
SELECT public.check_eq('artist: name collapsed', (SELECT name FROM public.organizations WHERE id = (:'first'::jsonb ->> 'org_id')::uuid), 'Nova Sky');
SELECT public.check_eq('artist: owner row', (SELECT count(*) FROM public.org_members WHERE org_id = (:'first'::jsonb ->> 'org_id')::uuid AND user_id = :A AND role = 'owner' AND scope = 'org'), 1::bigint);
SELECT public.check_eq('artist: one roster artist', (SELECT count(*) FROM public.contacts WHERE org_id = (:'first'::jsonb ->> 'org_id')::uuid AND category = 'artist' AND user_id IS NULL), 1::bigint);
SELECT public.check_eq('artist: email lower-cased', (SELECT email FROM public.contacts WHERE org_id = (:'first'::jsonb ->> 'org_id')::uuid), 'a189@local.test');

SELECT public.check_eq('again: same org', :'again'::jsonb ->> 'org_id', :'first'::jsonb ->> 'org_id');
SELECT public.check_eq('again: not created', (:'again'::jsonb ->> 'created')::boolean, false);
SELECT public.check_eq('again: nothing new', (SELECT count(*) FROM public.organizations WHERE created_by = :A), 1::bigint);

SELECT public.check_eq('label: suffixed slug', :'lbl'::jsonb ->> 'slug', 'nova-sky-2');
SELECT public.check_eq('label: kind', (SELECT kind FROM public.organizations WHERE id = (:'lbl'::jsonb ->> 'org_id')::uuid), 'label');
SELECT public.check_eq('label: no contact', (SELECT count(*) FROM public.contacts WHERE org_id = (:'lbl'::jsonb ->> 'org_id')::uuid), 0::bigint);

DO $$
DECLARE refused int := 0;
BEGIN
  BEGIN
    PERFORM public.labelos_setup_org('a1890000-0000-4000-8000-000000000003', 'producer', 'Studio');
  EXCEPTION WHEN invalid_parameter_value THEN refused := refused + 1;
  END;
  BEGIN
    PERFORM public.labelos_setup_org('a1890000-0000-4000-8000-000000000003', 'label', '   ');
  EXCEPTION WHEN invalid_parameter_value THEN refused := refused + 1;
  END;
  IF refused <> 2 THEN RAISE EXCEPTION 'CHECK FAILED: expected 2 refusals, got %', refused; END IF;
END $$;

DO $$
DECLARE r text; denied int := 0;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    BEGIN
      PERFORM public.labelos_setup_org('a1890000-0000-4000-8000-000000000003', 'label', 'Sneaky');
      RAISE EXCEPTION 'CHECK FAILED: % executed labelos_setup_org', r;
    EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1;
    END;
    RESET ROLE;
  END LOOP;
  IF denied <> 2 THEN RAISE EXCEPTION 'CHECK FAILED: expected 2 denials, got %', denied; END IF;
END $$;
SELECT public.check_eq('nothing created for C', (SELECT count(*) FROM public.organizations WHERE created_by = 'a1890000-0000-4000-8000-000000000003'), 0::bigint);
