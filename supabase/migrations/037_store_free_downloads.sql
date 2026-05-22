-- 037_store_free_downloads.sql
-- Captures visitor email + track ID whenever a visitor completes a
-- free-download flow on the public store. Used for lead capture / CRM.

CREATE TABLE IF NOT EXISTS store_free_downloads (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id      uuid        NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  email         text        NOT NULL,
  downloaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_free_downloads_track_id_idx ON store_free_downloads(track_id);
CREATE INDEX IF NOT EXISTS store_free_downloads_email_idx    ON store_free_downloads(email);

-- Row-level security: no public insert policy needed — the route uses the
-- service-role client. The owner can see all rows for their tracks.
ALTER TABLE store_free_downloads ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'store_free_downloads' AND policyname = 'owner can read free downloads'
  ) THEN
    CREATE POLICY "owner can read free downloads"
      ON store_free_downloads FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM tracks t
          WHERE t.id = store_free_downloads.track_id
            AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
