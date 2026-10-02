-- 140_labelos_song_fields.sql (LABEL-11)
-- Songs on tracks (17 R1): a Label OS song is a `tracks` row with
-- type = 'song'. No songs / song_recordings / project_songs tables.
--
-- 1. tracks.song_stage — the A&R stage (04 W3). Nullable, NO default: the app
--    sets 'inbox' on org songs only (lib/labelos/song-stage#initialSongStage),
--    so every existing row and every producer song stays NULL and reads as
--    before. 'released' is derived from releases, never stored. The value
--    list is held equal to SONG_STAGES by song-stage.test.ts.
-- 2. tracks.iswc — the song's musical-work code. Nullable; the CHECK is the
--    05 §7 format (validation/normalisation helpers arrive with LABEL-16).
-- 3. track_links.relation gains 'master' and 'demo' (a song's mastered file
--    and its early idea). Additive: every existing row satisfies the wider
--    check. The producer's link route still accepts only its original
--    relations (TrackLinkBodySchema), so nothing producer-facing can write
--    the new two.
--
-- tracks RLS is untouched (that is LABEL-12); no member gains a read path.
-- Written without DO blocks so it pastes safely into the Supabase SQL editor:
-- each constraint is dropped-if-present and re-added, so a replay leaves
-- exactly one of each (supabase/local/checks/140_labelos_song_fields.sql).

ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS song_stage text;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS iswc text;

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_song_stage_check;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_song_stage_check
  CHECK (song_stage IS NULL OR song_stage IN ('inbox', 'in_review', 'shortlisted', 'in_development', 'selected', 'on_hold', 'passed', 'archived'));

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_iswc_format;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_iswc_format
  CHECK (iswc IS NULL OR iswc ~ '^T-?[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]$');

ALTER TABLE public.track_links DROP CONSTRAINT IF EXISTS track_links_relation_check;
ALTER TABLE public.track_links ADD CONSTRAINT track_links_relation_check
  CHECK (relation IN ('instrumental', 'loop', 'topline', 'version', 'master', 'demo'));

NOTIFY pgrst, 'reload schema';
