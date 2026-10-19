-- 173_labelos_track_metadata.sql (LABEL-53, doc 22 §music business data)
--
-- The recording / song metadata editor's columns on `tracks`. Already there and
-- NOT added again: title, bpm, key, notes (001), isrc (141), iswc (140).
-- Missing, added here, all NULLABLE and for ORG rows only:
--
--   version_label    "Radio edit", "Instrumental" (a label, not a counter)
--   language         BCP-47-ish language code of the vocal, ASCII ("en", "pt-BR")
--   explicit         true | false | NULL (not stated)
--   genre            one primary genre, free text
--   recorded_on      the recording date
--   p_line           the ℗ line of the recording ("℗ 2026 Label")
--   master_owner     who owns the master recording
--   metadata_updated_at  compare-and-set token of the editor: bumped only by
--                    the editor's own writes (never by processing, stage moves
--                    or peaks), so a background job cannot make an edit 409.
--
-- A producer row (org_id IS NULL) must keep all of them NULL: the producer's
-- routes never name them, and `tracks_org_metadata_only` makes that a rule of
-- the database rather than of the routes.
--
-- Identifiers stay as 141 (`tracks_isrc_format`) and 140 (`tracks_iswc_format`)
-- left them, ASCII by their character classes; the editor additionally refuses
-- non-ASCII before it writes (lib/labelos/identifiers). No second constraint is
-- added on them: 140's check pins "exactly one iswc CHECK on tracks".
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS first.

ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS version_label text;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS language text;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS explicit boolean;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS genre text;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS recorded_on date;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS p_line text;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS master_owner text;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS metadata_updated_at timestamptz;

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_metadata_format;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_metadata_format CHECK (
  (version_label IS NULL OR char_length(version_label) BETWEEN 1 AND 80)
  AND (genre IS NULL OR char_length(genre) BETWEEN 1 AND 80)
  AND (p_line IS NULL OR char_length(p_line) BETWEEN 1 AND 200)
  AND (master_owner IS NULL OR char_length(master_owner) BETWEEN 1 AND 200)
  AND (language IS NULL OR language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
);

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_org_metadata_only;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_org_metadata_only CHECK (
  org_id IS NOT NULL
  OR (version_label IS NULL AND language IS NULL AND explicit IS NULL AND genre IS NULL
      AND recorded_on IS NULL AND p_line IS NULL AND master_owner IS NULL
      AND metadata_updated_at IS NULL)
);


NOTIFY pgrst, 'reload schema';
