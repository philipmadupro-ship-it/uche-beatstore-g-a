-- 154_labelos_artist_label_connection.sql
-- Label OS (LABEL-41): the artist ↔ label connection (D1, D6, 17 R3).
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 136–151 (docs/bstudio-label-os/16-execution-runbook.md).
-- Never part of supabase/apply/pending.sql. (152 is LABEL-26's, 153
-- LABEL-27's.)
--
-- An ARTIST org connects to a LABEL org and shares its whole catalogue or
-- chosen projects; the label sees that music through ONE roster contact,
-- under its own staff permissions (D1). This is the most sensitive Label OS
-- boundary after external project members (148), so the database half keeps
-- the same shape: the tables and the audit functions live here, the reads go
-- through service-role routes that apply the rule in TypeScript
-- (lib/labelos/connections, lib/auth/org-access#requireConnectedTrack), and
-- NO policy anywhere gives a label member the artist org's projects, tracks,
-- files, comments, members, contacts or activity. `can_see_via_connection`
-- is the SQL twin of the route rule, proven as an `authenticated` user in
-- supabase/local/checks/154_*.sql; deliberately not used by any policy.
--
--   1. `org_connections` — (label org, artist org, status requested | active
--      | declined | ended, who initiated, the label's roster contact, the
--      share mode, whether the label may copy). A partial unique index allows
--      ONE open (requested or active) connection per pair. Integrity trigger:
--      the sides are a live label org and a live artist org, who/where never
--      change, the status only moves requested → active | declined | ended and
--      active → ended (terminal after that), an active connection has a
--      roster contact of the LABEL org. Writes: the audit functions only.
--   2. `connection_projects` — the artist org's projects shared under a
--      `selected` connection. A trigger refuses a project of any other org.
--   3. `contacts.artist_org_id` (17 R3) — the label's roster contact points
--      at the connected artist org. Only for an org contact, one per
--      (label, artist org); a trigger refuses a value with no open connection
--      between exactly those two orgs (so no contact route can forge one).
--   4. `tracks.provenance` — nullable jsonb on a COPIED recording (D6):
--      `source_org_id`, `source_track_id`, `copied_at`, `copied_by`. Org rows
--      only; immutable once set. No live cross-org reference: the copy is its
--      own track.
--   5. `can_see_via_connection(project)`.
--   6. RLS: SELECT only. `org_connections` is read by the owners / admins of
--      either side, `connection_projects` by those of the artist side. No
--      per-row SECURITY DEFINER call (R-08): the caller's few memberships are
--      one uncorrelated subplan. Writes are service role only.
--   7. Audit functions (service_role only, mutation + `activity_events` row(s)
--      in ONE transaction, the 146 pattern; the event is recorded in BOTH
--      orgs, because both are parties):
--        labelos_audit_connection_request   connection.requested
--        labelos_audit_connection_accept    connection.accepted
--        labelos_audit_connection_end       connection.ended
--        labelos_audit_connection_share     share.created | share.revoked
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS first.

-- ── 1. org_connections ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.org_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label_org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  artist_org_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'active', 'declined', 'ended')),
  initiated_by     text NOT NULL CHECK (initiated_by IN ('label', 'artist')),
  requested_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The label's roster contact for this artist (17 R3). Chosen by the label
  -- when it asks, else created when the connection is accepted.
  label_contact_id uuid REFERENCES public.contacts(id) ON DELETE RESTRICT,
  -- What the label may reach: `selected` = the projects in connection_projects
  -- (none until the artist side picks), `all` = every project of the artist org.
  share_mode       text NOT NULL DEFAULT 'selected' CHECK (share_mode IN ('selected', 'all')),
  -- D6: may the label COPY a shared recording into its own org? Off until the
  -- artist side says so; listening never implies it.
  allow_copies     boolean NOT NULL DEFAULT false,
  accepted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at      timestamptz,
  ended_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ended_at         timestamptz,
  ended_side       text CHECK (ended_side IN ('label', 'artist')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_connections_distinct_orgs CHECK (label_org_id <> artist_org_id),
  CONSTRAINT org_connections_active_has_contact CHECK (status <> 'active' OR label_contact_id IS NOT NULL)
);

