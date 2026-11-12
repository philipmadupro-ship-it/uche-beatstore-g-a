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
--
-- Label OS (142) amendment: an org project has user_id NULL on purpose
-- (projects_org_or_owner) and is NOT an orphan. scripts/apply-migrations.sh replays every
-- file, so the backfill below skips rows with an org_id. `to_jsonb(row) ->>
-- 'org_id'` is used instead of the column because on a fresh database this
-- file runs before 141 adds it (a missing key reads as NULL). On a database
-- without org rows — production when this was written — the effect is
-- unchanged. Same pattern as LABEL-10's amendment of 111.

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
    UPDATE projects p SET user_id = real_user_id WHERE p.user_id IS NULL AND (to_jsonb(p) ->> 'org_id') IS NULL RETURNING 1
  ) SELECT COUNT(*) INTO fixed_projects FROM moved;

  WITH moved AS (
    UPDATE playlists SET user_id = real_user_id WHERE user_id IS NULL RETURNING 1
  ) SELECT COUNT(*) INTO fixed_playlists FROM moved;

  RAISE NOTICE 'Reconciled NULL-owner rows: % projects + % playlists to %',
    fixed_projects, fixed_playlists, real_user_id;
END $$;

NOTIFY pgrst, 'reload schema';
