-- 120: only the producer may create or edit share_links through RLS.
--
-- share_links_owner_insert / _update only required auth.uid() = user_id.
-- Buyers hold Supabase sessions, so a buyer could insert a share row of
-- their own via PostgREST listing ANY track ids with allow_downloads = true
-- or sales_enabled = true. The share routes now also check that the share's
-- owner is the producer and owns each track (lib/share/share-owner.ts);
-- this closes the write at the source. Requires is_producer() from 119.
-- /api/share writes with the service role and is unaffected.

DROP POLICY IF EXISTS share_links_owner_insert ON public.share_links;
CREATE POLICY share_links_owner_insert ON public.share_links
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.is_producer()));

DROP POLICY IF EXISTS share_links_owner_update ON public.share_links;
CREATE POLICY share_links_owner_update ON public.share_links
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.is_producer()));

NOTIFY pgrst, 'reload schema';
