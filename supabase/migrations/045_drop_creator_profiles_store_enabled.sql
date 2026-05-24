-- 045_drop_creator_profiles_store_enabled.sql
-- Removes the store_enabled kill-switch from creator_profiles.
--
-- Why: the store-editor UI no longer exposes the toggle and writes
-- store_enabled = true unconditionally on every save. The column has
-- become dead state; api/store still selects it but no consumer reads
-- the value. Drop it so schema matches behavior.
--
-- If a future product change wants the toggle back, add it via a new
-- migration — don't try to detect "are we on the old schema" in app code.

ALTER TABLE public.creator_profiles
  DROP COLUMN IF EXISTS store_enabled;

NOTIFY pgrst, 'reload schema';
