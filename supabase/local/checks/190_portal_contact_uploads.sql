-- Behaviour checks for 190_portal_contact_uploads.sql (PORTAL-UP),
-- run by scripts/local-db/check.sh in its own copy of the throwaway database.
-- Every check RAISEs on failure; psql stops at the first.
--
-- Cast:
--   P1  a producer: project PR1 (contact C1 linked), project PR2 (nobody linked),
--       contact C1b (not linked anywhere)
--   P2  another producer: contact C2
-- Proven: can_upload defaults off on every link; a file credited to a contact
-- is accepted only for a contact of the same owner who is linked to that
-- project, never on an organization file; deleting the contact keeps the file.

\set P1   '''a1900000-0000-4000-8000-000000000001'''
\set P2   '''a1900000-0000-4000-8000-000000000002'''
\set L    '''b1900000-0000-4000-8000-000000000001'''
\set PR1  '''c1900000-0000-4000-8000-000000000001'''
\set PR2  '''c1900000-0000-4000-8000-000000000002'''
\set C1   '''d1900000-0000-4000-8000-000000000001'''
\set C1b  '''d1900000-0000-4000-8000-000000000002'''
\set C2   '''d1900000-0000-4000-8000-000000000003'''

INSERT INTO auth.users (id, email) VALUES (:P1, 'p1-190@local.test'), (:P2, 'p2-190@local.test');
INSERT INTO public.creator_profiles (user_id, display_name) VALUES (:P1, 'Producer 190') ON CONFLICT DO NOTHING;
INSERT INTO public.projects (id, user_id, name) VALUES (:PR1, :P1, 'Shared'), (:PR2, :P1, 'Private');
INSERT INTO public.contacts (id, user_id, name, email) VALUES
  (:C1,  :P1, 'Nova',  'nova-190@local.test'),
  (:C1b, :P1, 'Other', 'other-190@local.test'),
  (:C2,  :P2, 'Theirs', 'theirs-190@local.test');
INSERT INTO public.project_contacts (user_id, project_id, contact_id, in_portal) VALUES (:P1, :PR1, :C1, true);

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
CREATE FUNCTION public.as_user(p_user text) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text), public.as_user(text)
  TO anon, authenticated, service_role;

SELECT public.check_eq('an existing link has uploads off',
  (SELECT can_upload FROM public.project_contacts WHERE project_id = :PR1 AND contact_id = :C1), false);

-- ── service_role: the portal upload route writes as it ────────────────────
SET ROLE service_role;

UPDATE public.project_contacts SET can_upload = true WHERE project_id = :PR1 AND contact_id = :C1;

INSERT INTO public.project_assets (user_id, project_id, kind, label, file_name, url, in_portal, uploaded_by_contact_id)
  VALUES (:P1, :PR1, 'audio', 'Verse idea', 'verse.wav', 'local://project-assets/c1900000-0000-4000-8000-000000000001/aaaaaaaaaaaa.wav', true, :C1);
SELECT public.check_eq('a linked contact’s upload is stored',
  (SELECT count(*)::int FROM public.project_assets WHERE uploaded_by_contact_id = :C1), 1);

SELECT public.check_raises('a contact not linked to the project is refused',
  format($f$INSERT INTO public.project_assets (user_id, project_id, url, uploaded_by_contact_id) VALUES (%L, %L, 'local://x', %L)$f$, :P1, :PR2, :C1),
  'not linked to project');
SELECT public.check_raises('the owner’s unlinked contact is refused',
  format($f$INSERT INTO public.project_assets (user_id, project_id, url, uploaded_by_contact_id) VALUES (%L, %L, 'local://x', %L)$f$, :P1, :PR1, :C1b),
  'not linked to project');
SELECT public.check_raises('another producer’s contact is refused',
  format($f$INSERT INTO public.project_assets (user_id, project_id, url, uploaded_by_contact_id) VALUES (%L, %L, 'local://x', %L)$f$, :P1, :PR1, :C2),
  'not owned by');
SELECT public.check_raises('moving a contact’s file onto a project they are not on is refused',
  format($f$UPDATE public.project_assets SET project_id = %L WHERE uploaded_by_contact_id = %L$f$, :PR2, :C1),
  'not linked to project');
SELECT public.check_raises('re-crediting a file to an unlinked contact is refused',
  format($f$UPDATE public.project_assets SET uploaded_by_contact_id = %L WHERE uploaded_by_contact_id = %L$f$, :C1b, :C1),
  'not linked to project');

INSERT INTO public.project_assets (user_id, project_id, url)
  VALUES (:P1, :PR2, 'local://project-assets/c1900000-0000-4000-8000-000000000002/bbbbbbbbbbbb.pdf');
SELECT public.check_eq('the producer’s own files are unaffected',
  (SELECT count(*)::int FROM public.project_assets WHERE project_id = :PR2 AND uploaded_by_contact_id IS NULL), 1);

RESET ROLE;

-- ── authenticated: the producer's own JWT ────────────────────────────────
SET ROLE authenticated;
SELECT public.as_user(:P1);
SELECT public.check_eq('the producer reads who sent a file',
  (SELECT uploaded_by_contact_id FROM public.project_assets WHERE label = 'Verse idea'), :C1::uuid);
SELECT public.check_eq('the producer reads the switch on their link',
  (SELECT can_upload FROM public.project_contacts WHERE project_id = :PR1), true);
SELECT public.as_user(:P2);
SELECT public.check_eq('another producer reads none of it',
  (SELECT count(*)::int FROM public.project_assets WHERE uploaded_by_contact_id IS NOT NULL), 0);
RESET ROLE;

-- ── anon: nothing ─────────────────────────────────────────────────────────
SET ROLE anon;
SELECT public.check_eq('anon reads no file',
  (SELECT count(*)::int FROM public.project_assets), 0);
SELECT public.check_raises('anon cannot write a file',
  format($f$INSERT INTO public.project_assets (user_id, project_id, url, uploaded_by_contact_id) VALUES (%L, %L, 'local://x', %L)$f$, :P1, :PR1, :C1),
  'permission denied|row-level security');
RESET ROLE;

-- ── deleting the contact keeps the file with the producer ────────────────
DELETE FROM public.contacts WHERE id = :C1;
SELECT public.check_eq('the file stays, credited to nobody',
  (SELECT uploaded_by_contact_id IS NULL FROM public.project_assets WHERE label = 'Verse idea'), true);
