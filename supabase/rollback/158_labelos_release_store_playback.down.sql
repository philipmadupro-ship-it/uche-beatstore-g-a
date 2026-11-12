-- Rollback for 158_labelos_release_store_playback.sql (LABEL-42).
-- Drops the per-release playback choice; a listed release then plays as a preview again once the code is reverted.
DROP TRIGGER IF EXISTS release_items_store_lock ON public.release_items;
DROP FUNCTION IF EXISTS public.release_items_store_lock();
ALTER TABLE public.releases DROP CONSTRAINT IF EXISTS releases_store_playback_check;
ALTER TABLE public.releases DROP COLUMN IF EXISTS store_playback;
NOTIFY pgrst, 'reload schema';
