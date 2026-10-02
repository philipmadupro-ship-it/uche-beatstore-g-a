-- Rollback for 142_labelos_project_tracks_same_org.sql (LABEL-14).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Order matters, as in 141's rollback:
--   1. org rows are DELETED while org_id still says which they are — they have
--      no user_id, and NOT NULL cannot come back while they exist. Their
--      track_links / project_tracks / #44 child rows go by cascade;
--   2. the CHECKs go, NOT NULL comes back on projects.user_id and
--      track_links.user_id (every remaining row is a producer row with one);
--   3. track_links_same_owner is put back as 141 wrote it;
--   4. the project_tracks trigger and its function go.

DELETE FROM public.track_links tl
 USING public.tracks t
 WHERE t.id = tl.from_track_id AND t.org_id IS NOT NULL;
DELETE FROM public.projects WHERE org_id IS NOT NULL;
DELETE FROM public.tracks WHERE org_id IS NOT NULL;

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_org_or_owner;
ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_org_or_owner;
ALTER TABLE public.projects ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.track_links ALTER COLUMN user_id SET NOT NULL;

-- 141 §4's version.
CREATE OR REPLACE FUNCTION public.track_links_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tracks f
    JOIN public.tracks t ON t.id = NEW.to_track_id AND t.org_id = f.org_id
    WHERE f.id = NEW.from_track_id AND f.org_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.from_track_id AND t.user_id = NEW.user_id AND t.org_id IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.to_track_id AND t.user_id = NEW.user_id AND t.org_id IS NULL) THEN
    RAISE EXCEPTION 'track_links: both tracks must be owned by %', NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_tracks_same_owner ON public.project_tracks;
DROP FUNCTION IF EXISTS public.project_tracks_same_owner();

NOTIFY pgrst, 'reload schema';
