-- 119: only the producer may write catalogue rows through RLS.
--
-- tracks / projects / playlists use `owner_only` (097): USING and WITH CHECK
-- are `auth.uid() = user_id`. Buyers sign in through the same Supabase auth,
-- so any buyer could INSERT a track they "own" straight through PostgREST
-- with the anon key + their JWT — including `store_listed = true`,
-- `free_download_enabled = true` and an `audio_url` / `preview_url` naming an
-- object in the private bucket. /api/store/free-download and
-- /api/store/preview/[id] then streamed that object to anyone.
--
-- Writes now also require the caller to be the producer (has a
-- creator_profiles row — which, after 117, buyers can no longer create).
-- Reads are unchanged. All app writes use the service role and are
-- unaffected.

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

DROP POLICY IF EXISTS "owner_only" ON public.tracks;
CREATE POLICY "owner_only" ON public.tracks
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.is_producer()));

DROP POLICY IF EXISTS "owner_only" ON public.projects;
CREATE POLICY "owner_only" ON public.projects
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.is_producer()));

DROP POLICY IF EXISTS "owner_only" ON public.playlists;
CREATE POLICY "owner_only" ON public.playlists
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.is_producer()));

NOTIFY pgrst, 'reload schema';
