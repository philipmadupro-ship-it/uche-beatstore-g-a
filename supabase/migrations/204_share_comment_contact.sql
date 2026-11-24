-- 204_share_comment_contact.sql
-- SHARE-07: say WHO a share-page comment came from, using the producer's own
-- invite as the only source of identity.
--
-- A comment left through /projects/share/<token> carried only a typed
-- author_name. `project_shares.contact_id` (mig 126) already records which
-- contact the producer invited, so the server stamps that onto the comment:
--   share_contact_id  the contact the share was issued to. Set ONLY by the
--                     server from the share row, never from a request body; a
--                     typed name proves nothing, the invite does. NULL for
--                     owner comments, portal comments (contact_id, mig 128)
--                     and shares not issued to a contact.
-- Deliberately a column of its own: `contact_id` means "this is that artist's
-- portal thread" and every share page filters it out, so reusing it would hide
-- these comments from the share page that holds them.
-- Deleting the contact keeps the comment and only loses the link.
--
-- The producer reads it as "Nova (Alex)"; the public JSON never carries it.
-- Idempotent.

ALTER TABLE public.project_comments
  ADD COLUMN IF NOT EXISTS share_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_comments_share_contact
  ON public.project_comments (share_contact_id, created_at)
  WHERE share_contact_id IS NOT NULL;

-- The contact must belong to the project's owner (same rule as mig 128).
CREATE OR REPLACE FUNCTION public.project_comments_share_contact_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.share_contact_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.contacts c ON c.user_id = p.user_id
    WHERE p.id = NEW.project_id AND c.id = NEW.share_contact_id
  ) THEN
    RAISE EXCEPTION 'project_comments: share contact % does not belong to the owner of project %', NEW.share_contact_id, NEW.project_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_comments_share_contact_same_owner ON public.project_comments;
CREATE TRIGGER project_comments_share_contact_same_owner
  BEFORE INSERT OR UPDATE OF share_contact_id, project_id ON public.project_comments
  FOR EACH ROW EXECUTE FUNCTION public.project_comments_share_contact_same_owner();

NOTIFY pgrst, 'reload schema';
