-- 084_project_templates.sql
-- Project templates + completion checklist.
--
-- template (text nullable): slug of a template used to seed the project
--   ('album' | 'ep' | 'single' | 'beat_tape' | 'loop_kit' | 'custom').
--   Stored for display; logic lives in the client.
--
-- checklist (jsonb nullable): ordered array of checklist items,
--   e.g. [{"id":"...","label":"Add cover","done":false}, ...]
--   Written by the producer as they complete production milestones;
--   read + rendered by the ProjectChecklist component.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS template text,
  ADD COLUMN IF NOT EXISTS checklist jsonb;

-- Persisted on project, so PATCH can land it through the existing route;
-- adding the field to the Zod schema there is the only other change.

NOTIFY pgrst, 'reload schema';
