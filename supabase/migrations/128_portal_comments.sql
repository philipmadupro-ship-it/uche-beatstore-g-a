-- 128_portal_comments.sql
-- Artist Relationship Workspace, phase 2: comments from the artist portal.
--
-- Portal comments reuse project_comments — the same rows, threading and
-- time-range pins (region_start/end, mig 013) the share pages use — with one
-- new column saying which artist the thread belongs to:
--   contact_id  the artist whose portal thread this is. Set on the artist's
--               own comments AND on the producer's replies in that thread, so
--               a portal shows exactly its own artist's conversation and never
--               another artist's. NULL for every share-page / owner comment.
-- Deleting the contact keeps the comments (the producer's record of the
-- feedback) and only loses the link — ON DELETE SET NULL. Privacy erasure
-- deletes the artist's own comments explicitly (lib/privacy/erase-artist).

ALTER TABLE public.project_comments
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_comments_contact
  ON public.project_comments (contact_id, created_at)
  WHERE contact_id IS NOT NULL;

-- A thread's contact must belong to the project's owner.
CREATE OR REPLACE FUNCTION public.project_comments_contact_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.contacts c ON c.user_id = p.user_id
    WHERE p.id = NEW.project_id AND c.id = NEW.contact_id
  ) THEN
    RAISE EXCEPTION 'project_comments: contact % does not belong to the owner of project %', NEW.contact_id, NEW.project_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_comments_contact_same_owner ON public.project_comments;
CREATE TRIGGER project_comments_contact_same_owner
  BEFORE INSERT OR UPDATE OF contact_id, project_id ON public.project_comments
  FOR EACH ROW EXECUTE FUNCTION public.project_comments_contact_same_owner();

NOTIFY pgrst, 'reload schema';
