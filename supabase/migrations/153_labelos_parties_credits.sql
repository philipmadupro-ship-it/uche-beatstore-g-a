-- 153_labelos_parties_credits.sql
-- Label OS (LABEL-27): rights-holder parties, and legal-grade credits by
-- EXTENDING `track_collaborators` (17 R8; no `credits` table).
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 152. Never part of supabase/apply/pending.sql.
-- (Migration 115, `track_collaborators`, IS applied on production: D7.)
--
-- 1. `parties` — a rights identity (05 §3): who wrote / published / owns a
--    master. NOT `contacts`: buyers and leads never have an IPI or a PRO, and
--    legal identifiers must not sit in a CRM table that hundreds of buyers
--    flow into. `contact_id` links the same person to the CRM, `user_id` to
--    their account. Org-only (no user_id owner, the 139/142/143/144 rule):
--    every producer route filters on a producer's `user_id`, so none can
--    reach a party. Written by the service role only.
--
-- 2. `track_collaborators` gains org_id, party_id, scope, status, role_detail,
--    created_by, confirmed_by, confirmed_at, dispute_note. EVERY EXISTING ROW
--    READS UNCHANGED: org_id / party_id / scope stay NULL, status defaults to
--    'confirmed', and the producer routes (PATCH /api/tracks/[id]/collaborators)
--    select and write the same columns as before. The unique index
--    (track_id, lower(name), role) is untouched, which keeps the filename
--    re-parse idempotent.
--
--    A BEFORE trigger is the only place the two worlds meet:
--      · a credit on a PRODUCER track (tracks.org_id IS NULL) can carry no
--        org_id and no party — the producer app never writes Label OS data;
--      · a credit on an ORG track takes that track's org_id (a different one
--        is refused), defaults to scope 'recording', and a credit read from a
--        FILENAME arrives 'proposed': a name parsed out of a file is not a
--        legal credit until someone confirms it;
--      · the party and the contact must belong to the same org.
--
-- 3. Who reads (the security core; D2 + 06 §2.3):
--      rights.read (whole org, or the song is in the member's artist scope —
--        the 149 rule, labelos_scoped_tracks) → every credit of the org's songs
--      rights.read.own_line → only a credit whose party is the caller's own
--        (parties.user_id = the caller), while still an org member
--    An external member (LABEL-21) is not an org member and reads nothing
--    through PostgREST; the route serves their own line. Legal name, IPI, ISNI
--    and PRO sit on `parties`, whose policy asks rights.read AND (whole-org
--    member, or the party is credited on a song in the caller's artist scope —
--    06 §3, labelos_scoped_parties()) or "this party is me", so a marketing or
--    A&R-without-rights member's JWT never sees them.
--    No per-row SECURITY DEFINER call (R-08): the capability and the scope are
--    asked of the caller's own few memberships in uncorrelated subplans, the
--    149 pattern (proved with EXPLAIN in supabase/local/checks/153_*.sql).
--
-- 4. Writes: service role only (141's labelos_org_rows_service_only is
--    already on track_collaborators; it is added to parties here). The two
--    audit decisions — confirm and dispute (06 §6) — are ONE SECURITY DEFINER
--    function that changes the credit and inserts the `activity_events` row in
--    one transaction (the 146 pattern): EXECUTE for service_role only.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS first.

-- ── 1. parties ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.parties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'person',
  display_name    text NOT NULL,
  legal_name      text,
  email           text,
  ipi             text,
  isni            text,
  pro             text,
  pro_affiliation text NOT NULL DEFAULT 'unknown',
  publisher_name  text,
  publisher_ipi   text,
  contact_id      uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parties_kind_check CHECK (kind IN ('person', 'company')),
  CONSTRAINT parties_pro_affiliation_check CHECK (pro_affiliation IN ('affiliated', 'not_affiliated', 'unknown')),
  CONSTRAINT parties_display_name_check CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  -- Same shapes lib/labelos/identifiers.ts normalises to (9-11 digits).
  CONSTRAINT parties_ipi_format CHECK (ipi IS NULL OR ipi ~ '^[0-9]{9,11}$'),
  CONSTRAINT parties_publisher_ipi_format CHECK (publisher_ipi IS NULL OR publisher_ipi ~ '^[0-9]{9,11}$'),
  CONSTRAINT parties_isni_format CHECK (isni IS NULL OR isni ~ '^[0-9]{15}[0-9X]$')
);

