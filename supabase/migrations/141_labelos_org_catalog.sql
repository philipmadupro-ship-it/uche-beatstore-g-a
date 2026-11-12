-- 141_labelos_org_catalog.sql
-- Label OS (LABEL-12): org songs, projects and their #44 material in the
-- existing tables, readable by members (17 R1, R11).
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 140 (docs/bstudio-label-os/16-execution-runbook.md).
--
-- Expand only. No backfill: every existing row keeps org_id IS NULL (M7 is
-- out of scope), so no producer route, the store or the portal changes.
--
--   1. Columns: tracks.org_id / created_by / isrc, projects.org_id and
--      projects.inbox_for_contact_id (the artist an Inbox project belongs to,
--      Q1 — one per artist, unique). Indexed (org_id, created_at DESC). A
--      row's org is fixed once written: a producer row is never moved into an
--      org (D6 copies, M7 is its own plan), an org row never leaves.
--   2. Read helpers (SECURITY DEFINER, as postgres):
--        can_see_org_project(org, project) — artist scope of a project: the
--          whole org (scope `org`, never role `artist`), or its inbox artist /
--          any project_contacts contact passes can_see_artist (139).
--        can_see_org_track(org, track) — the whole org, or a project OF THE
--          SAME ORG the track is in (project_tracks) is in scope.
--        can_read_org_track(org, track) — catalog.read + can_see_org_track +
--          the audio class (D4): working material needs audio.working,
--          finished material audio.finished (or working).
--      The class is the NARROWER row rule in src/lib/labelos/org-read.ts
--      (`labelos_track_is_finished`): finished only for a selected song's own
--      audio or a song's master / instrumental, and only when nothing links
--      to the track as working material. Everything else reads as working.
--      The routes keep the finer per-recording split (LABEL-13/16).
--   3. ONE additive SELECT policy `org_member_read` per table, TO
--      authenticated, on tracks, projects and the #44 tables project_contacts,
--      artist_portals, project_assets, song_beats, track_links,
--      artist_messages, contact_track_states and project_comments. Each
--      requires `org_id IS NOT NULL` on its row or, inside EXISTS, on its
--      parent's. No write policy: org writes go through the service role in
--      /api/org/*. No existing policy is altered or dropped (R-04).
--      Narrowed beyond "parent readable" where the row itself carries more:
--        artist_portals  — the token is a bearer credential to the portal's
--                          working audio: + share.external + audio.working;
--        project_assets  — only artwork / lyrics without audio.working
--                          (sensitivity and business kinds are LABEL-15);
--        project_comments — a comment naming a share token needs
--                          share.external; its track and portal artist must
--                          be readable too.
--   3b. A RESTRICTIVE SELECT guard `org_member_guard` on tracks, projects and
--      the seven #44 tables keyed on their own user_id: a producer row passes
--      untouched, an org row only with the org_member_read predicate. Org
--      rows still carry a user_id (NOT NULL columns; the routes write the
--      acting member), and the producer-era owner policies would otherwise
--      keep that member reading it after leaving the org, after a soft
--      delete, or outside their scope / audio class. Still SELECT only.
--      The same guard (an org row is hidden, project_comments keeps its
--      predicate) sits on every table whose producer policy keys through a
--      track's / project's user_id: project_comments, project_tracks,
--      project_shares, track_versions, track_collaborators, track_licenses,
--      play_head_pings, store_free_downloads, project_tags,
--      project_folder_items, project_access_links.
--   3c. Org rows are written by the service role only: a BEFORE INSERT /
--      UPDATE / DELETE trigger refuses an org row to the API roles
--      (authenticated, anon) on tracks, projects and every table above that
--      the producer can write through RLS. Producer rows are unaffected.
--   4. The #44 same-owner triggers also accept same-ORG rows. The owner case
--      is the same check as before, and now also requires every parent to be
--      a producer row (org_id IS NULL), so it can never join an org row to a
--      producer row. The org case: every parent is in the same non-null org.
--      "Different owner, no org" is refused exactly as before
--      (supabase/local/checks/141_labelos_org_catalog.sql).
--
-- Proven as anon / authenticated users in
-- supabase/local/checks/141_labelos_org_catalog.sql and held by
-- src/lib/security/rls-final-state.test.ts.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS first.

-- ── 1. Columns ──────────────────────────────────────────────────────────

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS isrc text;

-- 05 §7: CC-XXX-YY-NNNNN, hyphens optional. Normalisation is LABEL-16's.
ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_isrc_format;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_isrc_format
  CHECK (isrc IS NULL OR isrc ~ '^[A-Z]{2}-?[A-Z0-9]{3}-?[0-9]{2}-?[0-9]{5}$');

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS inbox_for_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tracks_org_created
  ON public.tracks (org_id, created_at DESC)
  WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_org_created
  ON public.projects (org_id, created_at DESC)
  WHERE org_id IS NOT NULL;

-- One Inbox per artist (Q1). A contact belongs to one org, so the contact
-- alone is the key; ensureInboxProject (LABEL-14) relies on the conflict.
CREATE UNIQUE INDEX IF NOT EXISTS projects_inbox_for_contact_uniq
  ON public.projects (inbox_for_contact_id)
  WHERE inbox_for_contact_id IS NOT NULL;

-- The row's org never changes after insert (both directions).
CREATE OR REPLACE FUNCTION public.labelos_org_is_fixed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION '%: a row''s organization cannot change', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.labelos_org_is_fixed() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_org_is_fixed() FROM PUBLIC;

DROP TRIGGER IF EXISTS tracks_org_is_fixed ON public.tracks;
CREATE TRIGGER tracks_org_is_fixed
  BEFORE UPDATE OF org_id ON public.tracks
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_is_fixed();

DROP TRIGGER IF EXISTS projects_org_is_fixed ON public.projects;
CREATE TRIGGER projects_org_is_fixed
  BEFORE UPDATE OF org_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_is_fixed();

-- An Inbox is an org project, for a contact of that org.
CREATE OR REPLACE FUNCTION public.projects_inbox_same_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.inbox_for_contact_id IS NOT NULL AND (
    NEW.org_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.inbox_for_contact_id AND c.org_id = NEW.org_id)
  ) THEN
    RAISE EXCEPTION 'projects: inbox contact % is not a contact of the project''s organization', NEW.inbox_for_contact_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.projects_inbox_same_org() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.projects_inbox_same_org() FROM PUBLIC;

DROP TRIGGER IF EXISTS projects_inbox_same_org ON public.projects;
CREATE TRIGGER projects_inbox_same_org
  BEFORE INSERT OR UPDATE OF inbox_for_contact_id, org_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_inbox_same_org();

-- ── 2. Read helpers ─────────────────────────────────────────────────────
-- SECURITY DEFINER as postgres, so the lookups inside a policy do not
-- recurse into the same tables' RLS. auth.uid() is still the caller.

-- Does the caller see the whole org? (06 §2.5; role artist is always scoped.)
-- Internal: no grant; only the helpers below call it.
CREATE OR REPLACE FUNCTION public.labelos_sees_whole_org(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_members om
    JOIN public.organizations o ON o.id = om.org_id
    WHERE om.org_id = p_org
      AND om.user_id = auth.uid()
      AND o.deleted_at IS NULL
      AND om.scope = 'org'
      AND om.role <> 'artist'
  );
$$;

ALTER FUNCTION public.labelos_sees_whole_org(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_sees_whole_org(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.labelos_sees_whole_org(uuid) FROM anon, authenticated;

-- Is this org project inside the caller's artist scope? Scope only; the
-- capability is has_org_cap's job. False for a producer project, a project
-- of another org, and a non-member.
CREATE OR REPLACE FUNCTION public.can_see_org_project(p_org uuid, p_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project
      AND p.org_id IS NOT NULL
      AND p.org_id = p_org
      AND (
        public.labelos_sees_whole_org(p_org)
        OR (p.inbox_for_contact_id IS NOT NULL AND public.can_see_artist(p_org, p.inbox_for_contact_id))
        OR EXISTS (
          SELECT 1 FROM public.project_contacts pc
          WHERE pc.project_id = p.id
            AND public.can_see_artist(p_org, pc.contact_id)
        )
      )
  );
$$;

ALTER FUNCTION public.can_see_org_project(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_see_org_project(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_see_org_project(uuid, uuid) TO authenticated, anon;

-- Is this org track inside the caller's artist scope? Through a project of
-- the SAME org it sits in; a track in no project is whole-org only.
CREATE OR REPLACE FUNCTION public.can_see_org_track(p_org uuid, p_track uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tracks t
    WHERE t.id = p_track
      AND t.org_id IS NOT NULL
      AND t.org_id = p_org
      AND (
        public.labelos_sees_whole_org(p_org)
        OR EXISTS (
          SELECT 1
          FROM public.project_tracks pt
          JOIN public.projects p ON p.id = pt.project_id AND p.org_id = t.org_id
          WHERE pt.track_id = t.id
            AND public.can_see_org_project(p_org, p.id)
        )
      )
  );
$$;

ALTER FUNCTION public.can_see_org_track(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_see_org_track(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_see_org_track(uuid, uuid) TO authenticated, anon;

-- The audio class of an org track for ROW reads (lib/labelos/org-read.ts,
-- orgTrackReadClass): finished only when it is a selected song's own audio
-- or a song's master / instrumental, and nothing links to it as working
-- material. Internal: no grant.
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
    );
$$;

ALTER FUNCTION public.labelos_track_is_finished(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_track_is_finished(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.labelos_track_is_finished(uuid) FROM anon, authenticated;

-- May the caller read this org track's row? catalog.read, artist scope and
-- the audio class (D4: marketing never reads working material).
CREATE OR REPLACE FUNCTION public.can_read_org_track(p_org uuid, p_track uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_org IS NOT NULL
    AND public.has_org_cap(p_org, 'catalog.read')
    AND public.can_see_org_track(p_org, p_track)
    AND (
      public.has_org_cap(p_org, 'audio.working')
      OR (public.has_org_cap(p_org, 'audio.finished') AND public.labelos_track_is_finished(p_track))
    );
$$;

ALTER FUNCTION public.can_read_org_track(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_read_org_track(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_org_track(uuid, uuid) TO authenticated, anon;

-- ── 3. Additive read policies ───────────────────────────────────────────
-- owner_only (097/119) and every #44 owner policy are untouched. Producer
-- rows are org_id IS NULL, and every policy below requires org_id IS NOT
-- NULL on its row or its parent's, so none of them can match one.

DROP POLICY IF EXISTS org_member_read ON public.tracks;
CREATE POLICY org_member_read ON public.tracks
  FOR SELECT
  TO authenticated
  USING (
    org_id IS NOT NULL
    AND public.can_read_org_track(org_id, id)
  );

DROP POLICY IF EXISTS org_member_read ON public.projects;
CREATE POLICY org_member_read ON public.projects
  FOR SELECT
  TO authenticated
  USING (
    org_id IS NOT NULL
    AND (SELECT public.has_org_cap(org_id, 'catalog.read'))
    AND public.can_see_org_project(org_id, id)
  );

DROP POLICY IF EXISTS org_member_read ON public.project_contacts;
CREATE POLICY org_member_read ON public.project_contacts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_contacts.project_id
        AND p.org_id IS NOT NULL
        AND public.has_org_cap(p.org_id, 'catalog.read')
        AND public.can_see_org_project(p.org_id, p.id)
        AND public.can_see_artist(p.org_id, project_contacts.contact_id)
    )
  );

DROP POLICY IF EXISTS org_member_read ON public.artist_portals;
CREATE POLICY org_member_read ON public.artist_portals
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = artist_portals.contact_id
        AND c.org_id IS NOT NULL
        AND public.has_org_cap(c.org_id, 'catalog.read')
        AND public.can_see_artist(c.org_id, c.id)
        AND public.has_org_cap(c.org_id, 'share.external')
        AND public.has_org_cap(c.org_id, 'audio.working')
    )
  );

DROP POLICY IF EXISTS org_member_read ON public.project_assets;
CREATE POLICY org_member_read ON public.project_assets
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_assets.project_id
        AND p.org_id IS NOT NULL
        AND public.has_org_cap(p.org_id, 'catalog.read')
        AND public.can_see_org_project(p.org_id, p.id)
        AND (project_assets.kind IN ('artwork', 'lyrics') OR public.has_org_cap(p.org_id, 'audio.working'))
    )
  );

DROP POLICY IF EXISTS org_member_read ON public.song_beats;
CREATE POLICY org_member_read ON public.song_beats
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tracks s
      WHERE s.id = song_beats.song_track_id
        AND s.org_id IS NOT NULL
        AND public.can_read_org_track(s.org_id, s.id)
    )
    AND EXISTS (
      SELECT 1 FROM public.tracks b
      WHERE b.id = song_beats.beat_track_id
        AND b.org_id IS NOT NULL
        AND public.can_read_org_track(b.org_id, b.id)
    )
  );

DROP POLICY IF EXISTS org_member_read ON public.track_links;
CREATE POLICY org_member_read ON public.track_links
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tracks f
      WHERE f.id = track_links.from_track_id
        AND f.org_id IS NOT NULL
        AND public.can_read_org_track(f.org_id, f.id)
    )
    AND EXISTS (
      SELECT 1 FROM public.tracks t
      WHERE t.id = track_links.to_track_id
        AND t.org_id IS NOT NULL
        AND public.can_read_org_track(t.org_id, t.id)
    )
  );

DROP POLICY IF EXISTS org_member_read ON public.artist_messages;
CREATE POLICY org_member_read ON public.artist_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = artist_messages.contact_id
        AND c.org_id IS NOT NULL
        AND public.has_org_cap(c.org_id, 'catalog.read')
        AND public.can_see_artist(c.org_id, c.id)
        AND (
          artist_messages.project_id IS NULL
          OR public.can_see_org_project(c.org_id, artist_messages.project_id)
        )
    )
  );

DROP POLICY IF EXISTS org_member_read ON public.contact_track_states;
CREATE POLICY org_member_read ON public.contact_track_states
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_track_states.contact_id
        AND c.org_id IS NOT NULL
        AND public.has_org_cap(c.org_id, 'catalog.read')
        AND public.can_see_artist(c.org_id, c.id)
        AND public.can_read_org_track(c.org_id, contact_track_states.track_id)
        AND (
          contact_track_states.project_id IS NULL
          OR public.can_see_org_project(c.org_id, contact_track_states.project_id)
        )
    )
  );

DROP POLICY IF EXISTS org_member_read ON public.project_comments;
CREATE POLICY org_member_read ON public.project_comments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_comments.project_id
        AND p.org_id IS NOT NULL
        AND public.has_org_cap(p.org_id, 'catalog.read')
        AND public.can_see_org_project(p.org_id, p.id)
        AND (project_comments.track_id IS NULL OR public.can_read_org_track(p.org_id, project_comments.track_id))
        AND (project_comments.contact_id IS NULL OR public.can_see_artist(p.org_id, project_comments.contact_id))
        AND (project_comments.share_token IS NULL OR public.has_org_cap(p.org_id, 'share.external'))
    )
  );

-- ── 3b. Restrictive read guards ─────────────────────────────────────────
-- An org row still has a user_id (projects.user_id and every #44 user_id
-- are NOT NULL; the org routes write the acting member there). The
-- producer-era owner policies key on user_id = auth.uid(), so without a
-- guard that member would keep reading the row through them after leaving
-- the org, after the org is soft-deleted, or outside their scope / audio
-- class — exactly what the routes refuse. Each guard is RESTRICTIVE (ANDed
-- with every permissive policy) and passes producer rows untouched:
--   producer row → true; org row → the org_member_read predicate.
-- tracks and projects are enough for every table keyed through them
-- (project_tracks, track_versions, project_comments, track_collaborators,
-- project_shares, …): their policies read tracks / projects under the
-- caller's RLS, so a guarded parent hides the child. The #44 tables keyed on
-- their OWN user_id get their own guard. "Is this an org row?" is asked
-- through SECURITY DEFINER helpers: an EXISTS under the caller's RLS would
-- answer "no" for an org parent the caller cannot see, and pass the guard.

CREATE OR REPLACE FUNCTION public.labelos_is_org_project(p_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project AND org_id IS NOT NULL);
$$;

CREATE OR REPLACE FUNCTION public.labelos_is_org_track(p_track uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.tracks WHERE id = p_track AND org_id IS NOT NULL);
$$;

CREATE OR REPLACE FUNCTION public.labelos_is_org_contact(p_contact uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_contact AND org_id IS NOT NULL);
$$;

ALTER FUNCTION public.labelos_is_org_project(uuid) OWNER TO postgres;
ALTER FUNCTION public.labelos_is_org_track(uuid) OWNER TO postgres;
ALTER FUNCTION public.labelos_is_org_contact(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_is_org_project(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.labelos_is_org_track(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.labelos_is_org_contact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.labelos_is_org_project(uuid), public.labelos_is_org_track(uuid),
  public.labelos_is_org_contact(uuid) TO authenticated, anon;

DROP POLICY IF EXISTS org_member_guard ON public.tracks;
CREATE POLICY org_member_guard ON public.tracks
  AS RESTRICTIVE
  FOR SELECT
  USING (
    org_id IS NULL
    OR (
      org_id IS NOT NULL
      AND public.can_read_org_track(org_id, id)
    )
  );

DROP POLICY IF EXISTS org_member_guard ON public.projects;
CREATE POLICY org_member_guard ON public.projects
  AS RESTRICTIVE
  FOR SELECT
  USING (
    org_id IS NULL
    OR (
      org_id IS NOT NULL
      AND (SELECT public.has_org_cap(org_id, 'catalog.read'))
      AND public.can_see_org_project(org_id, id)
    )
  );

DROP POLICY IF EXISTS org_member_guard ON public.project_contacts;
CREATE POLICY org_member_guard ON public.project_contacts
  AS RESTRICTIVE
  FOR SELECT
  USING (
    NOT public.labelos_is_org_project(project_id)
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_contacts.project_id
        AND p.org_id IS NOT NULL
        AND public.has_org_cap(p.org_id, 'catalog.read')
        AND public.can_see_org_project(p.org_id, p.id)
        AND public.can_see_artist(p.org_id, project_contacts.contact_id)
    )
  );

DROP POLICY IF EXISTS org_member_guard ON public.artist_portals;
CREATE POLICY org_member_guard ON public.artist_portals
  AS RESTRICTIVE
  FOR SELECT
  USING (
    NOT public.labelos_is_org_contact(contact_id)
    OR EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = artist_portals.contact_id
        AND c.org_id IS NOT NULL
        AND public.has_org_cap(c.org_id, 'catalog.read')
        AND public.can_see_artist(c.org_id, c.id)
        AND public.has_org_cap(c.org_id, 'share.external')
        AND public.has_org_cap(c.org_id, 'audio.working')
    )
  );

DROP POLICY IF EXISTS org_member_guard ON public.project_assets;
CREATE POLICY org_member_guard ON public.project_assets
  AS RESTRICTIVE
  FOR SELECT
  USING (
    NOT public.labelos_is_org_project(project_id)
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_assets.project_id
        AND p.org_id IS NOT NULL
        AND public.has_org_cap(p.org_id, 'catalog.read')
        AND public.can_see_org_project(p.org_id, p.id)
        AND (project_assets.kind IN ('artwork', 'lyrics') OR public.has_org_cap(p.org_id, 'audio.working'))
    )
  );

DROP POLICY IF EXISTS org_member_guard ON public.song_beats;
CREATE POLICY org_member_guard ON public.song_beats
  AS RESTRICTIVE
  FOR SELECT
  USING (
    NOT public.labelos_is_org_track(song_track_id)
    OR (
      EXISTS (
        SELECT 1 FROM public.tracks s
        WHERE s.id = song_beats.song_track_id
          AND s.org_id IS NOT NULL
          AND public.can_read_org_track(s.org_id, s.id)
      )
      AND EXISTS (
        SELECT 1 FROM public.tracks b
        WHERE b.id = song_beats.beat_track_id
          AND b.org_id IS NOT NULL
          AND public.can_read_org_track(b.org_id, b.id)
      )
    )
  );

DROP POLICY IF EXISTS org_member_guard ON public.track_links;
CREATE POLICY org_member_guard ON public.track_links
  AS RESTRICTIVE
  FOR SELECT
  USING (
    NOT public.labelos_is_org_track(from_track_id)
    OR (
      EXISTS (
        SELECT 1 FROM public.tracks f
        WHERE f.id = track_links.from_track_id
          AND f.org_id IS NOT NULL
          AND public.can_read_org_track(f.org_id, f.id)
      )
      AND EXISTS (
        SELECT 1 FROM public.tracks t
        WHERE t.id = track_links.to_track_id
          AND t.org_id IS NOT NULL
          AND public.can_read_org_track(t.org_id, t.id)
      )
    )
  );

DROP POLICY IF EXISTS org_member_guard ON public.artist_messages;
CREATE POLICY org_member_guard ON public.artist_messages
  AS RESTRICTIVE
  FOR SELECT
  USING (
    NOT public.labelos_is_org_contact(contact_id)
    OR EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = artist_messages.contact_id
        AND c.org_id IS NOT NULL
        AND public.has_org_cap(c.org_id, 'catalog.read')
        AND public.can_see_artist(c.org_id, c.id)
        AND (
          artist_messages.project_id IS NULL
          OR public.can_see_org_project(c.org_id, artist_messages.project_id)
        )
    )
  );

DROP POLICY IF EXISTS org_member_guard ON public.contact_track_states;
CREATE POLICY org_member_guard ON public.contact_track_states
  AS RESTRICTIVE
  FOR SELECT
  USING (
    NOT public.labelos_is_org_contact(contact_id)
    OR EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_track_states.contact_id
        AND c.org_id IS NOT NULL
        AND public.has_org_cap(c.org_id, 'catalog.read')
        AND public.can_see_artist(c.org_id, c.id)
        AND public.can_read_org_track(c.org_id, contact_track_states.track_id)
        AND (
          contact_track_states.project_id IS NULL
          OR public.can_see_org_project(c.org_id, contact_track_states.project_id)
        )
    )
  );

-- A member who authored an org project / track (its user_id) would also
-- read every child row keyed through it — project_comments, project_shares
-- (bearer tokens), project_tracks, versions, credits … — past the narrowing
-- org_member_read applies, because those policies match p.user_id =
-- auth.uid() on a parent the member can still see. project_comments keeps
-- its org_member_read predicate; the rest have no org read path at all, so
-- an org row there is never readable through PostgREST (the routes serve
-- them). One-sided: an org child's other parent is in the same org.

DROP POLICY IF EXISTS org_member_guard ON public.project_comments;
CREATE POLICY org_member_guard ON public.project_comments
  AS RESTRICTIVE
  FOR SELECT
  USING (
    NOT public.labelos_is_org_project(project_id)
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_comments.project_id
        AND p.org_id IS NOT NULL
        AND public.has_org_cap(p.org_id, 'catalog.read')
        AND public.can_see_org_project(p.org_id, p.id)
        AND (project_comments.track_id IS NULL OR public.can_read_org_track(p.org_id, project_comments.track_id))
        AND (project_comments.contact_id IS NULL OR public.can_see_artist(p.org_id, project_comments.contact_id))
        AND (project_comments.share_token IS NULL OR public.has_org_cap(p.org_id, 'share.external'))
    )
  );

DROP POLICY IF EXISTS org_member_guard ON public.project_tracks;
CREATE POLICY org_member_guard ON public.project_tracks
  AS RESTRICTIVE FOR SELECT
  USING (NOT public.labelos_is_org_project(project_id) AND NOT public.labelos_is_org_track(track_id));

DROP POLICY IF EXISTS org_member_guard ON public.project_shares;
CREATE POLICY org_member_guard ON public.project_shares
  AS RESTRICTIVE FOR SELECT
  USING (NOT public.labelos_is_org_project(project_id) AND NOT public.labelos_is_org_track(track_id));

DROP POLICY IF EXISTS org_member_guard ON public.track_versions;
CREATE POLICY org_member_guard ON public.track_versions
  AS RESTRICTIVE FOR SELECT
  USING (NOT public.labelos_is_org_track(track_id));

DROP POLICY IF EXISTS org_member_guard ON public.track_collaborators;
CREATE POLICY org_member_guard ON public.track_collaborators
  AS RESTRICTIVE FOR SELECT
  USING (NOT public.labelos_is_org_track(track_id));

DROP POLICY IF EXISTS org_member_guard ON public.track_licenses;
CREATE POLICY org_member_guard ON public.track_licenses
  AS RESTRICTIVE FOR SELECT
  USING (NOT public.labelos_is_org_track(track_id));

DROP POLICY IF EXISTS org_member_guard ON public.play_head_pings;
CREATE POLICY org_member_guard ON public.play_head_pings
  AS RESTRICTIVE FOR SELECT
  USING (NOT public.labelos_is_org_track(track_id));

DROP POLICY IF EXISTS org_member_guard ON public.store_free_downloads;
CREATE POLICY org_member_guard ON public.store_free_downloads
  AS RESTRICTIVE FOR SELECT
  USING (NOT public.labelos_is_org_track(track_id));

DROP POLICY IF EXISTS org_member_guard ON public.project_tags;
CREATE POLICY org_member_guard ON public.project_tags
  AS RESTRICTIVE FOR SELECT
  USING (NOT public.labelos_is_org_project(project_id));

DROP POLICY IF EXISTS org_member_guard ON public.project_folder_items;
CREATE POLICY org_member_guard ON public.project_folder_items
  AS RESTRICTIVE FOR SELECT
  USING (NOT public.labelos_is_org_project(project_id));

DROP POLICY IF EXISTS org_member_guard ON public.project_access_links;
CREATE POLICY org_member_guard ON public.project_access_links
  AS RESTRICTIVE FOR SELECT
  USING (NOT public.labelos_is_org_project(project_id));

-- ── 3c. Org rows are written by the service role only ───────────────────
-- The producer-era write policies (owner_only, *_owner_write, owner_via_*)
-- key on user_id = auth.uid() (plus is_producer() on some), and know nothing
-- of orgs: through them a producer could insert a row INTO an org, a
-- producer who is also a scoped member could link a project to their own
-- artist (widening their scope), and an org row's author could update or
-- delete it without catalog.write — or after leaving. Rather than a write
-- POLICY (none is added), one trigger refuses any insert, update or delete
-- of an org row by the API roles; the service role and postgres (every
-- /api/org route, every migration) pass straight through. Producer rows are
-- unaffected: their keys are never org rows.
--
-- Arguments are (kind, column) pairs: kind `self` = the row's own org_id,
-- `project` / `track` / `contact` = that parent column is an org row.

CREATE OR REPLACE FUNCTION public.labelos_org_rows_service_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r jsonb;
  i int;
  v text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  FOREACH r IN ARRAY ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END
  ] LOOP
    CONTINUE WHEN r IS NULL;
    i := 0;
    WHILE i < TG_NARGS LOOP
      v := r ->> TG_ARGV[i + 1];
      IF v IS NOT NULL AND (
        TG_ARGV[i] = 'self'
        OR (TG_ARGV[i] = 'project' AND public.labelos_is_org_project(v::uuid))
        OR (TG_ARGV[i] = 'track' AND public.labelos_is_org_track(v::uuid))
        OR (TG_ARGV[i] = 'contact' AND public.labelos_is_org_contact(v::uuid))
      ) THEN
        RAISE EXCEPTION '%: organization rows are written through /api/org only', TG_TABLE_NAME
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      i := i + 2;
    END LOOP;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

ALTER FUNCTION public.labelos_org_rows_service_only() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_org_rows_service_only() FROM PUBLIC;

DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.tracks;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.tracks
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.projects;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.project_contacts;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.project_contacts
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('project', 'project_id', 'contact', 'contact_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.artist_portals;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.artist_portals
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('contact', 'contact_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.project_assets;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.project_assets
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('project', 'project_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.song_beats;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.song_beats
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('track', 'song_track_id', 'track', 'beat_track_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.track_links;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.track_links
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('track', 'from_track_id', 'track', 'to_track_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.artist_messages;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.artist_messages
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('contact', 'contact_id', 'project', 'project_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.contact_track_states;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.contact_track_states
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('contact', 'contact_id', 'track', 'track_id', 'project', 'project_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.project_comments;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.project_comments
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('project', 'project_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.project_tracks;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.project_tracks
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('project', 'project_id', 'track', 'track_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.project_shares;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.project_shares
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('project', 'project_id', 'track', 'track_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.track_versions;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.track_versions
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('track', 'track_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.track_collaborators;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.track_collaborators
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('track', 'track_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.track_licenses;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.track_licenses
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('track', 'track_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.project_tags;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.project_tags
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('project', 'project_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.project_folder_items;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.project_folder_items
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('project', 'project_id');

-- ── 4. Same-owner triggers: also same-org ───────────────────────────────
-- Owner case: the check each #44 migration wrote, with every parent also a
-- producer row (org_id IS NULL). Org case: every parent in one non-null org.

-- 122
CREATE OR REPLACE FUNCTION public.project_contacts_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.contacts c ON c.id = NEW.contact_id AND c.org_id = p.org_id
    WHERE p.id = NEW.project_id AND p.org_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id AND p.org_id IS NULL) THEN
    RAISE EXCEPTION 'project_contacts: project % is not owned by %', NEW.project_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id AND c.org_id IS NULL) THEN
    RAISE EXCEPTION 'project_contacts: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 123
CREATE OR REPLACE FUNCTION public.contact_track_states_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.contacts c
    JOIN public.tracks t ON t.id = NEW.track_id AND t.org_id = c.org_id
    WHERE c.id = NEW.contact_id AND c.org_id IS NOT NULL
      AND (NEW.project_id IS NULL OR EXISTS (
        SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.org_id = c.org_id
      ))
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id AND c.org_id IS NULL) THEN
    RAISE EXCEPTION 'contact_track_states: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.track_id AND t.user_id = NEW.user_id AND t.org_id IS NULL) THEN
    RAISE EXCEPTION 'contact_track_states: track % is not owned by %', NEW.track_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 124
CREATE OR REPLACE FUNCTION public.tracks_beat_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.beat_track_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.org_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tracks b WHERE b.id = NEW.beat_track_id AND b.org_id = NEW.org_id
  ) THEN
    RETURN NEW;
  END IF;
  IF NEW.org_id IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM public.tracks b WHERE b.id = NEW.beat_track_id AND b.user_id = NEW.user_id AND b.org_id IS NULL
  ) THEN
    RAISE EXCEPTION 'tracks.beat_track_id: beat % is not owned by the song''s owner', NEW.beat_track_id;
  END IF;
  RETURN NEW;
END $$;

-- 125
CREATE OR REPLACE FUNCTION public.artist_portals_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.org_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id AND c.org_id IS NULL) THEN
    RAISE EXCEPTION 'artist_portals: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 127
CREATE OR REPLACE FUNCTION public.project_assets_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.org_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id AND p.org_id IS NULL) THEN
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
  IF EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.contacts c ON c.id = NEW.contact_id AND c.org_id = p.org_id
    WHERE p.id = NEW.project_id AND p.org_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.contacts c ON c.user_id = p.user_id AND c.org_id IS NULL
    WHERE p.id = NEW.project_id AND c.id = NEW.contact_id AND p.org_id IS NULL
  ) THEN
    RAISE EXCEPTION 'project_comments: contact % does not belong to the owner of project %', NEW.contact_id, NEW.project_id;
  END IF;
  RETURN NEW;
END $$;

-- 130
CREATE OR REPLACE FUNCTION public.artist_messages_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = NEW.contact_id AND c.org_id IS NOT NULL
      AND (NEW.project_id IS NULL OR EXISTS (
        SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.org_id = c.org_id
      ))
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id AND c.org_id IS NULL) THEN
    RAISE EXCEPTION 'artist_messages: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id AND p.org_id IS NULL
  ) THEN
    RAISE EXCEPTION 'artist_messages: project % is not owned by %', NEW.project_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 132
CREATE OR REPLACE FUNCTION public.song_beats_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tracks s
    JOIN public.tracks b ON b.id = NEW.beat_track_id AND b.org_id = s.org_id
    WHERE s.id = NEW.song_track_id AND s.org_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.song_track_id AND t.user_id = NEW.user_id AND t.org_id IS NULL) THEN
    RAISE EXCEPTION 'song_beats: song % is not owned by %', NEW.song_track_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.beat_track_id AND t.user_id = NEW.user_id AND t.org_id IS NULL) THEN
    RAISE EXCEPTION 'song_beats: beat % is not owned by %', NEW.beat_track_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 133
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

NOTIFY pgrst, 'reload schema';
