-- 053_reconcile_null_owners.sql
--
-- Migrations 050 + 051 reassigned tracks/projects/playlists owned by
-- non-populated creator_profiles to the real producer. They didn't
-- cover rows with user_id = NULL outright (the IN(...) clause skips
-- NULL semantics). Migration 050 explicitly handled NULL user_id on
-- tracks; this migration extends the same pattern to projects and
-- playlists so single-producer storefronts don't have NULL-owner
-- rows lingering.
--
-- Idempotent. No-op when there's not exactly one populated profile.

DO $$
DECLARE
  real_user_id uuid;
  populated_count int;
  fixed_projects int;
  fixed_playlists int;
BEGIN
  SELECT COUNT(*) INTO populated_count
  FROM creator_profiles
  WHERE display_name IS NOT NULL;

  IF populated_count <> 1 THEN
    RAISE NOTICE 'Skipping reconciliation: % populated profiles (need exactly 1)', populated_count;
    RETURN;
  END IF;

  SELECT user_id INTO real_user_id
  FROM creator_profiles
  WHERE display_name IS NOT NULL
  LIMIT 1;

  WITH moved AS (
    UPDATE projects SET user_id = real_user_id WHERE user_id IS NULL RETURNING 1
  ) SELECT COUNT(*) INTO fixed_projects FROM moved;

  WITH moved AS (
    UPDATE playlists SET user_id = real_user_id WHERE user_id IS NULL RETURNING 1
  ) SELECT COUNT(*) INTO fixed_playlists FROM moved;

  RAISE NOTICE 'Reconciled NULL-owner rows: % projects + % playlists to %',
    fixed_projects, fixed_playlists, real_user_id;
END $$;

NOTIFY pgrst, 'reload schema';
