-- Behaviour checks for 204_share_comment_contact.sql (SHARE-07), run by
-- scripts/local-db/check.sh. Every check RAISEs on failure.
-- Proven: a share comment can name a contact of the project's owner; naming
-- another producer's contact is refused; a plain comment (NULL) is untouched;
-- deleting the contact keeps the comment and clears the link; re-running the
-- migration is harmless (the runner replays it).

\set P1 '''a2040000-0000-4000-8000-000000000001'''
\set P2 '''a2040000-0000-4000-8000-000000000002'''
\set PR1 '''b2040000-0000-4000-8000-000000000001'''
\set C1 '''c2040000-0000-4000-8000-000000000001'''
\set C2 '''c2040000-0000-4000-8000-000000000002'''

INSERT INTO auth.users (id, email) VALUES (:P1, 'p1-204@local.test'), (:P2, 'p2-204@local.test');
INSERT INTO public.projects (id, user_id, name) VALUES (:PR1, :P1, 'P1 project');
INSERT INTO public.contacts (id, user_id, name, email) VALUES
  (:C1, :P1, 'Alex', 'alex-204@local.test'),
  (:C2, :P2, 'Other producer contact', 'x-204@local.test');

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

INSERT INTO public.project_comments (project_id, author_name, body, share_contact_id)
VALUES (:PR1, 'Nova', 'darker please', :C1);
INSERT INTO public.project_comments (project_id, author_name, body)
VALUES (:PR1, 'Guest', 'plain comment');

SELECT public.check_eq('attributed comment stored',
  (SELECT count(*)::int FROM public.project_comments WHERE share_contact_id = :C1), 1);
SELECT public.check_eq('plain comment has no contact',
  (SELECT count(*)::int FROM public.project_comments WHERE body = 'plain comment' AND share_contact_id IS NULL), 1);
SELECT public.check_eq('portal contact_id is untouched',
  (SELECT count(*)::int FROM public.project_comments WHERE contact_id IS NOT NULL), 0);

SELECT public.check_raises('another producer''s contact is refused',
  format('INSERT INTO public.project_comments (project_id, author_name, body, share_contact_id) VALUES (%L, ''Nova'', ''x'', %L)', :PR1, :C2),
  'does not belong to the owner');
SELECT public.check_raises('re-pointing a comment at another producer''s contact is refused',
  format('UPDATE public.project_comments SET share_contact_id = %L WHERE body = ''darker please''', :C2),
  'does not belong to the owner');

DELETE FROM public.contacts WHERE id = :C1;
SELECT public.check_eq('deleting the contact keeps the comment',
  (SELECT count(*)::int FROM public.project_comments WHERE body = 'darker please'), 1);
SELECT public.check_eq('...and clears the link',
  (SELECT count(*)::int FROM public.project_comments WHERE body = 'darker please' AND share_contact_id IS NULL), 1);