-- ONE open connection per (label, artist) pair: requested and active both
-- count, so a second request cannot be stacked on a pending or live one.
CREATE UNIQUE INDEX IF NOT EXISTS org_connections_one_open
  ON public.org_connections (label_org_id, artist_org_id)
  WHERE status IN ('requested', 'active');
CREATE INDEX IF NOT EXISTS idx_org_connections_artist
  ON public.org_connections (artist_org_id, status);
CREATE INDEX IF NOT EXISTS idx_org_connections_label
  ON public.org_connections (label_org_id, status);

CREATE TABLE IF NOT EXISTS public.connection_projects (
  connection_id uuid NOT NULL REFERENCES public.org_connections(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- The artist org (denormalised so the policy needs no join).
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_connection_projects_project ON public.connection_projects (project_id);

-- ── 2. integrity ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.org_connections_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = NEW.label_org_id AND o.kind = 'label' AND o.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'org_connections: % is not a label organization', NEW.label_org_id USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = NEW.artist_org_id AND o.kind = 'artist' AND o.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'org_connections: % is not an artist organization', NEW.artist_org_id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'requested' THEN
      RAISE EXCEPTION 'org_connections: a connection starts as a request' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.label_org_id IS DISTINCT FROM OLD.label_org_id
       OR NEW.artist_org_id IS DISTINCT FROM OLD.artist_org_id
       OR NEW.initiated_by IS DISTINCT FROM OLD.initiated_by THEN
      RAISE EXCEPTION 'org_connections: the two sides of a connection cannot change' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (OLD.status = 'requested' AND NEW.status IN ('active', 'declined', 'ended'))
      OR (OLD.status = 'active' AND NEW.status = 'ended')
    ) THEN
      RAISE EXCEPTION 'org_connections: % → % is not a valid move', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  -- The roster contact is a contact of the LABEL org.
  IF NEW.label_contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.contacts c WHERE c.id = NEW.label_contact_id AND c.org_id = NEW.label_org_id
  ) THEN
    RAISE EXCEPTION 'org_connections: contact % is not a contact of the label organization', NEW.label_contact_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.org_connections_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.org_connections_integrity() FROM PUBLIC;

DROP TRIGGER IF EXISTS org_connections_integrity ON public.org_connections;
CREATE TRIGGER org_connections_integrity
  BEFORE INSERT OR UPDATE ON public.org_connections
  FOR EACH ROW EXECUTE FUNCTION public.org_connections_integrity();

CREATE OR REPLACE FUNCTION public.connection_projects_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.org_connections c
    JOIN public.projects p ON p.id = NEW.project_id
    WHERE c.id = NEW.connection_id
      AND p.org_id IS NOT NULL
      AND p.org_id = c.artist_org_id
      AND NEW.org_id = c.artist_org_id
  ) THEN
    RAISE EXCEPTION 'connection_projects: project % is not a project of the connection''s artist organization', NEW.project_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.connection_projects_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.connection_projects_integrity() FROM PUBLIC;

DROP TRIGGER IF EXISTS connection_projects_integrity ON public.connection_projects;
CREATE TRIGGER connection_projects_integrity
  BEFORE INSERT OR UPDATE ON public.connection_projects
  FOR EACH ROW EXECUTE FUNCTION public.connection_projects_integrity();

-- ── 3. contacts.artist_org_id ───────────────────────────────────────────

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS artist_org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_artist_org_is_org_contact' AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_artist_org_is_org_contact CHECK (artist_org_id IS NULL OR org_id IS NOT NULL);
  END IF;
END $$;

-- A label connects to an artist org through ONE roster contact.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_artist_org_uniq
  ON public.contacts (org_id, artist_org_id)
  WHERE artist_org_id IS NOT NULL;

-- artist_org_id can only name an artist org this contact's label has an open
-- connection with — so no contact route (service role included) can point a
-- roster contact at an org it is not connected to.
CREATE OR REPLACE FUNCTION public.contacts_artist_org_connected()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.artist_org_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.artist_org_id IS NOT DISTINCT FROM OLD.artist_org_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.org_connections c
    WHERE c.label_org_id = NEW.org_id
      AND c.artist_org_id = NEW.artist_org_id
      AND c.status IN ('requested', 'active')
  ) THEN
    RAISE EXCEPTION 'contacts: artist_org_id needs an open connection between the two organizations'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.contacts_artist_org_connected() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contacts_artist_org_connected() FROM PUBLIC;

