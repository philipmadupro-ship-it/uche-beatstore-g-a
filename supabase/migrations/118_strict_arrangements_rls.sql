-- 118: owner-only RLS on arrangements.
--
-- 097 retired the legacy `user_id IS NULL` allowance on every owned table
-- but missed arrangements (014). Its four policies still accept
-- `user_id IS NULL`, and for the anon role auth.uid() is NULL too, so anyone
-- holding the public anon key could read, overwrite or delete null-owner
-- arrangements and insert new ones with no owner via PostgREST.
--
-- The only app path (/api/tracks/[id]/arrangement) writes with the service
-- role after requireRowOwnership and stamps user_id, so nothing legitimate
-- depends on the null branch.

DROP POLICY IF EXISTS arrangements_select ON public.arrangements;
CREATE POLICY arrangements_select ON public.arrangements
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS arrangements_insert ON public.arrangements;
CREATE POLICY arrangements_insert ON public.arrangements
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS arrangements_update ON public.arrangements;
CREATE POLICY arrangements_update ON public.arrangements
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS arrangements_delete ON public.arrangements;
CREATE POLICY arrangements_delete ON public.arrangements
  FOR DELETE USING ((SELECT auth.uid()) = user_id);

NOTIFY pgrst, 'reload schema';
