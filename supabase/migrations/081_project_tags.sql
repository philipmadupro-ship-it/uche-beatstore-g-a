-- 081_project_tags.sql
-- Tags for projects (mirrors track_tags, mig 001). Lets the producer tag a
-- project (genre/mood/instrument/status + a project-type vocabulary) and
-- filter the projects list by tag, the same way the library filters tracks.
--
-- Junction table, no user_id of its own — ownership flows through the parent
-- project (same RLS shape as project_tracks, mig 010).

CREATE TABLE IF NOT EXISTS public.project_tags (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tag        text NOT NULL,
  category   text,
  PRIMARY KEY (project_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_project_tags_project ON public.project_tags (project_id);
CREATE INDEX IF NOT EXISTS idx_project_tags_tag ON public.project_tags (tag);

ALTER TABLE public.project_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_tags_via_parent ON public.project_tags;
CREATE POLICY project_tags_via_parent ON public.project_tags
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_tags.project_id
      AND (p.user_id IS NULL OR p.user_id = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_tags.project_id
      AND (p.user_id IS NULL OR p.user_id = auth.uid())
  ));

NOTIFY pgrst, 'reload schema';
