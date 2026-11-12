-- Rollback for 141_labelos_org_catalog.sql (LABEL-12).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Order matters:
--   1. the additive read policies go first, so nothing org-scoped is
--      readable through them while the rest unwinds;
--   2. org rows are DELETED while org_id still says which they are. Without
--      it they would be ordinary rows owned by whichever member's user_id
--      they carry, and that member's producer routes and owner policies
--      would show them. They are Label OS material, never the producer's.
--      Their #44 child rows go with them by cascade (project_contacts,
--      project_assets, song_beats, track_links, contact_track_states,
--      project_tracks, project_comments …). Portals and messages hang off
--      org CONTACTS, which stay (139);
--   3. the guards and the service-only write trigger go next — after the
--      delete, so no org row is ever left readable or writable through an
--      owner policy alone;
--   4. the #44 same-owner trigger functions are put back exactly as 122–133
--      wrote them, then the helpers, triggers and columns are dropped.
-- Audit events that name these rows stay (06 §6).

DROP POLICY IF EXISTS org_member_read ON public.tracks;
DROP POLICY IF EXISTS org_member_read ON public.projects;
DROP POLICY IF EXISTS org_member_read ON public.project_contacts;
DROP POLICY IF EXISTS org_member_read ON public.artist_portals;
DROP POLICY IF EXISTS org_member_read ON public.project_assets;
DROP POLICY IF EXISTS org_member_read ON public.song_beats;
DROP POLICY IF EXISTS org_member_read ON public.track_links;
DROP POLICY IF EXISTS org_member_read ON public.artist_messages;
DROP POLICY IF EXISTS org_member_read ON public.contact_track_states;
DROP POLICY IF EXISTS org_member_read ON public.project_comments;

DELETE FROM public.tracks WHERE org_id IS NOT NULL;
DELETE FROM public.projects WHERE org_id IS NOT NULL;
DELETE FROM public.artist_portals ap USING public.contacts c WHERE c.id = ap.contact_id AND c.org_id IS NOT NULL;
DELETE FROM public.artist_messages am USING public.contacts c WHERE c.id = am.contact_id AND c.org_id IS NOT NULL;
DELETE FROM public.contact_track_states s USING public.contacts c WHERE c.id = s.contact_id AND c.org_id IS NOT NULL;

DROP POLICY IF EXISTS org_member_guard ON public.tracks;
DROP POLICY IF EXISTS org_member_guard ON public.projects;
DROP POLICY IF EXISTS org_member_guard ON public.project_contacts;
DROP POLICY IF EXISTS org_member_guard ON public.artist_portals;
DROP POLICY IF EXISTS org_member_guard ON public.project_assets;
DROP POLICY IF EXISTS org_member_guard ON public.song_beats;
DROP POLICY IF EXISTS org_member_guard ON public.track_links;
DROP POLICY IF EXISTS org_member_guard ON public.artist_messages;
DROP POLICY IF EXISTS org_member_guard ON public.contact_track_states;
DROP POLICY IF EXISTS org_member_guard ON public.project_comments;
DROP POLICY IF EXISTS org_member_guard ON public.project_tracks;
DROP POLICY IF EXISTS org_member_guard ON public.project_shares;
DROP POLICY IF EXISTS org_member_guard ON public.track_versions;
DROP POLICY IF EXISTS org_member_guard ON public.track_collaborators;
DROP POLICY IF EXISTS org_member_guard ON public.track_licenses;
DROP POLICY IF EXISTS org_member_guard ON public.play_head_pings;
DROP POLICY IF EXISTS org_member_guard ON public.store_free_downloads;
DROP POLICY IF EXISTS org_member_guard ON public.project_tags;
DROP POLICY IF EXISTS org_member_guard ON public.project_folder_items;
DROP POLICY IF EXISTS org_member_guard ON public.project_access_links;

DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.tracks;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.projects;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.project_contacts;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.artist_portals;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.project_assets;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.song_beats;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.track_links;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.artist_messages;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.contact_track_states;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.project_comments;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.project_tracks;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.project_shares;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.track_versions;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.track_collaborators;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.track_licenses;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.project_tags;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.project_folder_items;
DROP FUNCTION IF EXISTS public.labelos_org_rows_service_only();

-- ── #44 trigger functions, verbatim ─────────────────────────────────────

-- 122
CREATE OR REPLACE FUNCTION public.project_contacts_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'project_contacts: project % is not owned by %', NEW.project_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'project_contacts: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 123
CREATE OR REPLACE FUNCTION public.contact_track_states_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'contact_track_states: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.track_id AND t.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'contact_track_states: track % is not owned by %', NEW.track_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 124
CREATE OR REPLACE FUNCTION public.tracks_beat_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.beat_track_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tracks b WHERE b.id = NEW.beat_track_id AND b.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'tracks.beat_track_id: beat % is not owned by the song''s owner', NEW.beat_track_id;
  END IF;
  RETURN NEW;
END $$;

-- 125
CREATE OR REPLACE FUNCTION public.artist_portals_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'artist_portals: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 127
CREATE OR REPLACE FUNCTION public.project_assets_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'project_assets: project % is not owned by %', NEW.project_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 128
CREATE OR REPLACE FUNCTION public.project_comments_contact_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.contacts c ON c.user_id = p.user_id
    WHERE p.id = NEW.project_id AND c.id = NEW.contact_id
  ) THEN
    RAISE EXCEPTION 'project_comments: contact % does not belong to the owner of project %', NEW.contact_id, NEW.project_id;
  END IF;
  RETURN NEW;
END $$;

-- 130
CREATE OR REPLACE FUNCTION public.artist_messages_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'artist_messages: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'artist_messages: project % is not owned by %', NEW.project_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 132
CREATE OR REPLACE FUNCTION public.song_beats_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.song_track_id AND t.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'song_beats: song % is not owned by %', NEW.song_track_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.beat_track_id AND t.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'song_beats: beat % is not owned by %', NEW.beat_track_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 133
CREATE OR REPLACE FUNCTION public.track_links_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.from_track_id AND t.user_id = NEW.user_id)
     OR NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.to_track_id AND t.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'track_links: both tracks must be owned by %', NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- ── Helpers, triggers, columns ──────────────────────────────────────────

DROP FUNCTION IF EXISTS public.labelos_is_org_project(uuid);
DROP FUNCTION IF EXISTS public.labelos_is_org_track(uuid);
DROP FUNCTION IF EXISTS public.labelos_is_org_contact(uuid);
DROP FUNCTION IF EXISTS public.can_read_org_track(uuid, uuid);
DROP FUNCTION IF EXISTS public.labelos_track_is_finished(uuid);
DROP FUNCTION IF EXISTS public.can_see_org_track(uuid, uuid);
DROP FUNCTION IF EXISTS public.can_see_org_project(uuid, uuid);
DROP FUNCTION IF EXISTS public.labelos_sees_whole_org(uuid);

DROP TRIGGER IF EXISTS projects_inbox_same_org ON public.projects;
DROP FUNCTION IF EXISTS public.projects_inbox_same_org();
DROP TRIGGER IF EXISTS tracks_org_is_fixed ON public.tracks;
DROP TRIGGER IF EXISTS projects_org_is_fixed ON public.projects;
DROP FUNCTION IF EXISTS public.labelos_org_is_fixed();

DROP INDEX IF EXISTS public.projects_inbox_for_contact_uniq;
DROP INDEX IF EXISTS public.idx_projects_org_created;
DROP INDEX IF EXISTS public.idx_tracks_org_created;
ALTER TABLE public.projects DROP COLUMN IF EXISTS inbox_for_contact_id;
ALTER TABLE public.projects DROP COLUMN IF EXISTS org_id;
ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_isrc_format;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS isrc;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS created_by;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS org_id;

NOTIFY pgrst, 'reload schema';
