-- Rollback for 193_labelos_release_lifecycle.sql (LABEL-56).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Puts back 144's labelos_track_is_finished (any release that is not
-- cancelled makes its songs finished) and 144's state CHECK. A release that is
-- 'withdrawn' would violate the old CHECK, so it goes back to 'delivered'
-- first (its delivered_at is intact; it is not on the store). The withdrawal
-- stays in the activity record.

UPDATE public.releases SET state = 'delivered' WHERE state = 'withdrawn';

ALTER TABLE public.releases DROP CONSTRAINT IF EXISTS releases_state_check;
ALTER TABLE public.releases ADD CONSTRAINT releases_state_check
  CHECK (state IN ('draft', 'delivered', 'cancelled'));

CREATE OR REPLACE FUNCTION public.labelos_track_is_finished(p_track uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
      SELECT 1 FROM public.track_links l
      WHERE l.to_track_id = p_track AND l.relation NOT IN ('master', 'instrumental')
    )
    AND NOT EXISTS (SELECT 1 FROM public.song_beats sb WHERE sb.beat_track_id = p_track)
    AND (
      EXISTS (
        SELECT 1
        FROM public.track_links l
        JOIN public.tracks s ON s.id = l.from_track_id AND s.type = 'song'
        JOIN public.tracks t ON t.id = l.to_track_id AND t.org_id = s.org_id
        WHERE l.to_track_id = p_track AND l.relation IN ('master', 'instrumental')
      )
      OR EXISTS (
        SELECT 1 FROM public.tracks t
        WHERE t.id = p_track AND t.type = 'song' AND t.song_stage = 'selected'
      )
      OR EXISTS (
        SELECT 1
        FROM public.tracks t
        JOIN public.release_items ri ON ri.song_track_id = t.id
        JOIN public.releases r ON r.id = ri.release_id AND r.org_id = t.org_id
        WHERE t.id = p_track AND t.type = 'song' AND r.state NOT IN ('cancelled')
      )
    );
$$;

ALTER FUNCTION public.labelos_track_is_finished(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_track_is_finished(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.labelos_track_is_finished(uuid) FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
