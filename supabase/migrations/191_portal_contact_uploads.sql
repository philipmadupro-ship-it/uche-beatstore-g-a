-- 191_portal_contact_uploads.sql
-- PORTAL-UP: a contact uploads their own material through their portal link
-- (docs/portal-contact-uploads.md). No new table.
--
-- Numbered 191: 172–187 are reserved by the Label OS phase-2 backlog
-- (docs/bstudio-label-os/23-engineering-backlog-phase-2.md) and 189–190 are
-- PR #130's.
--
--   1. project_contacts.can_upload — a per-LINK switch beside allow_downloads
--      and can_comment. Off for every existing link: nobody can upload into a
--      project until the producer says so for that contact.
--   2. project_assets.uploaded_by_contact_id — who sent the file. NULL = the
--      producer's own. The row is still the producer's (user_id = owner); the
--      portal writes it through the service role after the token gate.
--   3. A trigger: a file attributed to a contact must be a PRODUCER row
--      (user_id set), the contact must be that producer's, and the contact
--      must be linked to the file's project. A contact deleted later leaves
--      the file with the producer (ON DELETE SET NULL).

ALTER TABLE public.project_contacts
  ADD COLUMN IF NOT EXISTS can_upload boolean NOT NULL DEFAULT false;

ALTER TABLE public.project_assets
  ADD COLUMN IF NOT EXISTS uploaded_by_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_assets_uploaded_by
  ON public.project_assets (uploaded_by_contact_id)
  WHERE uploaded_by_contact_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.project_assets_uploader_linked()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.uploaded_by_contact_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'project_assets: an organization file has no contact uploader';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = NEW.uploaded_by_contact_id AND c.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'project_assets: contact % is not owned by %', NEW.uploaded_by_contact_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.project_contacts pc
    WHERE pc.project_id = NEW.project_id
      AND pc.contact_id = NEW.uploaded_by_contact_id
      AND pc.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'project_assets: contact % is not linked to project %', NEW.uploaded_by_contact_id, NEW.project_id;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.project_assets_uploader_linked() FROM PUBLIC;

DROP TRIGGER IF EXISTS project_assets_uploader_linked ON public.project_assets;
CREATE TRIGGER project_assets_uploader_linked
  BEFORE INSERT OR UPDATE OF uploaded_by_contact_id, project_id, user_id ON public.project_assets
  FOR EACH ROW EXECUTE FUNCTION public.project_assets_uploader_linked();

NOTIFY pgrst, 'reload schema';
