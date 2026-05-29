-- 065_maq_status.sql
-- Adds the 'maq' (maquette) status to the tracks table.
-- MAQ = stripped/bare demo version of a track, the earliest stage
-- before WIP (needs_work). The CHECK constraint on tracks.status may
-- or may not exist depending on when the schema was applied; we drop
-- and re-add it idempotently to include 'maq'.

DO $$
BEGIN
  -- Drop existing check constraint if present (name may vary, so we
  -- target it by condition text via pg_constraint).
  DECLARE
    v_constraint_name text;
  BEGIN
    SELECT conname INTO v_constraint_name
      FROM pg_constraint
      WHERE conrelid = 'public.tracks'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%needs_work%'
      LIMIT 1;

    IF v_constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.tracks DROP CONSTRAINT %I', v_constraint_name);
    END IF;
  END;

  -- Re-add with 'maq' included.
  ALTER TABLE public.tracks
    ADD CONSTRAINT tracks_status_check
    CHECK (status IN ('finished', 'needs_work', 'archived', 'maq'));
EXCEPTION
  WHEN duplicate_object THEN NULL; -- constraint already added
END $$;

NOTIFY pgrst, 'reload schema';
