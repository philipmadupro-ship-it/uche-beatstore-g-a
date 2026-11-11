-- Behaviour checks for 200_labelos_party_email_resets_confirmation.sql (review G14), run by
-- scripts/local-db/check.sh. Every check RAISEs on failure.
-- Proven: changing a party's e-mail clears the person's confirmation (stamp + user), like the other
-- self-correctable fields; a no-op write and an unrelated field (display_name) keep it; an UPDATE that itself
-- sets the stamp is left alone.

\set O  '''a2000000-0000-4000-8000-000000000001'''
\set U  '''a2000000-0000-4000-8000-000000000002'''
\set L  '''b2000000-0000-4000-8000-000000000001'''
\set P1 '''d2000000-0000-4000-8000-000000000001'''

INSERT INTO auth.users (id, email) VALUES (:O, 'o200@local.test'), (:U, 'u200@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES (:L, 'Label L', 'label-l-200', 'label', :O);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES (:L, :O, 'owner', '{}', 'org');
INSERT INTO public.parties (id, org_id, kind, display_name, email) VALUES (:P1, :L, 'person', 'Ara', 'ara@old.test');

CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;

UPDATE public.parties SET details_confirmed_by = :U, details_confirmed_at = now() WHERE id = :P1;
SELECT public.check_eq('confirmed', (SELECT details_confirmed_by IS NOT NULL FROM public.parties WHERE id = :P1), true);

UPDATE public.parties SET display_name = 'Ara B' WHERE id = :P1;
SELECT public.check_eq('an unrelated field keeps the confirmation', (SELECT details_confirmed_by IS NOT NULL FROM public.parties WHERE id = :P1), true);
UPDATE public.parties SET email = 'ara@old.test' WHERE id = :P1;
SELECT public.check_eq('an unchanged e-mail keeps it', (SELECT details_confirmed_by IS NOT NULL FROM public.parties WHERE id = :P1), true);

UPDATE public.parties SET email = 'ara@new.test' WHERE id = :P1;
SELECT public.check_eq('a changed e-mail clears the user', (SELECT details_confirmed_by IS NULL FROM public.parties WHERE id = :P1), true);
SELECT public.check_eq('and the stamp', (SELECT details_confirmed_at IS NULL FROM public.parties WHERE id = :P1), true);

-- The person confirming with a corrected e-mail in the same statement keeps their own stamp.
UPDATE public.parties SET email = 'ara@third.test', details_confirmed_by = :U, details_confirmed_at = now() WHERE id = :P1;
SELECT public.check_eq('a write that sets the stamp is left alone', (SELECT details_confirmed_by IS NOT NULL FROM public.parties WHERE id = :P1), true);
