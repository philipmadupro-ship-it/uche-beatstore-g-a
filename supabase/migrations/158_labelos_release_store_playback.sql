-- 158_labelos_release_store_playback.sql
-- Label OS (LABEL-42): the storefront bridge for released music.
--
-- 144 already holds everything a listing needs (`store_listed`,
-- `store_listed_at`, `imported_released` and the CHECKs that a release is
-- listed only when it is delivered or imported). The one thing LABEL-42 adds
-- is how a listed release PLAYS to a visitor, which is a per-release choice
-- (14, LABEL-42 §2): the 75 s preview clip, or the full recording.
--
--   releases.store_playback  'preview' (default) | 'full'
--
-- Plus one trigger (below) that holds a listed release's tracklist.
-- Nothing else changes: no policy, no grant. `releases` stays org-only with
-- service-role writes; the public store reads it through server routes that
-- check `store_listed` themselves, so no anon policy is added here.
--
-- Idempotent: IF NOT EXISTS, DROP CONSTRAINT IF EXISTS first.

ALTER TABLE public.releases
  ADD COLUMN IF NOT EXISTS store_playback text NOT NULL DEFAULT 'preview';

ALTER TABLE public.releases DROP CONSTRAINT IF EXISTS releases_store_playback_check;
ALTER TABLE public.releases ADD CONSTRAINT releases_store_playback_check
  CHECK (store_playback IN ('preview', 'full'));

-- ── A tracklist on the store is held in the database too ─────────────────
-- Each item's public preview is promoted for the exact tracklist that was
-- listed, so while a release is on the store its items do not change: not
-- added, not edited, not removed, not reordered — by any path, including a
-- request that raced the route's own lock. The release row itself being
-- deleted (or its organization purged) removes its items by cascade, and by
-- then the parent is gone, so the check finds nothing to hold them for.
CREATE OR REPLACE FUNCTION public.release_items_store_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_release uuid := COALESCE(NEW.release_id, OLD.release_id);
BEGIN
  -- The organization's own purge deletes its items by cascade, possibly before its releases: a release
  -- whose organization is already gone holds nothing.
  IF EXISTS (
    SELECT 1 FROM public.releases r
    JOIN public.organizations o ON o.id = r.org_id
    WHERE r.id = v_release AND r.store_listed
  ) THEN
    RAISE EXCEPTION 'release_items: take the release off the store to change its tracklist' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

ALTER FUNCTION public.release_items_store_lock() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.release_items_store_lock() FROM PUBLIC;

DROP TRIGGER IF EXISTS release_items_store_lock ON public.release_items;
CREATE TRIGGER release_items_store_lock BEFORE INSERT OR UPDATE OR DELETE ON public.release_items
  FOR EACH ROW EXECUTE FUNCTION public.release_items_store_lock();

NOTIFY pgrst, 'reload schema';
