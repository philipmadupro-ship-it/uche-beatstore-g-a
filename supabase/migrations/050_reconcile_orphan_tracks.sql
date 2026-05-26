-- 050_reconcile_orphan_tracks.sql
--
-- Some tracks were created with user_id = NULL (likely seed data or
-- early-dev imports before the upload pipeline set ownership). They
-- still appear on the public /store via the `user_id IS NULL` branch
-- of the seller filter, but they don't show up on the producer's own
-- /store/producer/[slug] page because there's no owner to match.
--
-- This migration assigns any orphan tracks to the single real
-- creator_profile when there's exactly one populated (display_name
-- IS NOT NULL) profile. Multi-producer setups are a no-op — we
-- can't guess attribution.
--
-- Idempotent: a second run finds no orphans and does nothing.

DO $$
DECLARE
  real_user_id uuid;
  populated_count int;
BEGIN
  SELECT COUNT(*) INTO populated_count
  FROM creator_profiles
  WHERE display_name IS NOT NULL;

  IF populated_count = 1 THEN
    SELECT user_id INTO real_user_id
    FROM creator_profiles
    WHERE display_name IS NOT NULL
    LIMIT 1;

    UPDATE tracks
    SET user_id = real_user_id
    WHERE user_id IS NULL;

    RAISE NOTICE 'Reconciled orphan tracks to %', real_user_id;
  ELSE
    RAISE NOTICE 'Skipping reconciliation: % populated profiles (need exactly 1)', populated_count;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
