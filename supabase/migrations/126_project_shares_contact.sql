-- 126_project_shares_contact.sql
-- Artist Relationship Workspace, phase 1: tie a project share to the contact
-- it was sent to.
--
-- project_shares stored its recipient as text (invited_email, label). The
-- contact id replaces that as the identity; the text fields stay as display
-- fallbacks for links sent to people who are not contacts.
--
-- Backfill: a share whose invited_email matches one of the project owner's
-- contacts (emails are stored lowercased since mig 110; compared lowercased
-- here anyway). Only fills NULLs, so it is idempotent and never re-points a
-- share the producer has since changed.

ALTER TABLE public.project_shares
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_shares_contact
  ON public.project_shares (contact_id) WHERE contact_id IS NOT NULL;

UPDATE public.project_shares ps
SET contact_id = c.id
FROM public.projects p, public.contacts c
WHERE ps.contact_id IS NULL
  AND ps.invited_email IS NOT NULL
  AND p.id = ps.project_id
  AND c.user_id = p.user_id
  AND c.email IS NOT NULL
  AND lower(trim(c.email)) = lower(trim(ps.invited_email));

NOTIFY pgrst, 'reload schema';
