-- 120: only the producer may create or edit share_links through RLS.
--
-- share_links_owner_insert / _update only required auth.uid() = user_id.
-- Buyers hold Supabase sessions, so a buyer could insert a share row of
-- their own via PostgREST listing ANY track ids with allow_downloads = true
-- or sales_enabled = true. The share routes now also check that the share's
-- owner is the producer and owns each track (lib/share/share-owner.ts);
-- this closes the write at the source. /api/share writes with the service
-- role and is unaffected.
--
-- is_producer() is defined in 119. It is re-declared here (identically, so a
-- re-run is a no-op) because 120 was run on a database where 119 had not
-- been, and failed with 42883 "function public.is_producer() does not exist".
-- This file no longer depends on 119 having run first.

CREATE OR REPLACE FUNCTION public.is_producer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.creator_profiles WHERE user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.is_producer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_producer() TO authenticated, anon;

DROP POLICY IF EXISTS share_links_owner_insert ON public.share_links;
CREATE POLICY share_links_owner_insert ON public.share_links
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.is_producer()));

DROP POLICY IF EXISTS share_links_owner_update ON public.share_links;
CREATE POLICY share_links_owner_update ON public.share_links
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.is_producer()));

NOTIFY pgrst, 'reload schema';
