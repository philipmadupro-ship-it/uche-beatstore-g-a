-- Finish what 097_strict_owned_rows started, and close a PII read.
--
-- 1. Owner-only, not owner-or-null. 097 retired the legacy `user_id IS NULL`
--    allowance on tracks/playlists/projects/contacts and their main child
--    tables, but these later/child tables kept it:
--      arrangements (014), project_shares + project_comments (011),
--      project_tags (081), project_folder_items (083), playlist_tags (086),
--      playlist_folder_items (088), contact_tags (091).
--    Buyers sign in through the same Supabase auth and the anon key is
--    public, so any signed-in buyer could read or write child rows of any
--    null-owned parent, including project_shares tokens, and insert
--    null-owned arrangements. Every app path to these tables already uses
--    the service role after an ownership check, so the app is unaffected.
--
-- 2. beat_comments_public_read (058) let anyone with the anon key SELECT
--    every visible comment's author_email and ip_hash. The app never used
--    it: /api/store/comments/[trackId] reads through the service role and
--    selects only public columns. The owner read policy stays.
--
-- Idempotent. Mirrors 097's `(SELECT auth.uid())` form.

DROP POLICY IF EXISTS beat_comments_public_read ON public.beat_comments;

DO $$ BEGIN
  IF to_regclass('public.arrangements') IS NOT NULL THEN
    DROP POLICY IF EXISTS arrangements_select ON public.arrangements;
    DROP POLICY IF EXISTS arrangements_insert ON public.arrangements;
    DROP POLICY IF EXISTS arrangements_update ON public.arrangements;
    DROP POLICY IF EXISTS arrangements_delete ON public.arrangements;
    DROP POLICY IF EXISTS owner_only ON public.arrangements;
    CREATE POLICY owner_only ON public.arrangements
      FOR ALL
      USING ((SELECT auth.uid()) = user_id)
      WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.project_shares') IS NOT NULL THEN
    DROP POLICY IF EXISTS owner_via_project ON public.project_shares;
    CREATE POLICY owner_via_project ON public.project_shares
      FOR ALL
      USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_shares.project_id AND p.user_id = (SELECT auth.uid())))
      WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_shares.project_id AND p.user_id = (SELECT auth.uid())));
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.project_comments') IS NOT NULL THEN
    DROP POLICY IF EXISTS owner_via_project ON public.project_comments;
    CREATE POLICY owner_via_project ON public.project_comments
      FOR ALL
      USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_comments.project_id AND p.user_id = (SELECT auth.uid())))
      WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_comments.project_id AND p.user_id = (SELECT auth.uid())));
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.project_tags') IS NOT NULL THEN
    DROP POLICY IF EXISTS project_tags_via_parent ON public.project_tags;
    CREATE POLICY project_tags_via_parent ON public.project_tags
      FOR ALL
      USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_tags.project_id AND p.user_id = (SELECT auth.uid())))
      WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_tags.project_id AND p.user_id = (SELECT auth.uid())));
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.project_folder_items') IS NOT NULL THEN
    DROP POLICY IF EXISTS project_folder_items_via_parent ON public.project_folder_items;
    CREATE POLICY project_folder_items_via_parent ON public.project_folder_items
      FOR ALL
      USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_folder_items.project_id AND p.user_id = (SELECT auth.uid())))
      WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_folder_items.project_id AND p.user_id = (SELECT auth.uid())));
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.playlist_tags') IS NOT NULL THEN
    DROP POLICY IF EXISTS playlist_tags_via_parent ON public.playlist_tags;
    CREATE POLICY playlist_tags_via_parent ON public.playlist_tags
      FOR ALL
      USING (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_tags.playlist_id AND p.user_id = (SELECT auth.uid())))
      WITH CHECK (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_tags.playlist_id AND p.user_id = (SELECT auth.uid())));
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.playlist_folder_items') IS NOT NULL THEN
    DROP POLICY IF EXISTS playlist_folder_items_via_parent ON public.playlist_folder_items;
    CREATE POLICY playlist_folder_items_via_parent ON public.playlist_folder_items
      FOR ALL
      USING (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_folder_items.playlist_id AND p.user_id = (SELECT auth.uid())))
      WITH CHECK (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_folder_items.playlist_id AND p.user_id = (SELECT auth.uid())));
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.contact_tags') IS NOT NULL THEN
    DROP POLICY IF EXISTS contact_tags_via_parent ON public.contact_tags;
    CREATE POLICY contact_tags_via_parent ON public.contact_tags
      FOR ALL
      USING (EXISTS (SELECT 1 FROM public.contacts p WHERE p.id = contact_tags.contact_id AND p.user_id = (SELECT auth.uid())))
      WITH CHECK (EXISTS (SELECT 1 FROM public.contacts p WHERE p.id = contact_tags.contact_id AND p.user_id = (SELECT auth.uid())));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