DROP TRIGGER IF EXISTS contacts_artist_org_connected ON public.contacts;
CREATE TRIGGER contacts_artist_org_connected
  BEFORE INSERT OR UPDATE OF artist_org_id ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_artist_org_connected();

-- ── 4. tracks.provenance ────────────────────────────────────────────────

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS provenance jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tracks_provenance_shape' AND conrelid = 'public.tracks'::regclass
  ) THEN
    ALTER TABLE public.tracks
      ADD CONSTRAINT tracks_provenance_shape CHECK (
        provenance IS NULL
        OR (
          org_id IS NOT NULL
          AND jsonb_typeof(provenance) = 'object'
          AND provenance ? 'source_track_id'
          AND provenance ? 'copied_at'
          AND provenance ? 'copied_by'
        )
      );
  END IF;
END $$;

-- A copy's origin is a fact about the copy: it is never rewritten or removed.
CREATE OR REPLACE FUNCTION public.tracks_provenance_fixed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.provenance IS NOT NULL AND NEW.provenance IS DISTINCT FROM OLD.provenance THEN
    RAISE EXCEPTION 'tracks: the provenance of a copied recording cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.tracks_provenance_fixed() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tracks_provenance_fixed() FROM PUBLIC;

DROP TRIGGER IF EXISTS tracks_provenance_fixed ON public.tracks;
CREATE TRIGGER tracks_provenance_fixed
  BEFORE UPDATE OF provenance ON public.tracks
  FOR EACH ROW EXECUTE FUNCTION public.tracks_provenance_fixed();

