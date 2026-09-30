-- 135_portal_pitch_note.sql
-- Portals shaped by role: a pitch note per label, per project.
--
-- A label or A&R contact's portal frames each project as a pack and opens it
-- with the producer's pitch ("two toplines for the summer single, hooks
-- written, open to a feature"). The note belongs to the link, not the
-- project: the same pack is pitched differently to two labels, and the
-- project's own description stays the storefront copy. NULL = no pitch.
-- Read by /api/portal/[token] (lib/artist-portal/audience); the portal works
-- without it when this migration is not applied.

ALTER TABLE public.project_contacts
  ADD COLUMN IF NOT EXISTS pitch_note text;

ALTER TABLE public.project_contacts
  DROP CONSTRAINT IF EXISTS project_contacts_pitch_note_len;
ALTER TABLE public.project_contacts
  ADD CONSTRAINT project_contacts_pitch_note_len CHECK (pitch_note IS NULL OR char_length(pitch_note) <= 2000);

NOTIFY pgrst, 'reload schema';
