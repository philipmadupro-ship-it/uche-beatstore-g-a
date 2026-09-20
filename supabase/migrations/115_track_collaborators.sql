-- 115_track_collaborators.sql
-- Who else is credited on a track.
--
-- `lib/upload/title-metadata` reads credits out of the filename
-- ("Night Shift (prod. by Wheezy x TM88).wav"), which is the moment the
-- producer still knows what the file is. Until now those names were shown in
-- the uploads tray and then thrown away.
--
-- A join table rather than a column on `tracks`, because a collaborator is a
-- person who appears across many tracks: this is what later allows "everything
-- I made with X", a link to a `contacts` row, or crediting on a storefront
-- listing. A jsonb column would have stored the same names as an opaque blob
-- per track and answered none of those.
--
-- `role` is text, not an enum. The parser emits three values today
-- (producer / feature / collaborator) and adding a fourth should not need a
-- migration — same reasoning as `track_tags.category`.

CREATE TABLE IF NOT EXISTS public.track_collaborators (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id   uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  name       text NOT NULL,
  role       text NOT NULL DEFAULT 'collaborator',
  -- How the credit got here, so a name the producer typed is never silently
  -- replaced by a re-parse of the filename.
  source     text NOT NULL DEFAULT 'filename',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_track_collaborators_track
  ON public.track_collaborators (track_id);

-- Names are matched case-insensitively so a re-parse, a re-analyze, or the
-- same file uploaded twice cannot credit one person several times. This is
-- what makes the write path idempotent, which every cron and retry needs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_track_collaborators_unique
  ON public.track_collaborators (track_id, lower(name), role);

-- Useful for the reverse lookup ("everything credited to this name").
CREATE INDEX IF NOT EXISTS idx_track_collaborators_name
  ON public.track_collaborators (lower(name));

ALTER TABLE public.track_collaborators ENABLE ROW LEVEL SECURITY;

-- Owner-only, via the parent track. Deliberately NOT owner-or-null: migration
-- 097 retired that allowance, and re-adding it here would reopen it through a
-- new table.
DROP POLICY IF EXISTS track_collaborators_via_parent ON public.track_collaborators;
CREATE POLICY track_collaborators_via_parent ON public.track_collaborators
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.tracks t
    WHERE t.id = track_collaborators.track_id
      AND t.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tracks t
    WHERE t.id = track_collaborators.track_id
      AND t.user_id = auth.uid()
  ));

NOTIFY pgrst, 'reload schema';