-- ── 5. can_see_via_connection ───────────────────────────────────────────
-- Does the caller reach this ARTIST-org project as a member of the
-- connected LABEL? An active connection whose artist org owns the project, the
-- project shared under it (mode `all`, or listed in connection_projects), the
-- caller holding catalog.read in the label and, if limited to some artists,
-- the connection's roster contact among them (can_see_artist). False for a
-- producer project, a project outside the share, an ended / requested / declined
-- connection, a deleted org on either side, and everyone else. The route rule
-- is the TypeScript twin (lib/labelos/connections#connectionReachesProject).
-- Not used by any policy: label members read the artist org's rows only
-- through the service-role routes, never with their own JWT.

CREATE OR REPLACE FUNCTION public.can_see_via_connection(p_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN public.org_connections c ON c.artist_org_id = p.org_id AND c.status = 'active'
    JOIN public.organizations ao ON ao.id = c.artist_org_id AND ao.deleted_at IS NULL
    JOIN public.organizations lo ON lo.id = c.label_org_id AND lo.deleted_at IS NULL
    WHERE p.id = p_project
      AND p.org_id IS NOT NULL
      AND (
        c.share_mode = 'all'
        OR EXISTS (
          SELECT 1 FROM public.connection_projects cp
          WHERE cp.connection_id = c.id AND cp.project_id = p.id
        )
      )
      AND public.has_org_cap(c.label_org_id, 'catalog.read')
      AND c.label_contact_id IS NOT NULL
      AND public.can_see_artist(c.label_org_id, c.label_contact_id)
  );
$$;

ALTER FUNCTION public.can_see_via_connection(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_see_via_connection(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_see_via_connection(uuid) TO authenticated, anon;

-- ── 6. RLS ──────────────────────────────────────────────────────────────

ALTER TABLE public.org_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connection_projects ENABLE ROW LEVEL SECURITY;

-- The connection row is read by the owners / admins (the people who manage
-- it) of EITHER side, and only one who sees the WHOLE org (scope = 'org'): an
-- admin limited to some artists must not read connections of artists outside
-- their scope. Membership is hashed once per statement.
DROP POLICY IF EXISTS org_connections_manage_read ON public.org_connections;
CREATE POLICY org_connections_manage_read ON public.org_connections
  FOR SELECT
  TO authenticated
  USING (
    label_org_id IN (
      SELECT m.org_id FROM public.org_members m
      WHERE m.user_id = (SELECT auth.uid()) AND m.role IN ('owner', 'admin') AND m.scope = 'org'
    )
    OR artist_org_id IN (
      SELECT m.org_id FROM public.org_members m
      WHERE m.user_id = (SELECT auth.uid()) AND m.role IN ('owner', 'admin') AND m.scope = 'org'
    )
  );

-- What is shared is the ARTIST side's to read; the label learns it through
-- the route that lists the projects it may open.
DROP POLICY IF EXISTS connection_projects_artist_read ON public.connection_projects;
CREATE POLICY connection_projects_artist_read ON public.connection_projects
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT m.org_id FROM public.org_members m
      WHERE m.user_id = (SELECT auth.uid()) AND m.role IN ('owner', 'admin') AND m.scope = 'org'
    )
  );

REVOKE ALL ON public.org_connections FROM anon, authenticated;
REVOKE ALL ON public.connection_projects FROM anon, authenticated;
-- Column-level: each side reads the connection, never the OTHER side's people
-- (requested_by / accepted_by / ended_by are user ids of whoever acted).
GRANT SELECT (id, label_org_id, artist_org_id, status, initiated_by, label_contact_id, share_mode,
              allow_copies, accepted_at, ended_at, ended_side, created_at, updated_at)
  ON public.org_connections TO authenticated;
GRANT SELECT ON public.connection_projects TO authenticated;

-- ── 7. Audit functions ──────────────────────────────────────────────────

-- The two parties' names, for the payloads.
CREATE OR REPLACE FUNCTION public.labelos_connection_payload(p_conn uuid, p_extra jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(p_extra, '{}'::jsonb) || jsonb_build_object(
    'connection_id', c.id,
    'label', lo.name,
    'artist', ao.name
  )
  FROM public.org_connections c
  JOIN public.organizations lo ON lo.id = c.label_org_id
  JOIN public.organizations ao ON ao.id = c.artist_org_id
  WHERE c.id = p_conn;
$$;

ALTER FUNCTION public.labelos_connection_payload(uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_connection_payload(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.labelos_connection_json(p_conn uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', c.id,
    'label_org_id', c.label_org_id,
    'artist_org_id', c.artist_org_id,
    'status', c.status,
    'initiated_by', c.initiated_by,
    'label_contact_id', c.label_contact_id,
    'share_mode', c.share_mode,
    'allow_copies', c.allow_copies,
    'accepted_at', c.accepted_at,
    'ended_at', c.ended_at,
    'created_at', c.created_at
  )
  FROM public.org_connections c WHERE c.id = p_conn;
$$;

ALTER FUNCTION public.labelos_connection_json(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_connection_json(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Ask to connect. p_side is the side of the REQUESTING org (p_org), which
-- must be of that kind; the other side is found by slug or by the email of one
-- of its owners / admins. Answers {"connection": <row>},
-- {"error": "not_found"} (no such org of the other kind — a request for an
-- org that does not exist, is the wrong kind or was deleted all read the
-- same, so the call cannot be used to probe) or {"error": "pending", "id"}
-- (an open connection already exists), or {"error": "bad_contact"}.
CREATE OR REPLACE FUNCTION public.labelos_audit_connection_request(
  p_org uuid,
  p_actor uuid,
  p_side text,
  p_target_slug text,
  p_target_email text,
  p_contact uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_other_kind text;
  v_self       public.organizations%ROWTYPE;
  v_target     public.organizations%ROWTYPE;
  v_label      uuid;
  v_artist     uuid;
  v_conn       public.org_connections%ROWTYPE;
  v_open       uuid;
BEGIN
  IF p_side NOT IN ('label', 'artist') THEN
    RAISE EXCEPTION 'unknown side %', p_side USING ERRCODE = '22023';
  END IF;
  v_other_kind := CASE WHEN p_side = 'label' THEN 'artist' ELSE 'label' END;

  SELECT * INTO v_self FROM public.organizations WHERE id = p_org AND kind = p_side AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  -- Judged on the ASKING org alone and BEFORE the target is looked up, so the
  -- answer cannot reveal whether the target exists (no existence oracle).
  IF p_contact IS NOT NULL AND (
    p_side <> 'label'
    OR NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact AND c.org_id = p_org)
  ) THEN
    RETURN jsonb_build_object('error', 'bad_contact');
  END IF;

  IF nullif(btrim(p_target_slug), '') IS NOT NULL THEN
    SELECT * INTO v_target FROM public.organizations
    WHERE slug = lower(btrim(p_target_slug)) AND kind = v_other_kind AND deleted_at IS NULL;
  ELSIF nullif(btrim(p_target_email), '') IS NOT NULL THEN
    SELECT o.* INTO v_target FROM public.organizations o
    WHERE o.kind = v_other_kind AND o.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.org_members m
        JOIN auth.users u ON u.id = m.user_id
        WHERE m.org_id = o.id AND m.role IN ('owner', 'admin')
          AND lower(u.email) = lower(btrim(p_target_email))
      )
    ORDER BY o.created_at ASC, o.id ASC
    LIMIT 1;
  END IF;
  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  v_label  := CASE WHEN p_side = 'label' THEN p_org ELSE v_target.id END;
  v_artist := CASE WHEN p_side = 'label' THEN v_target.id ELSE p_org END;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_label::text || ':' || v_artist::text, 0));

  SELECT c.id INTO v_open FROM public.org_connections c
  WHERE c.label_org_id = v_label AND c.artist_org_id = v_artist AND c.status IN ('requested', 'active')
  LIMIT 1;
  IF v_open IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'pending', 'id', v_open);
  END IF;

  INSERT INTO public.org_connections (label_org_id, artist_org_id, initiated_by, requested_by, label_contact_id)
  VALUES (v_label, v_artist, p_side, p_actor, p_contact)
  RETURNING * INTO v_conn;

  PERFORM public.labelos_audit_insert(v_label, p_actor, 'connection.requested', 'connection', v_conn.id,
    public.labelos_connection_payload(v_conn.id, COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('side', p_side)));
  PERFORM public.labelos_audit_insert(v_artist, p_actor, 'connection.requested', 'connection', v_conn.id,
    public.labelos_connection_payload(v_conn.id, COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('side', p_side)));

  RETURN jsonb_build_object('connection', public.labelos_connection_json(v_conn.id));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_connection_request(uuid, uuid, text, text, text, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_connection_request(uuid, uuid, text, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_connection_request(uuid, uuid, text, text, text, uuid, jsonb) TO service_role;

-- Accept a request. p_org is the ACCEPTING org, which must be the side that
-- did NOT start it (the starter cannot approve its own request). The label's
-- roster contact is the one named in the request, else a new one named after
-- the artist org; it then points at the artist org (artist_org_id).
-- Answers {"connection": <row>}, {"error": "not_found"} (no such request for
-- this org) or {"error": "contact_taken"} (the roster contact already stands
-- for another artist org).
CREATE OR REPLACE FUNCTION public.labelos_audit_connection_accept(
  p_org uuid,
  p_actor uuid,
  p_connection uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_conn    public.org_connections%ROWTYPE;
  v_contact uuid;
  v_name    text;
BEGIN
  SELECT * INTO v_conn FROM public.org_connections WHERE id = p_connection FOR UPDATE;
  IF NOT FOUND OR v_conn.status <> 'requested' THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  -- The accepting org is a party and is NOT the one that asked.
  IF NOT (
    (v_conn.initiated_by = 'label' AND p_org = v_conn.artist_org_id)
    OR (v_conn.initiated_by = 'artist' AND p_org = v_conn.label_org_id)
  ) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = v_conn.label_org_id AND o.deleted_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = v_conn.artist_org_id AND o.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  v_contact := v_conn.label_contact_id;
  IF v_contact IS NULL THEN
    SELECT o.name INTO v_name FROM public.organizations o WHERE o.id = v_conn.artist_org_id;
    INSERT INTO public.contacts (org_id, user_id, name, category)
    VALUES (v_conn.label_org_id, NULL, v_name, 'artist')
    RETURNING id INTO v_contact;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = v_contact AND c.artist_org_id IS NOT NULL AND c.artist_org_id <> v_conn.artist_org_id
  ) OR EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.org_id = v_conn.label_org_id AND c.artist_org_id = v_conn.artist_org_id AND c.id <> v_contact
  ) THEN
    RETURN jsonb_build_object('error', 'contact_taken');
  END IF;

  UPDATE public.org_connections
  SET status = 'active', accepted_by = p_actor, accepted_at = now(), label_contact_id = v_contact
  WHERE id = v_conn.id;
  UPDATE public.contacts SET artist_org_id = v_conn.artist_org_id WHERE id = v_contact;

  PERFORM public.labelos_audit_insert(v_conn.label_org_id, p_actor, 'connection.accepted', 'connection', v_conn.id,
    public.labelos_connection_payload(v_conn.id, COALESCE(p_payload, '{}'::jsonb)));
  PERFORM public.labelos_audit_insert(v_conn.artist_org_id, p_actor, 'connection.accepted', 'connection', v_conn.id,
    public.labelos_connection_payload(v_conn.id, COALESCE(p_payload, '{}'::jsonb)));

  RETURN jsonb_build_object('connection', public.labelos_connection_json(v_conn.id));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_connection_accept(uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_connection_accept(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_connection_accept(uuid, uuid, uuid, jsonb) TO service_role;

-- End a connection from either side. A pending request ends as `ended` when
-- its starter withdraws it and `declined` when the other side refuses; an
-- active one is `ended`. The shared-project list goes with it and the label's
-- roster contact stops pointing at the artist org (the contact, and anything
-- the label copied, stay the label's). Access is read from `status` on every
-- request, so it ends on the very next one. Answers {"connection": <row>} or
-- {"error": "not_found"}.
CREATE OR REPLACE FUNCTION public.labelos_audit_connection_end(
  p_org uuid,
  p_actor uuid,
  p_connection uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_conn  public.org_connections%ROWTYPE;
  v_side  text;
  v_new   text;
BEGIN
  SELECT * INTO v_conn FROM public.org_connections WHERE id = p_connection FOR UPDATE;
  IF NOT FOUND OR v_conn.status NOT IN ('requested', 'active') THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  v_side := CASE WHEN p_org = v_conn.label_org_id THEN 'label' WHEN p_org = v_conn.artist_org_id THEN 'artist' END;
  IF v_side IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  v_new := CASE WHEN v_conn.status = 'requested' AND v_side <> v_conn.initiated_by THEN 'declined' ELSE 'ended' END;

  UPDATE public.org_connections
  SET status = v_new, ended_by = p_actor, ended_at = now(), ended_side = v_side,
      -- the roster contact is not held by a finished connection (it can be deleted again)
      label_contact_id = NULL
  WHERE id = v_conn.id;
  DELETE FROM public.connection_projects WHERE connection_id = v_conn.id;
  UPDATE public.contacts SET artist_org_id = NULL
  WHERE org_id = v_conn.label_org_id AND artist_org_id = v_conn.artist_org_id;

  PERFORM public.labelos_audit_insert(v_conn.label_org_id, p_actor, 'connection.ended', 'connection', v_conn.id,
    public.labelos_connection_payload(v_conn.id, COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('was', v_conn.status, 'outcome', v_new, 'by_side', v_side)));
  PERFORM public.labelos_audit_insert(v_conn.artist_org_id, p_actor, 'connection.ended', 'connection', v_conn.id,
    public.labelos_connection_payload(v_conn.id, COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('was', v_conn.status, 'outcome', v_new, 'by_side', v_side)));

  RETURN jsonb_build_object('connection', public.labelos_connection_json(v_conn.id));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_connection_end(uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_connection_end(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_connection_end(uuid, uuid, uuid, jsonb) TO service_role;

-- What the artist shares. ARTIST SIDE ONLY: p_org must be the connection's
-- artist org. p_patch holds only the keys that change (share_mode,
-- allow_copies); p_project_ids, when not NULL, replaces the selected list
-- (every id a project of the artist org, else {"error": "bad_project"}).
-- Allowed while the connection is requested or active, so the artist can
-- decide before accepting. Recorded as share.created when it widens what the
-- label can reach or do (more projects, the whole catalogue, copies ON) and as
-- share.revoked when it narrows it (fewer projects, copies OFF) — both when it
-- does both, nothing when nothing changed — in the ARTIST org (the label org learns nothing it does not read through
-- its own routes). Answers {"connection": <row>, "project_ids": [...]},
-- {"error": "not_found"} or {"error": "bad_project"}.
CREATE OR REPLACE FUNCTION public.labelos_audit_connection_share(
  p_org uuid,
  p_actor uuid,
  p_connection uuid,
  p_patch jsonb,
  p_project_ids uuid[],
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_conn       public.org_connections%ROWTYPE;
  v_before_set uuid[];
  v_after_set  uuid[];
  v_before_all boolean;
  v_after_all  boolean;
  v_widened    boolean;
  v_narrowed   boolean;
  v_mode       text;
  v_copies     boolean;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'connection share patch must be an object' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_conn FROM public.org_connections WHERE id = p_connection FOR UPDATE;
  IF NOT FOUND OR v_conn.status NOT IN ('requested', 'active') OR v_conn.artist_org_id <> p_org THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF p_project_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(p_project_ids) AS pid
    WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pid AND p.org_id = p_org)
  ) THEN
    RETURN jsonb_build_object('error', 'bad_project');
  END IF;

  SELECT COALESCE(array_agg(cp.project_id ORDER BY cp.project_id), '{}') INTO v_before_set
  FROM public.connection_projects cp WHERE cp.connection_id = v_conn.id;
  v_before_all := v_conn.share_mode = 'all';

  v_mode   := COALESCE(p_patch->>'share_mode', v_conn.share_mode);
  v_copies := CASE WHEN p_patch ? 'allow_copies' THEN (p_patch->>'allow_copies')::boolean ELSE v_conn.allow_copies END;
  IF v_mode NOT IN ('selected', 'all') THEN
    RAISE EXCEPTION 'unknown share mode %', v_mode USING ERRCODE = '22023';
  END IF;

  IF p_project_ids IS NOT NULL THEN
    DELETE FROM public.connection_projects cp
    WHERE cp.connection_id = v_conn.id AND cp.project_id <> ALL (p_project_ids);
    INSERT INTO public.connection_projects (connection_id, project_id, org_id)
    SELECT v_conn.id, pid, p_org FROM (SELECT DISTINCT unnest(p_project_ids) AS pid) ids
    ON CONFLICT DO NOTHING;
  ELSIF v_before_all AND v_mode = 'selected' THEN
    -- Leaving "whole catalogue" without naming projects shares NOTHING: rows left
    -- over from before it must not come back to life.
    DELETE FROM public.connection_projects cp WHERE cp.connection_id = v_conn.id;
  END IF;

  UPDATE public.org_connections SET share_mode = v_mode, allow_copies = v_copies WHERE id = v_conn.id;

  SELECT COALESCE(array_agg(cp.project_id ORDER BY cp.project_id), '{}') INTO v_after_set
  FROM public.connection_projects cp WHERE cp.connection_id = v_conn.id;
  v_after_all := v_mode = 'all';

  -- What the label can reach (or copy) now versus before. Turning copies off
  -- narrows; turning them on widens; an unchanged share records nothing.
  v_widened := (NOT v_before_all AND v_after_all)
    OR (NOT v_before_all AND NOT v_after_all AND EXISTS (SELECT 1 FROM unnest(v_after_set) a WHERE a <> ALL (v_before_set)))
    OR (NOT v_conn.allow_copies AND v_copies);
  v_narrowed := (v_before_all AND NOT v_after_all)
    OR (NOT v_before_all AND NOT v_after_all AND EXISTS (SELECT 1 FROM unnest(v_before_set) b WHERE b <> ALL (v_after_set)))
    OR (v_conn.allow_copies AND NOT v_copies);

  IF v_narrowed THEN
    PERFORM public.labelos_audit_insert(
      p_org, p_actor, 'share.revoked', 'connection', v_conn.id,
      public.labelos_connection_payload(v_conn.id, COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object(
        'via', 'connection', 'share_mode', v_mode, 'projects', cardinality(v_after_set), 'allow_copies', v_copies
      ))
    );
  END IF;
  IF v_widened THEN
    PERFORM public.labelos_audit_insert(
      p_org, p_actor, 'share.created', 'connection', v_conn.id,
      public.labelos_connection_payload(v_conn.id, COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object(
        'via', 'connection', 'share_mode', v_mode, 'projects', cardinality(v_after_set), 'allow_copies', v_copies
      ))
    );
  END IF;

  RETURN jsonb_build_object('connection', public.labelos_connection_json(v_conn.id), 'project_ids', to_jsonb(v_after_set));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_connection_share(uuid, uuid, uuid, jsonb, uuid[], jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_connection_share(uuid, uuid, uuid, jsonb, uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_connection_share(uuid, uuid, uuid, jsonb, uuid[], jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
