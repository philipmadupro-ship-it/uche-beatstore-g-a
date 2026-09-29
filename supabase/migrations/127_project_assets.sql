-- 127_project_assets.sql
-- Artist Relationship Workspace, phase 2: project files.
--
-- References, artwork, lyric sheets and documents had nowhere to live: every
-- stored file belonged to a track. A project file is a row here pointing at
-- an object in the PRIVATE bucket (`url` is an `r2://` reference, never a
-- public URL). Track files (WAV, stems, versions) are NOT copied in — the
-- Files tab reads them where they already live.
--
-- in_portal decides whether the file appears in the portal of every artist
-- this project is shared with. It defaults to false: a contract dropped on a
-- project that is already in a portal must not become visible by accident.
-- The upload form sets it explicitly. portal_at records when it last went
-- into the portal (insert with in_portal, or switched on later), so a file
-- that has sat on the project for a month is still NEW to the artist the day
-- it is shared, and still counts toward "Notify · N new".

CREATE TABLE IF NOT EXISTS public.project_assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'other',
  label       text NOT NULL DEFAULT '',
  file_name   text NOT NULL DEFAULT '',
  url         text NOT NULL,
  mime        text,
  size_bytes  bigint,
  position    integer NOT NULL DEFAULT 0,
  in_portal   boolean NOT NULL DEFAULT false,
  portal_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_assets_kind_check') THEN
    ALTER TABLE public.project_assets ADD CONSTRAINT project_assets_kind_check
      CHECK (kind IN ('reference', 'artwork', 'lyrics', 'document', 'audio', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_assets_size_check') THEN
    ALTER TABLE public.project_assets ADD CONSTRAINT project_assets_size_check
      CHECK (size_bytes IS NULL OR size_bytes >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_assets_project ON public.project_assets (project_id, position);
CREATE INDEX IF NOT EXISTS idx_project_assets_user ON public.project_assets (user_id);

-- The row and its project must belong to one owner.
CREATE OR REPLACE FUNCTION public.project_assets_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'project_assets: project % is not owned by %', NEW.project_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_assets_same_owner ON public.project_assets;
CREATE TRIGGER project_assets_same_owner
  BEFORE INSERT OR UPDATE OF user_id, project_id ON public.project_assets
  FOR EACH ROW EXECUTE FUNCTION public.project_assets_same_owner();

-- Owner-only. No anon policy: the portal reads files through the service
-- role after checking the token and membership.
ALTER TABLE public.project_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_assets_owner_select ON public.project_assets;
CREATE POLICY project_assets_owner_select ON public.project_assets
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS project_assets_owner_write ON public.project_assets;
CREATE POLICY project_assets_owner_write ON public.project_assets
  FOR ALL USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.is_producer()));

NOTIFY pgrst, 'reload schema';
