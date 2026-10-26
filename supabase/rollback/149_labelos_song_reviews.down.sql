-- Rollback for 149_labelos_song_reviews.sql (LABEL-25).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the table (and with it every review: the ratings and verdicts are
-- data this migration owns), its two trigger functions and the scoped-tracks
-- helper. Nothing else depends on them: no producer table, policy or function
-- was edited. Songs, stages and activity events are untouched.

DROP TABLE IF EXISTS public.song_reviews;
DROP FUNCTION IF EXISTS public.song_reviews_integrity();
DROP FUNCTION IF EXISTS public.labelos_scoped_tracks();

NOTIFY pgrst, 'reload schema';