CREATE INDEX IF NOT EXISTS idx_parties_org_name ON public.parties (org_id, lower(display_name));
-- One rights identity per account per org: "themselves" is a single row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_parties_org_user
  ON public.parties (org_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parties_contact ON public.parties (contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.parties_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.org_id <> OLD.org_id THEN
    RAISE EXCEPTION 'parties: a party keeps its organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'parties: the contact must be a contact of the same organization'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.parties_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.parties_integrity() FROM PUBLIC;

DROP TRIGGER IF EXISTS parties_integrity ON public.parties;
CREATE TRIGGER parties_integrity BEFORE INSERT OR UPDATE ON public.parties
  FOR EACH ROW EXECUTE FUNCTION public.parties_integrity();

DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.parties;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.parties
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');

-- ── 2. track_collaborators: the Label OS columns ─────────────────────────

ALTER TABLE public.track_collaborators ADD COLUMN IF NOT EXISTS org_id       uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.track_collaborators ADD COLUMN IF NOT EXISTS party_id     uuid REFERENCES public.parties(id) ON DELETE RESTRICT;
ALTER TABLE public.track_collaborators ADD COLUMN IF NOT EXISTS scope        text;
ALTER TABLE public.track_collaborators ADD COLUMN IF NOT EXISTS status       text NOT NULL DEFAULT 'confirmed';
ALTER TABLE public.track_collaborators ADD COLUMN IF NOT EXISTS role_detail  text;
ALTER TABLE public.track_collaborators ADD COLUMN IF NOT EXISTS created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.track_collaborators ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.track_collaborators ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE public.track_collaborators ADD COLUMN IF NOT EXISTS dispute_note text;

ALTER TABLE public.track_collaborators DROP CONSTRAINT IF EXISTS track_collaborators_scope_check;
ALTER TABLE public.track_collaborators ADD CONSTRAINT track_collaborators_scope_check
  CHECK (scope IS NULL OR scope IN ('composition', 'recording'));
ALTER TABLE public.track_collaborators DROP CONSTRAINT IF EXISTS track_collaborators_status_check;
ALTER TABLE public.track_collaborators ADD CONSTRAINT track_collaborators_status_check
  CHECK (status IN ('proposed', 'confirmed', 'disputed'));
ALTER TABLE public.track_collaborators DROP CONSTRAINT IF EXISTS track_collaborators_role_detail_check;
ALTER TABLE public.track_collaborators ADD CONSTRAINT track_collaborators_role_detail_check
  CHECK (role_detail IS NULL OR length(role_detail) BETWEEN 1 AND 200);
ALTER TABLE public.track_collaborators DROP CONSTRAINT IF EXISTS track_collaborators_dispute_note_check;
ALTER TABLE public.track_collaborators ADD CONSTRAINT track_collaborators_dispute_note_check
  CHECK (dispute_note IS NULL OR length(dispute_note) BETWEEN 1 AND 1000);
-- Label OS data lives on org rows only; a producer row carries none of it.
ALTER TABLE public.track_collaborators DROP CONSTRAINT IF EXISTS track_collaborators_org_columns;
ALTER TABLE public.track_collaborators ADD CONSTRAINT track_collaborators_org_columns
  CHECK (org_id IS NOT NULL OR (party_id IS NULL AND scope IS NULL AND status = 'confirmed'));

CREATE INDEX IF NOT EXISTS idx_track_collaborators_org_track
  ON public.track_collaborators (org_id, track_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_track_collaborators_party
  ON public.track_collaborators (party_id) WHERE party_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.track_collaborators_org_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT t.org_id INTO v_org FROM public.tracks t WHERE t.id = NEW.track_id;

  IF v_org IS NULL THEN
    -- A producer track: nothing of Label OS may ride on its credits.
    IF NEW.org_id IS NOT NULL OR NEW.party_id IS NOT NULL OR NEW.scope IS NOT NULL OR NEW.status <> 'confirmed' THEN
      RAISE EXCEPTION 'track_collaborators: a producer track takes no organization, party, scope or status'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.org_id IS NOT NULL AND NEW.org_id <> v_org THEN
    RAISE EXCEPTION 'track_collaborators: the credit must belong to the track''s organization'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.org_id := v_org;

  IF TG_OP = 'UPDATE' AND (NEW.track_id <> OLD.track_id OR (OLD.org_id IS NOT NULL AND NEW.org_id <> OLD.org_id)) THEN
    RAISE EXCEPTION 'track_collaborators: a credit keeps its track and organization'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.scope IS NULL THEN
    -- The legacy producer / feature / collaborator roles are production credits.
    NEW.scope := 'recording';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.source = 'filename' AND NEW.status = 'confirmed' AND NEW.confirmed_by IS NULL THEN
    NEW.status := 'proposed';
  END IF;

  IF NEW.party_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.parties p WHERE p.id = NEW.party_id AND p.org_id = v_org
  ) THEN
    RAISE EXCEPTION 'track_collaborators: the party must belong to the same organization'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.org_id = v_org
  ) THEN
    RAISE EXCEPTION 'track_collaborators: the contact must belong to the same organization'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.track_collaborators_org_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.track_collaborators_org_integrity() FROM PUBLIC;

DROP TRIGGER IF EXISTS track_collaborators_org_integrity ON public.track_collaborators;
CREATE TRIGGER track_collaborators_org_integrity BEFORE INSERT OR UPDATE ON public.track_collaborators
  FOR EACH ROW EXECUTE FUNCTION public.track_collaborators_org_integrity();

-- Org members read org credits; the producer policy (via the parent track's
-- owner) is untouched and cannot match an org track (user_id NULL).
DROP POLICY IF EXISTS track_collaborators_org_member_read ON public.track_collaborators;
CREATE POLICY track_collaborators_org_member_read ON public.track_collaborators
  FOR SELECT
  USING (
    org_id IS NOT NULL
    AND (
      (
        org_id IN (
          SELECT cm.org_id
          FROM public.org_members cm
          WHERE cm.user_id = (SELECT auth.uid())
            AND public.has_org_cap(cm.org_id, 'rights.read')
        )
        AND (
          org_id IN (
            SELECT om.org_id
            FROM public.org_members om
            WHERE om.user_id = (SELECT auth.uid())
              AND om.scope = 'org'
              AND om.role <> 'artist'
          )
          OR (org_id, track_id) IN (SELECT st.org_id, st.track_id FROM public.labelos_scoped_tracks() st)
        )
      )
      OR (
        party_id IN (SELECT mp.id FROM public.parties mp WHERE mp.user_id = (SELECT auth.uid()))
        AND org_id IN (SELECT mm.org_id FROM public.org_members mm WHERE mm.user_id = (SELECT auth.uid()))
      )
    )
  );

-- ── 2b. Parties: who reads them ──────────────────────────────────────────
-- 06 §3: org-level parties (no artist) are for whole-org members, EXCEPT the
-- parties named by credits on songs in the caller's artist scope. So:
--   rights.read AND (a whole-org member, OR the party is credited on a song of
--     the caller's scope — labelos_scoped_parties(), below)
--   OR the party is the caller's own identity (parties.user_id), while they are
--     still a member of that org (this is also what lets the own-line branch of
--     the credits policy find "my party" without the credits policy and this
--     one calling each other: a policy that reads a table whose policy reads
--     back is "infinite recursion" in Postgres).
-- No per-row SECURITY DEFINER call: every disjunct is an uncorrelated subplan.

CREATE OR REPLACE FUNCTION public.labelos_scoped_parties()
RETURNS TABLE (org_id uuid, party_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT c.org_id, c.party_id
  FROM public.labelos_scoped_tracks() st
  JOIN public.track_collaborators c ON c.track_id = st.track_id AND c.org_id = st.org_id
  WHERE c.party_id IS NOT NULL;
$$;

ALTER FUNCTION public.labelos_scoped_parties() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_scoped_parties() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.labelos_scoped_parties() TO authenticated, anon;

DROP POLICY IF EXISTS parties_member_read ON public.parties;
CREATE POLICY parties_member_read ON public.parties
  FOR SELECT
  USING (
    (
      org_id IN (
        SELECT cm.org_id
        FROM public.org_members cm
        WHERE cm.user_id = (SELECT auth.uid())
          AND public.has_org_cap(cm.org_id, 'rights.read')
      )
      AND (
        org_id IN (
          SELECT om.org_id
          FROM public.org_members om
          WHERE om.user_id = (SELECT auth.uid())
            AND om.scope = 'org'
            AND om.role <> 'artist'
        )
        OR (org_id, id) IN (SELECT sp.org_id, sp.party_id FROM public.labelos_scoped_parties() sp)
      )
    )
    OR (
      user_id = (SELECT auth.uid())
      AND org_id IN (SELECT mm.org_id FROM public.org_members mm WHERE mm.user_id = (SELECT auth.uid()))
    )
  );

-- 141 put a RESTRICTIVE guard on this table, `NOT labelos_is_org_track(track_id)`,
-- so no producer-era policy could reach a credit of an org track. It would also
-- hide the org policy above from every member. It is replaced (same name, still
-- RESTRICTIVE / SELECT) by: a row that carries an org_id is an org credit, which
-- only the org policy can admit; anything else is held to the old rule. The
-- trigger above stamps org_id on every credit of an org track, so a credit of an
-- org track WITHOUT one cannot exist, and the producer policy still cannot match
-- one (org tracks have no user_id). `org_id IS NOT NULL` is tested first, so org
-- rows never pay for the per-row helper.
DROP POLICY IF EXISTS org_member_guard ON public.track_collaborators;
CREATE POLICY org_member_guard ON public.track_collaborators
  AS RESTRICTIVE FOR SELECT
  USING (org_id IS NOT NULL OR NOT public.labelos_is_org_track(track_id));

-- ── 3. Confirm / dispute: the audit decision ─────────────────────────────
-- p_decision: 'confirmed' | 'disputed'. The route has already decided WHO may
-- (rights.write, or the credited person for their own line); this function
-- does what the database can know for itself: the credit is a credit of the
-- org, a decision is a change, and the event is written in the same
-- transaction. p_subject carries the song's context keys the route resolved
-- ({artist_id, project_id, song_id}, each a uuid or null).
-- Answers {"credit": <row>}, {"error": "not_found"} or {"error": "unchanged"}.

CREATE OR REPLACE FUNCTION public.labelos_audit_credit_decide(
  p_org uuid,
  p_actor uuid,
  p_credit uuid,
  p_decision text,
  p_note text,
  p_subject jsonb,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row   public.track_collaborators%ROWTYPE;
  v_verb  text;
  v_art   uuid;
  v_proj  uuid;
  v_song  uuid;
BEGIN
  IF p_decision NOT IN ('confirmed', 'disputed') THEN
    RAISE EXCEPTION 'unknown credit decision %', p_decision USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'audit payload must be an object' USING ERRCODE = '22023';
  END IF;
  IF p_payload::text ~* '"[^"]*(token|password|secret)[^"]*"\s*:' THEN
    RAISE EXCEPTION 'audit payload carries a secret-looking key' USING ERRCODE = '22023';
  END IF;
  IF pg_column_size(p_payload) > 16384 THEN
    RAISE EXCEPTION 'audit payload is too large' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.track_collaborators
  WHERE id = p_credit AND org_id = p_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_row.status = p_decision THEN
    RETURN jsonb_build_object('error', 'unchanged');
  END IF;

  IF p_decision = 'confirmed' THEN
    UPDATE public.track_collaborators
    SET status = 'confirmed', confirmed_by = p_actor, confirmed_at = now(), dispute_note = NULL
    WHERE id = p_credit
    RETURNING * INTO v_row;
    v_verb := 'credit.confirmed';
  ELSE
    UPDATE public.track_collaborators
    SET status = 'disputed', confirmed_by = NULL, confirmed_at = NULL, dispute_note = p_note
    WHERE id = p_credit
    RETURNING * INTO v_row;
    v_verb := 'credit.disputed';
  END IF;

  v_art  := NULLIF(p_subject->>'artist_id', '')::uuid;
  v_proj := NULLIF(p_subject->>'project_id', '')::uuid;
  v_song := NULLIF(p_subject->>'song_id', '')::uuid;

  -- The creative record (DEFAULT_VISIBILITY: 'artist'), kept for the life of
  -- the org (audit = true).
  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, song_id, payload, audit, visibility)
  VALUES (p_org, p_actor, v_verb, 'credit', v_row.id, v_art, v_proj, v_song, p_payload, true, 'artist');

  RETURN jsonb_build_object('credit', to_jsonb(v_row));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_credit_decide(uuid, uuid, uuid, text, text, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_credit_decide(uuid, uuid, uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_credit_decide(uuid, uuid, uuid, text, text, jsonb, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
