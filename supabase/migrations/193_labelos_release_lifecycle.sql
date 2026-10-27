-- 193: Delivered-release lifecycle and draft-song class (LABEL-56).
-- Not applied — Label OS ships it in the second paste after go-live.
--
-- 1. releases.state gains 'withdrawn': a DELIVERED release that was pulled
--    back. The row, its tracklist and its gates history stay (nothing is
--    deleted); it is off the store; it is never delivered again. Cancel stays
--    draft-only. The other 144 CHECKs are untouched: a withdrawn release is
--    never listed (store_listed needs 'delivered' or imported_released, and
--    the route clears the listing in the same statement that withdraws), and
--    it keeps its delivered_at.
--
-- 2. labelos_track_is_finished (141, replaced by 144) changes its RELEASE ARM
--    ONLY. It used to say "a song on any release that is not cancelled is
--    finished"; a DRAFT is still being assembled, so its songs stay working
--    until the release is delivered (21 §5 row 11, decided by the
--    orchestrator: delivered, not gates-green — gates are derived in TS and
--    cannot be mirrored here). A song is finished by a release that is
--    delivered or withdrawn (it went out), or imported_released (entered as
--    already out), and never by a cancelled one. Everything else in the
--    function is 144's text, word for word. TS twin:
--    lib/labelos/releases.ts#countsAsOnRelease / RELEASE_STATES_ON_RELEASE.
--
-- Idempotent. Until this is applied the app keeps working on the old rule
-- (drafts finish songs) and "withdraw" answers 503 naming 193.

ALTER TABLE public.releases DROP CONSTRAINT IF EXISTS releases_state_check;
ALTER TABLE public.releases ADD CONSTRAINT releases_state_check
  CHECK (state IN ('draft', 'delivered', 'withdrawn', 'cancelled'));

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
        WHERE t.id = p_track AND t.type = 'song'
          AND r.state <> 'cancelled'
          AND (r.state IN ('delivered', 'withdrawn') OR r.imported_released)
      )
    );
$$;

ALTER FUNCTION public.labelos_track_is_finished(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_track_is_finished(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.labelos_track_is_finished(uuid) FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
