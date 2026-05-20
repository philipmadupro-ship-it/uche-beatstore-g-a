-- Allow project_shares to represent any content (project, playlist, or track).
-- project_id becomes nullable; content_type discriminates the row.

ALTER TABLE project_shares
  ADD COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT 'project'
    CHECK (content_type IN ('project', 'playlist', 'track')),
  ADD COLUMN IF NOT EXISTS playlist_id uuid REFERENCES playlists(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS track_id  uuid REFERENCES tracks(id)    ON DELETE CASCADE;

-- project_id is now optional so playlist and track shares don't need a dummy project.
ALTER TABLE project_shares ALTER COLUMN project_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS project_shares_playlist_id_idx ON project_shares(playlist_id)
  WHERE playlist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_shares_track_id_idx ON project_shares(track_id)
  WHERE track_id IS NOT NULL;

-- RLS: owner can also access via playlist/track ownership when project_id is null.
-- The existing policy "owner can read/write if they own the project" still fires
-- for project rows. We add a parallel policy for playlist and track rows.
-- (Policy names must be unique per table.)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'project_shares' AND policyname = 'owner can manage playlist shares'
  ) THEN
    CREATE POLICY "owner can manage playlist shares"
      ON project_shares
      FOR ALL
      USING (
        playlist_id IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM playlists p
          WHERE p.id = project_shares.playlist_id
            AND p.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'project_shares' AND policyname = 'owner can manage track shares'
  ) THEN
    CREATE POLICY "owner can manage track shares"
      ON project_shares
      FOR ALL
      USING (
        track_id IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM tracks t
          WHERE t.id = project_shares.track_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
