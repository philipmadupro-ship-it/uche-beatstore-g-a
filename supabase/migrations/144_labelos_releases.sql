-- 144_labelos_releases.sql
-- Label OS (LABEL-16): releases and their tracklists, built on song tracks
-- (17 R1 / R2 / R9). Two new org-only tables.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 143 (docs/bstudio-label-os/16-execution-runbook.md).
--
-- Expand only. No existing row changes; the producer app never reads or
-- writes either table.
--
--   1. `releases` — org_id NOT NULL, NO user_id (the 139 / 142 / 143 rule:
--      no producer route, all of which filter on user_id, can reach one).
--      Always has a project (R2: its artwork and documents are that
--      project's files); the route creates one when none is given. The 05
--      fields, with `artist_id` → `contact_id` (R3) and `artwork_file_id` →
--      `artwork_asset_id` (R2). Only terminal / manual facts are stored
--      (state, delivered_at, store_listed); gates and "released" are derived
--      (LABEL-32 / 33). CHECKs: type and state lists, the UPC format
--      (lib/labelos/identifiers — the route also verifies the check digit),
--      delivered ⇒ delivered_at, listed ⇒ listed_at, and only a delivered or
--      imported-as-released release may be listed (15: unreleased music
--      stays private).
--   2. `release_items(release_id, position, song_track_id, master_track_id,
--      version_title, explicit)` + org_id (taken from the release by the
--      trigger, so policies and list reads key on the tenant directly).
--      UNIQUE (release_id, position) is DEFERRABLE INITIALLY DEFERRED, and a
--      deferred constraint trigger holds positions at exactly 1..n at COMMIT,
--      so a reorder or a remove-and-close-the-gap runs as one transaction
--      (§5's functions) and nothing commits a gap.
--   3. Integrity triggers:
--        releases_integrity — org and project are fixed once written; the
--          project and the artist contact are of the release's org; the
--          artwork is an artwork / photo file of the release's own project.
--        release_items_integrity — the release fixes the item's org; the song
--          is a `type = 'song'` track of that org; the master is the song
--          itself, or a track of that org the song links to (track_links,
--          from the song) as master, instrumental or version.
--      And three guards keep those true afterwards: an artwork file of a
--      release cannot change kind or project; a song on a release cannot
--      change type; the link that makes a track an item's master cannot be
--      removed or turned into another relation. (A link or track deleted by
--      a cascade from its parent track passes: the item's own foreign keys
--      decide that case at the end of the statement.)
--   4. RLS on both, ONE SELECT policy each, TO authenticated: catalog.read +
--      project scope (`can_see_org_project` on the release's project), the
--      rule of 141 / 143. No write policy: writes go through the service
--      role only, and 141's `labelos_org_rows_service_only` trigger refuses
--      the API roles outright.
--   5. `labelos_release_items_reorder(org, release, item ids[])` and
--      `labelos_release_item_remove(org, release, item)`: the two
--      multi-row tracklist writes, each atomic, service_role only.
--   6. "On a release" makes a mix finished (06 §2.3, carried from LABEL-13):
--      `labelos_track_is_finished` (141) is replaced with the same rule plus
--      one arm — a song's own audio is finished when the song is an item of
--      a release that is not cancelled. Its TS twins move with it:
--      lib/labelos/org-read#orgTrackReadClass (rows) and
--      lib/labelos/org-audio#recordingContexts (the audio route).
--
-- Proven as anon / authenticated / service_role in
-- supabase/local/checks/144_labelos_releases.sql and held by
-- src/lib/security/rls-final-state.test.ts.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS first.

-- ── 1 + 2. Tables ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.releases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES public.projects(id),
  contact_id        uuid NOT NULL REFERENCES public.contacts(id),
  title             text NOT NULL,
  type              text NOT NULL DEFAULT 'single',
  upc               text,
  label_name        text,
  c_line            text,
  p_line            text,
  primary_genre     text,
  target_date       date,
  release_date      date,
  artwork_asset_id  uuid REFERENCES public.project_assets(id) ON DELETE SET NULL,
  state             text NOT NULL DEFAULT 'draft',
  delivered_at      timestamptz,
  delivered_to      text,
  imported_released boolean NOT NULL DEFAULT false,
  store_listed      boolean NOT NULL DEFAULT false,
  store_listed_at   timestamptz,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.releases DROP CONSTRAINT IF EXISTS releases_type_check;
ALTER TABLE public.releases ADD CONSTRAINT releases_type_check
  CHECK (type IN ('single', 'ep', 'album', 'mixtape', 'compilation'));
ALTER TABLE public.releases DROP CONSTRAINT IF EXISTS releases_state_check;
ALTER TABLE public.releases ADD CONSTRAINT releases_state_check
  CHECK (state IN ('draft', 'delivered', 'cancelled'));
ALTER TABLE public.releases DROP CONSTRAINT IF EXISTS releases_upc_format;
ALTER TABLE public.releases ADD CONSTRAINT releases_upc_format
  CHECK (upc IS NULL OR upc ~ '^[0-9]{12,13}$');
ALTER TABLE public.releases DROP CONSTRAINT IF EXISTS releases_title_length;
ALTER TABLE public.releases ADD CONSTRAINT releases_title_length
  CHECK (char_length(btrim(title)) BETWEEN 1 AND 300);
ALTER TABLE public.releases DROP CONSTRAINT IF EXISTS releases_delivered_at;
ALTER TABLE public.releases ADD CONSTRAINT releases_delivered_at
  CHECK (state <> 'delivered' OR delivered_at IS NOT NULL);
ALTER TABLE public.releases DROP CONSTRAINT IF EXISTS releases_store_listed_at;
ALTER TABLE public.releases ADD CONSTRAINT releases_store_listed_at
  CHECK (NOT store_listed OR store_listed_at IS NOT NULL);
ALTER TABLE public.releases DROP CONSTRAINT IF EXISTS releases_store_listed_released;
ALTER TABLE public.releases ADD CONSTRAINT releases_store_listed_released
  CHECK (NOT store_listed OR state = 'delivered' OR imported_released);

CREATE INDEX IF NOT EXISTS idx_releases_org ON public.releases (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_releases_project ON public.releases (project_id);
CREATE INDEX IF NOT EXISTS idx_releases_contact ON public.releases (contact_id);
CREATE INDEX IF NOT EXISTS idx_releases_artwork ON public.releases (artwork_asset_id) WHERE artwork_asset_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.release_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id      uuid NOT NULL REFERENCES public.releases(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  position        int NOT NULL,
  song_track_id   uuid NOT NULL REFERENCES public.tracks(id),
  master_track_id uuid NOT NULL REFERENCES public.tracks(id),
  version_title   text,
  explicit        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT release_items_position_key UNIQUE (release_id, position) DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE public.release_items DROP CONSTRAINT IF EXISTS release_items_position_positive;
ALTER TABLE public.release_items ADD CONSTRAINT release_items_position_positive CHECK (position >= 1);
ALTER TABLE public.release_items DROP CONSTRAINT IF EXISTS release_items_version_title_length;
ALTER TABLE public.release_items ADD CONSTRAINT release_items_version_title_length
  CHECK (version_title IS NULL OR char_length(version_title) <= 200);

CREATE INDEX IF NOT EXISTS idx_release_items_song ON public.release_items (song_track_id);
CREATE INDEX IF NOT EXISTS idx_release_items_master ON public.release_items (master_track_id);
CREATE INDEX IF NOT EXISTS idx_release_items_org ON public.release_items (org_id);

-- ── 3. Integrity ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.releases_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION 'releases: a release cannot move between organizations' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      RAISE EXCEPTION 'releases: a release keeps its project' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'releases: the project must be of the release''s organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'releases: the artist must be a contact of the release''s organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.artwork_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.project_assets a
    WHERE a.id = NEW.artwork_asset_id
      AND a.org_id = NEW.org_id
      AND a.project_id = NEW.project_id
      AND a.kind IN ('artwork', 'photo')
  ) THEN
    RAISE EXCEPTION 'releases: the artwork must be an artwork or photo file of the release''s project' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION public.releases_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.releases_integrity() FROM PUBLIC;

DROP TRIGGER IF EXISTS releases_integrity ON public.releases;
CREATE TRIGGER releases_integrity BEFORE INSERT OR UPDATE ON public.releases
  FOR EACH ROW EXECUTE FUNCTION public.releases_integrity();

CREATE OR REPLACE FUNCTION public.release_items_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.release_id IS DISTINCT FROM OLD.release_id THEN
      RAISE EXCEPTION 'release_items: an item stays on its release' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  SELECT r.org_id INTO v_org FROM public.releases r WHERE r.id = NEW.release_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'release_items: release % does not exist', NEW.release_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'release_items: org_id must be the release''s organization' USING ERRCODE = 'check_violation';
  END IF;
  NEW.org_id := v_org;
  IF NOT EXISTS (
    SELECT 1 FROM public.tracks s WHERE s.id = NEW.song_track_id AND s.org_id = v_org AND s.type = 'song'
  ) THEN
    RAISE EXCEPTION 'release_items: only a song of the release''s organization goes on a release' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.master_track_id IS DISTINCT FROM NEW.song_track_id AND NOT EXISTS (
    SELECT 1
    FROM public.track_links l
    JOIN public.tracks m ON m.id = l.to_track_id AND m.org_id = v_org
    WHERE l.from_track_id = NEW.song_track_id
      AND l.to_track_id = NEW.master_track_id
      AND l.relation IN ('master', 'instrumental', 'version')
  ) THEN
    RAISE EXCEPTION 'release_items: the master must be the song itself or linked to it as its master, instrumental or version'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION public.release_items_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.release_items_integrity() FROM PUBLIC;

DROP TRIGGER IF EXISTS release_items_integrity ON public.release_items;
CREATE TRIGGER release_items_integrity BEFORE INSERT OR UPDATE ON public.release_items
  FOR EACH ROW EXECUTE FUNCTION public.release_items_integrity();

-- Positions are exactly 1..n at COMMIT (deferred, so one transaction may
-- pass through a gap on its way to a contiguous list).
CREATE OR REPLACE FUNCTION public.release_items_contiguous()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_release uuid := COALESCE(NEW.release_id, OLD.release_id);
  v_count int;
  v_distinct int;
  v_min int;
  v_max int;
BEGIN
  SELECT count(*), count(DISTINCT position), min(position), max(position)
    INTO v_count, v_distinct, v_min, v_max
  FROM public.release_items WHERE release_id = v_release;
  IF v_count > 0 AND (v_distinct <> v_count OR v_min <> 1 OR v_max <> v_count) THEN
    RAISE EXCEPTION 'release_items: the positions of release % must be 1..n with no gap', v_release
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

ALTER FUNCTION public.release_items_contiguous() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.release_items_contiguous() FROM PUBLIC;

DROP TRIGGER IF EXISTS release_items_contiguous ON public.release_items;
CREATE CONSTRAINT TRIGGER release_items_contiguous
  AFTER INSERT OR UPDATE OR DELETE ON public.release_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.release_items_contiguous();

-- Guards that keep the two triggers above true after the fact.

CREATE OR REPLACE FUNCTION public.project_assets_release_artwork()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.releases r
    WHERE r.artwork_asset_id = NEW.id
      AND (NEW.kind NOT IN ('artwork', 'photo') OR NEW.project_id IS DISTINCT FROM r.project_id)
  ) THEN
    RAISE EXCEPTION 'project_assets: this file is a release''s artwork; clear it there first' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION public.project_assets_release_artwork() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.project_assets_release_artwork() FROM PUBLIC;

DROP TRIGGER IF EXISTS project_assets_release_artwork ON public.project_assets;
CREATE TRIGGER project_assets_release_artwork BEFORE UPDATE OF kind, project_id ON public.project_assets
  FOR EACH ROW EXECUTE FUNCTION public.project_assets_release_artwork();

CREATE OR REPLACE FUNCTION public.tracks_release_song_type()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM 'song'
     AND EXISTS (SELECT 1 FROM public.release_items ri WHERE ri.song_track_id = NEW.id) THEN
    RAISE EXCEPTION 'tracks: this song is on a release and stays a song' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION public.tracks_release_song_type() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tracks_release_song_type() FROM PUBLIC;

DROP TRIGGER IF EXISTS tracks_release_song_type ON public.tracks;
CREATE TRIGGER tracks_release_song_type BEFORE UPDATE OF type ON public.tracks
  FOR EACH ROW WHEN (OLD.type = 'song' AND NEW.type IS DISTINCT FROM 'song')
  EXECUTE FUNCTION public.tracks_release_song_type();

CREATE OR REPLACE FUNCTION public.track_links_release_master()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.from_track_id = OLD.from_track_id
     AND NEW.to_track_id = OLD.to_track_id
     AND NEW.relation IN ('master', 'instrumental', 'version') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.release_items ri
    WHERE ri.song_track_id = OLD.from_track_id
      AND ri.master_track_id = OLD.to_track_id
      AND EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = OLD.from_track_id)
      AND EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = OLD.to_track_id)
  ) THEN
    RAISE EXCEPTION 'track_links: this link makes a track a release master; change the release first' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

