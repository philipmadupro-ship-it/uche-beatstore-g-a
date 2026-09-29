-- 122_project_contacts.sql
-- Artist Relationship Workspace, phase 1: who a project is for.
--
-- Nothing connected a contact to a project, so "Artist #1 → New EP" could not
-- be answered. A contact linked here is an ARTIST in workspace mode; buyers and
-- leads keep the plain CRM page.
--
-- Permissions for the artist's portal live on this row, not on a per-project
-- token, so one portal link can carry different rights for each project:
--   in_portal        — the project appears in that contact's portal
--   allow_downloads  — the portal may download this project's tracks
--   can_comment      — reserved for portal comments (phase 2)
-- last_notified_at is what the "Notify · N new" button counts from.
--
-- (Numbered 122, not 121: an unmerged branch already claims
-- 121_share_full_playback.sql.)

CREATE TABLE IF NOT EXISTS public.project_contacts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  contact_id       uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  role             text NOT NULL DEFAULT 'artist',
  in_portal        boolean NOT NULL DEFAULT false,
  allow_downloads  boolean NOT NULL DEFAULT false,
  can_comment      boolean NOT NULL DEFAULT true,
  last_notified_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_contacts_project_contact_key UNIQUE (project_id, contact_id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_contacts_role_check') THEN
    ALTER TABLE public.project_contacts ADD CONSTRAINT project_contacts_role_check
      CHECK (role IN ('artist', 'featured', 'manager', 'engineer', 'collaborator'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_contacts_contact ON public.project_contacts (contact_id);
CREATE INDEX IF NOT EXISTS idx_project_contacts_user ON public.project_contacts (user_id);

-- The row, its project and its contact must all belong to one owner. Routes
-- check this before writing with the service role; the trigger makes a
-- mistake there fail loudly instead of linking one producer's contact to
-- another producer's project.
CREATE OR REPLACE FUNCTION public.project_contacts_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'project_contacts: project % is not owned by %', NEW.project_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'project_contacts: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_contacts_same_owner ON public.project_contacts;
CREATE TRIGGER project_contacts_same_owner
  BEFORE INSERT OR UPDATE OF user_id, project_id, contact_id ON public.project_contacts
  FOR EACH ROW EXECUTE FUNCTION public.project_contacts_same_owner();

ALTER TABLE public.project_contacts ENABLE ROW LEVEL SECURITY;

-- Owner-only (not owner-or-null, mig 097); writes need a producer (mig 119).
DROP POLICY IF EXISTS project_contacts_owner_select ON public.project_contacts;
CREATE POLICY project_contacts_owner_select ON public.project_contacts
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS project_contacts_owner_write ON public.project_contacts;
CREATE POLICY project_contacts_owner_write ON public.project_contacts
  FOR ALL USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.is_producer()));

NOTIFY pgrst, 'reload schema';
