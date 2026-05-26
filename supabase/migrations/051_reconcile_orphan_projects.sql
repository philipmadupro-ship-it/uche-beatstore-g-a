-- 051_reconcile_orphan_projects.sql
--
-- Migration 050 reconciled orphan tracks (user_id pointing at the
-- placeholder creator_profile with display_name=null) to the real
-- producer. Projects + playlists were left behind — three featured
-- projects were still orphan-owned, so they passed the
-- `store_featured = true` filter but were excluded by the
-- `.or('user_id.eq.<real-seller>,user_id.is.null')` clause in
-- /api/store. Result: featured projects on store-editor never
-- appeared on /store.
--
-- This migration extends 050's logic to projects + playlists by
-- reassigning rows owned by any non-populated creator_profile (one
-- without a display_name) to the single populated one, when there's
-- exactly one.
--
-- Idempotent: a second run finds nothing to move and does nothing.

DO $$
DECLARE
  real_user_id uuid;
  orphan_count int;
  populated_count int;
  moved_projects int;
  moved_playlists int;
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

  -- Projects owned by any orphan (non-populated) creator_profile
  WITH moved AS (
    UPDATE projects
       SET user_id = real_user_id
     WHERE user_id IN (
       SELECT user_id FROM creator_profiles WHERE display_name IS NULL
     )
     RETURNING 1
  )
  SELECT COUNT(*) INTO moved_projects FROM moved;

  -- Playlists owned by any orphan creator_profile
  WITH moved AS (
    UPDATE playlists
       SET user_id = real_user_id
     WHERE user_id IN (
       SELECT user_id FROM creator_profiles WHERE display_name IS NULL
     )
     RETURNING 1
  )
  SELECT COUNT(*) INTO moved_playlists FROM moved;

  RAISE NOTICE 'Reconciled % projects + % playlists to %',
    moved_projects, moved_playlists, real_user_id;
END $$;

NOTIFY pgrst, 'reload schema';