ALTER FUNCTION public.track_links_release_master() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.track_links_release_master() FROM PUBLIC;

DROP TRIGGER IF EXISTS track_links_release_master ON public.track_links;
CREATE TRIGGER track_links_release_master BEFORE UPDATE OR DELETE ON public.track_links
  FOR EACH ROW EXECUTE FUNCTION public.track_links_release_master();

-- ── 4. Reads ────────────────────────────────────────────────────────────

ALTER TABLE public.releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_member_read ON public.releases;
CREATE POLICY org_member_read ON public.releases
  FOR SELECT
  TO authenticated
  USING (
    org_id IS NOT NULL
    AND public.has_org_cap(org_id, 'catalog.read')
    AND public.can_see_org_project(org_id, project_id)
  );

DROP POLICY IF EXISTS org_member_read ON public.release_items;
CREATE POLICY org_member_read ON public.release_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.releases r
      WHERE r.id = release_items.release_id
        AND r.org_id IS NOT NULL
        AND r.org_id = release_items.org_id
        AND public.has_org_cap(r.org_id, 'catalog.read')
        AND public.can_see_org_project(r.org_id, r.project_id)
    )
  );

-- Writes: service role only (141 §3c's trigger; no write policy exists).
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.releases;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.releases
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.release_items;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.release_items
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');

-- ── 5. Tracklist writes ─────────────────────────────────────────────────
-- SECURITY INVOKER, service_role only: the route has authorised the member
-- and the release; these only make a multi-row change atomic. Both check
-- the release is of p_org, so a wrong pair from the route changes nothing.

CREATE OR REPLACE FUNCTION public.labelos_release_items_reorder(p_org uuid, p_release uuid, p_items uuid[])
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  PERFORM 1 FROM public.releases WHERE id = p_release AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'release % not found', p_release USING ERRCODE = 'no_data_found';
  END IF;
  SELECT count(*) INTO v_count FROM public.release_items WHERE release_id = p_release;
  IF coalesce(array_length(p_items, 1), 0) <> v_count
     OR (SELECT count(DISTINCT x) FROM unnest(p_items) x) <> v_count
     OR EXISTS (
       SELECT 1 FROM unnest(p_items) x
       WHERE NOT EXISTS (SELECT 1 FROM public.release_items ri WHERE ri.id = x AND ri.release_id = p_release)
     ) THEN
    RAISE EXCEPTION 'order must list every item of the release exactly once' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.release_items ri
  SET position = o.ord
  FROM unnest(p_items) WITH ORDINALITY AS o(id, ord)
  WHERE ri.id = o.id AND ri.release_id = p_release AND ri.position IS DISTINCT FROM o.ord::int;
END;
$$;

CREATE OR REPLACE FUNCTION public.labelos_release_item_remove(p_org uuid, p_release uuid, p_item uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_position int;
BEGIN
  PERFORM 1 FROM public.releases WHERE id = p_release AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  DELETE FROM public.release_items WHERE id = p_item AND release_id = p_release RETURNING position INTO v_position;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE public.release_items SET position = position - 1 WHERE release_id = p_release AND position > v_position;
  RETURN true;
END;
$$;

ALTER FUNCTION public.labelos_release_items_reorder(uuid, uuid, uuid[]) OWNER TO postgres;
ALTER FUNCTION public.labelos_release_item_remove(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_release_items_reorder(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.labelos_release_item_remove(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_release_items_reorder(uuid, uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.labelos_release_item_remove(uuid, uuid, uuid) TO service_role;

-- ── 6. "On a release" makes a mix finished ──────────────────────────────
-- 141's rule, unchanged, plus the release arm (lib/labelos/org-read,
-- lib/labelos/org-audio, lib/labelos/releases#countsAsOnRelease).

CREATE OR REPLACE FUNCTION public.labelos_track_is_finished(p_track uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
      SELECT 1 FROM public.track_links l
      WHERE l.to_track_id = p_track AND l.relation NOT IN ('master', 'instrumental')
    )
    AND NOT EXISTS (SELECT 1 FROM public.song_beats sb WHERE sb.beat_track_id = p_track)
    AND (
      EXISTS (
        SELECT 1
        FROM public.track_links l
        JOIN public.tracks s ON s.id = l.from_track_id AND s.type = 'song'
        JOIN public.tracks t ON t.id = l.to_track_id AND t.org_id = s.org_id
        WHERE l.to_track_id = p_track AND l.relation IN ('master', 'instrumental')
      )
      OR EXISTS (
        SELECT 1 FROM public.tracks t
        WHERE t.id = p_track AND t.type = 'song' AND t.song_stage = 'selected'
      )
      OR EXISTS (
        SELECT 1
        FROM public.tracks t
        JOIN public.release_items ri ON ri.song_track_id = t.id
        JOIN public.releases r ON r.id = ri.release_id AND r.org_id = t.org_id
        WHERE t.id = p_track AND t.type = 'song' AND r.state NOT IN ('cancelled')
      )
    );
$$;

ALTER FUNCTION public.labelos_track_is_finished(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_track_is_finished(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.labelos_track_is_finished(uuid) FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
