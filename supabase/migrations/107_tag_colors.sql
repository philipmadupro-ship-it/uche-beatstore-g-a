-- Tag colours
--
-- A producer browsing a catalogue by eye reads colour before text. Generated
-- artwork keyed only to a row id encodes nothing about the music, so two Trap
-- beats look no more related than a Trap beat and an Amapiano one.
--
-- Giving tags colours makes the artwork mean something: every Trap beat leads
-- on the Trap colour, so a genre is recognisable at a glance and a mistagged
-- beat stands out. Per-item variation still applies, just around a much
-- narrower hue spread.
--
-- Stored per user because this is a taste decision, not a fact: one producer's
-- Drill is midnight blue, another's is red. The app ships curated defaults for
-- the built-in taxonomy, so an untouched account is already colour-coded and
-- nobody has to assign twenty tags before seeing the benefit.

CREATE TABLE IF NOT EXISTS tag_colors (
  user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Lower-cased at write time; the app normalises before querying so 'Trap'
  -- and 'trap' can never end up as two rows with different colours.
  tag      TEXT NOT NULL,
  category TEXT,
  color    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tag)
);

COMMENT ON TABLE tag_colors IS
  'Per-producer colour assigned to a tag. Anchors generated cover artwork so all beats sharing a tag share a hue. Absent = the app''s curated default for that tag, or a stable hash for unknown tags.';

ALTER TABLE tag_colors ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tag_colors' AND policyname = 'tag_colors_owner_all'
  ) THEN
    CREATE POLICY tag_colors_owner_all ON tag_colors
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- The read path is always "every colour for this user", loaded once and held
-- in memory, so the primary key already covers it. No extra index.

NOTIFY pgrst, 'reload schema';
