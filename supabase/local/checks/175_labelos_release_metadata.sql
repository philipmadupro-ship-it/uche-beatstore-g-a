-- Behaviour checks for 175_labelos_release_metadata.sql (LABEL-55), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Cast: O the org owner of label L with one artist contact, one project and
-- one release (written as the service role writes it: no user_id).
--
-- Proven: the three columns exist and are NULLABLE (an existing release keeps
-- reading as NULL); a release takes distributor / territories / language;
-- the format CHECK refuses an empty or over-long distributor, a malformed
-- language, an empty territory list and a territory that is not two capital
-- letters; and the release stays unreadable to an unrelated authenticated user
-- (the 144 policy is untouched).

\set O  '''a1750000-0000-4000-8000-000000000001'''
\set S  '''a1750000-0000-4000-8000-000000000002'''
\set L  '''b1750000-0000-4000-8000-000000000001'''
\set C  '''c1750000-0000-4000-8000-000000000001'''
\set PR '''d1750000-0000-4000-8000-000000000001'''
\set R  '''e1750000-0000-4000-8000-000000000001'''

INSERT INTO auth.users (id, email) VALUES (:O, 'o175@local.test'), (:S, 's175@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES (:L, 'Label 175', 'label-175', 'label', :O);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES (:L, :O, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, org_id, user_id, name, category) VALUES (:C, :L, NULL, 'Nova 175', 'artist');
INSERT INTO public.projects (id, org_id, user_id, name) VALUES (:PR, :L, NULL, 'Release project 175');
INSERT INTO public.releases (id, org_id, project_id, contact_id, title, created_by) VALUES (:R, :L, :PR, :C, 'Single 175', :O);

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

SELECT public.check_eq('the three columns exist',
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'releases'
     AND column_name IN ('distributor', 'territories', 'language') AND is_nullable = 'YES'), 3);
SELECT public.check_eq('an existing release reads NULL',
  (SELECT (distributor IS NULL AND territories IS NULL AND language IS NULL) FROM public.releases WHERE id = :R), true);

UPDATE public.releases SET distributor = 'DistroKid', territories = ARRAY['US', 'GB', 'WW'], language = 'pt-BR' WHERE id = :R;
SELECT public.check_eq('a release keeps the details',
  (SELECT distributor || '|' || array_to_string(territories, ',') || '|' || language FROM public.releases WHERE id = :R), 'DistroKid|US,GB,WW|pt-BR');

SELECT public.check_raises('an empty distributor is refused', format($q$UPDATE public.releases SET distributor = '  ' WHERE id = %L$q$, :R), 'releases_metadata_format');
SELECT public.check_raises('an over-long distributor is refused', format($q$UPDATE public.releases SET distributor = repeat('x', 121) WHERE id = %L$q$, :R), 'releases_metadata_format');
SELECT public.check_raises('a malformed language is refused', format($q$UPDATE public.releases SET language = 'English' WHERE id = %L$q$, :R), 'releases_metadata_format');
SELECT public.check_raises('an empty territory list is refused', format($q$UPDATE public.releases SET territories = '{}' WHERE id = %L$q$, :R), 'releases_metadata_format');
SELECT public.check_raises('a lower-case territory is refused', format($q$UPDATE public.releases SET territories = ARRAY['us'] WHERE id = %L$q$, :R), 'releases_metadata_format');
SELECT public.check_raises('a three-letter territory is refused', format($q$UPDATE public.releases SET territories = ARRAY['USA'] WHERE id = %L$q$, :R), 'releases_metadata_format');
SELECT public.check_raises('a null element is refused', format($q$UPDATE public.releases SET territories = ARRAY['US', NULL] WHERE id = %L$q$, :R), 'releases_metadata_format');

-- NULL clears each field.
UPDATE public.releases SET distributor = NULL, territories = NULL, language = NULL WHERE id = :R;
SELECT public.check_eq('NULL clears them',
  (SELECT (distributor IS NULL AND territories IS NULL AND language IS NULL) FROM public.releases WHERE id = :R), true);

GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text) TO authenticated;
GRANT SELECT ON public.releases TO authenticated;

-- The 144 read policy is untouched: a stranger reads nothing, the owner reads the row.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :S, 'role', 'authenticated')::text, false);
SELECT public.check_eq('a stranger reads no release', (SELECT count(*)::int FROM public.releases WHERE id = :R), 0);
SELECT set_config('request.jwt.claims', json_build_object('sub', :O, 'role', 'authenticated')::text, false);
SELECT public.check_eq('the owner reads the release', (SELECT count(*)::int FROM public.releases WHERE id = :R), 1);
RESET ROLE;
