-- 097_strict_owned_rows.sql
-- Legacy NULL-owner rows must be migrated explicitly. They are no longer
-- readable or mutable by whichever authenticated user happens to address
-- them first.

DROP POLICY IF EXISTS "owner_or_legacy_null" ON public.tracks;
CREATE POLICY "owner_only" ON public.tracks
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "owner_or_legacy_null" ON public.playlists;
CREATE POLICY "owner_only" ON public.playlists
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "public and team access" ON public.projects;
DROP POLICY IF EXISTS "owner_or_legacy_null" ON public.projects;
CREATE POLICY "owner_only" ON public.projects
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "owner_via_playlist" ON public.playlist_tracks;
CREATE POLICY "owner_via_playlist" ON public.playlist_tracks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.playlists p
      WHERE p.id = playlist_tracks.playlist_id
        AND p.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.playlists p
      WHERE p.id = playlist_tracks.playlist_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "owner_via_project" ON public.project_tracks;
CREATE POLICY "owner_via_project" ON public.project_tracks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_tracks.project_id
        AND p.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_tracks.project_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "owner_via_track" ON public.track_versions;
CREATE POLICY "owner_via_track" ON public.track_versions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.tracks t
      WHERE t.id = track_versions.track_id
        AND t.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tracks t
      WHERE t.id = track_versions.track_id
        AND t.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "owner_or_legacy_null" ON public.contacts;
CREATE POLICY "owner_only" ON public.contacts
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "owner_via_contact" ON public.beat_sends;
CREATE POLICY "owner_via_contact" ON public.beat_sends
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = beat_sends.contact_id
        AND c.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = beat_sends.contact_id
        AND c.user_id = (SELECT auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';
