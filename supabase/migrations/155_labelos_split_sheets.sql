-- 155_labelos_split_sheets.sql
-- Label OS (LABEL-28): versioned composition / master split sheets that must
-- add up to exactly 100.0000 before they can leave `draft`.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 153 (and 154). Never part of supabase/apply/pending.sql.
--
-- 1. `split_sheets` — one row per (song, kind, version). `track_id` is the
--    song (an org track, type 'song'); `kind` composition | master;
--    `status` draft | circulated | signed | superseded | disputed.
--    At most ONE draft and ONE live (circulated | signed | disputed) sheet per
--    (song, kind): a new version is a new draft, and circulating it moves the
--    previous live one to `superseded` in the same transaction.
-- 2. `split_lines` — party, role, `share numeric(7,4)` (0 < share <= 100),
--    and the signature of that line: `signed_at`, `signature_method`
--    (upload | acknowledged), `signature_asset_id` (a RESTRICTED
--    `project_assets` row, kind split_sheet — 143 makes that kind always
--    restricted). `org_id` / `track_id` are stamped from the sheet so the read
--    policy never has to join back to it.
--
-- The two rules the backlog names are held HERE, not only in the route:
--   · a sheet leaves `draft` only if it has lines and they sum to exactly 100
--     (numeric arithmetic, no float), every role belongs to its kind, and every
--     party belongs to the org;
--   · from `circulated` on, the lines never change (party, role, share), nor
--     does the sheet's note, kind, version or song. Only signatures are written
--     on a circulated sheet's lines (NULL → set), and a signature's FILE
--     reference may go back to NULL if the file is deleted.
--   A sheet is deleted only while a draft. Legal moves are exactly
--   lib/labelos/splits.ts#canTransition.
--
-- 3. Writes: service role only (141's labelos_org_rows_service_only on both
--    tables). Three SECURITY DEFINER functions, EXECUTE for service_role only:
--      labelos_split_create_draft  a new version (optionally copying a sheet's
--                                  lines), sheet + lines in one transaction;
--      labelos_split_save_draft    replace a draft's note and lines atomically;
--      labelos_audit_split_circulate / labelos_audit_split_sign
--                                  the audit transitions (146 / 153 pattern):
--                                  the change AND its `activity_events` row in
--                                  ONE transaction. Circulating also supersedes
--                                  the previous live version, and records
--                                  `split_sheet.superseded` for it.
-- 4. Reads (RLS, SELECT): `rights.read` AND (a whole-org member, or the song is
--    in the caller's artist scope — labelos_scoped_tracks(), 149), OR the line
--    is the caller's OWN (D2) on a sheet that has been circulated (a draft is
--    still being negotiated). The own-line set comes from ONE uncorrelated call
--    to labelos_my_split_lines() (R-08: no per-row SECURITY DEFINER call), which
--    is also what keeps the two policies from reading each other.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS first.

-- ── 1. split_sheets ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.split_sheets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  track_id          uuid NOT NULL REFERENCES public.tracks(id),
  kind              text NOT NULL,
  version           int  NOT NULL,
  status            text NOT NULL DEFAULT 'draft',
  note              text,
  document_asset_id uuid REFERENCES public.project_assets(id) ON DELETE SET NULL,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  circulated_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  circulated_at     timestamptz,
  signed_at         timestamptz,
  superseded_at     timestamptz,
  superseded_by     uuid REFERENCES public.split_sheets(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT split_sheets_kind_check CHECK (kind IN ('composition', 'master')),
  CONSTRAINT split_sheets_status_check CHECK (status IN ('draft', 'circulated', 'signed', 'superseded', 'disputed')),
  CONSTRAINT split_sheets_version_check CHECK (version >= 1),
  CONSTRAINT split_sheets_note_check CHECK (note IS NULL OR length(note) <= 2000),
  CONSTRAINT split_sheets_version_uniq UNIQUE (track_id, kind, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_split_sheets_one_draft
  ON public.split_sheets (track_id, kind) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS idx_split_sheets_one_live
  ON public.split_sheets (track_id, kind) WHERE status IN ('circulated', 'signed', 'disputed');
CREATE INDEX IF NOT EXISTS idx_split_sheets_org_track ON public.split_sheets (org_id, track_id);

ALTER TABLE public.split_sheets ENABLE ROW LEVEL SECURITY;

-- ── 2. split_lines ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.split_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  split_sheet_id     uuid NOT NULL REFERENCES public.split_sheets(id) ON DELETE CASCADE,
  org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  track_id           uuid NOT NULL REFERENCES public.tracks(id),
  party_id           uuid NOT NULL REFERENCES public.parties(id),
  role               text NOT NULL,
  share              numeric(7,4) NOT NULL,
  signed_at          timestamptz,
  signature_method   text,
  signature_asset_id uuid REFERENCES public.project_assets(id) ON DELETE SET NULL,
  signed_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT split_lines_role_check CHECK (role IN ('writer', 'composer', 'writer_composer', 'publisher', 'master_owner')),
  CONSTRAINT split_lines_share_check CHECK (share > 0 AND share <= 100),
  CONSTRAINT split_lines_method_check CHECK (signature_method IS NULL OR signature_method IN ('upload', 'acknowledged')),
  CONSTRAINT split_lines_signature_pair CHECK ((signed_at IS NULL) = (signature_method IS NULL)),
  CONSTRAINT split_lines_party_role_uniq UNIQUE (split_sheet_id, party_id, role)
);

CREATE INDEX IF NOT EXISTS idx_split_lines_party ON public.split_lines (party_id);
CREATE INDEX IF NOT EXISTS idx_split_lines_org_track ON public.split_lines (org_id, track_id);

ALTER TABLE public.split_lines ENABLE ROW LEVEL SECURITY;

-- ── 3. Integrity triggers ────────────────────────────────────────────────

-- The roles each kind of sheet may carry (lib/labelos/splits.ts#ROLES_BY_KIND).
CREATE OR REPLACE FUNCTION public.labelos_split_role_ok(p_kind text, p_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_kind
    WHEN 'composition' THEN p_role IN ('writer', 'composer', 'writer_composer', 'publisher')
    WHEN 'master' THEN p_role = 'master_owner'
    ELSE false
  END;
$$;

ALTER FUNCTION public.labelos_split_role_ok(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_split_role_ok(text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.split_sheets_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_track_org  uuid;
  v_track_type text;
  v_total      numeric;
  v_count      int;
  v_bad        int;
  v_unsigned   int;
BEGIN
  -- 141's labelos_org_rows_service_only is on this table too, but it reads
  -- org_id from the row and a line's is stamped below; refuse the API roles
  -- here first, whatever the row holds. (current_user is the definer in here.)
  IF current_setting('role', true) IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'split_sheets: organization rows are written through /api/org only' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- A circulated, signed or disputed sheet is a legal record. It goes only
    -- with its organization (the cascade finds the org already gone).
    IF OLD.status <> 'draft' AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.org_id) THEN
      RAISE EXCEPTION 'split_sheets: a % sheet cannot be deleted', OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT t.org_id, t.type INTO v_track_org, v_track_type FROM public.tracks t WHERE t.id = NEW.track_id;
    IF v_track_org IS NULL OR v_track_org <> NEW.org_id THEN
      RAISE EXCEPTION 'split_sheets: the song must be a song of the same organization' USING ERRCODE = 'check_violation';
    END IF;
    IF v_track_type <> 'song' THEN
      RAISE EXCEPTION 'split_sheets: a split sheet belongs to a song' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'split_sheets: a sheet starts as a draft' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.version IS NULL THEN
      SELECT COALESCE(MAX(s.version), 0) + 1 INTO NEW.version
      FROM public.split_sheets s WHERE s.track_id = NEW.track_id AND s.kind = NEW.kind;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.org_id <> OLD.org_id OR NEW.track_id <> OLD.track_id OR NEW.kind <> OLD.kind OR NEW.version <> OLD.version
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'split_sheets: a sheet keeps its organization, song, kind and version' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status <> 'draft' AND NEW.note IS DISTINCT FROM OLD.note THEN
    RAISE EXCEPTION 'split_sheets: a circulated sheet cannot be edited' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT (
      (OLD.status = 'draft'      AND NEW.status = 'circulated')
      OR (OLD.status = 'circulated' AND NEW.status IN ('signed', 'disputed', 'superseded'))
      OR (OLD.status IN ('signed', 'disputed') AND NEW.status = 'superseded')
    ) THEN
      RAISE EXCEPTION 'split_sheets: a sheet cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'circulated' THEN
      -- Leaving draft: the lines are complete and add up to exactly 100.
      SELECT COALESCE(SUM(l.share), 0), COUNT(*),
             COUNT(*) FILTER (WHERE NOT public.labelos_split_role_ok(NEW.kind, l.role))
        INTO v_total, v_count, v_bad
      FROM public.split_lines l WHERE l.split_sheet_id = NEW.id;
      IF v_count = 0 THEN
        RAISE EXCEPTION 'split_sheets: a sheet needs at least one line to circulate' USING ERRCODE = 'check_violation';
      END IF;
      IF v_bad > 0 THEN
        RAISE EXCEPTION 'split_sheets: a % sheet carries a role that does not belong to it', NEW.kind USING ERRCODE = 'check_violation';
      END IF;
      IF v_total <> 100 THEN
        RAISE EXCEPTION 'split_sheets: the shares add up to %, not 100', v_total USING ERRCODE = 'check_violation';
      END IF;
      NEW.circulated_at := COALESCE(NEW.circulated_at, now());
    ELSIF NEW.status = 'signed' THEN
      SELECT COUNT(*) FILTER (WHERE l.signed_at IS NULL) INTO v_unsigned FROM public.split_lines l WHERE l.split_sheet_id = NEW.id;
      IF v_unsigned > 0 THEN
        RAISE EXCEPTION 'split_sheets: every line must be signed first' USING ERRCODE = 'check_violation';
      END IF;
      NEW.signed_at := COALESCE(NEW.signed_at, now());
    ELSIF NEW.status = 'superseded' THEN
      NEW.superseded_at := COALESCE(NEW.superseded_at, now());
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.split_sheets_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.split_sheets_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS split_sheets_guard ON public.split_sheets;
CREATE TRIGGER split_sheets_guard BEFORE INSERT OR UPDATE OR DELETE ON public.split_sheets
  FOR EACH ROW EXECUTE FUNCTION public.split_sheets_guard();

CREATE OR REPLACE FUNCTION public.split_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sheet public.split_sheets%ROWTYPE;
BEGIN
  IF current_setting('role', true) IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'split_lines: organization rows are written through /api/org only' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- FOR SHARE: circulating a sheet takes the row FOR UPDATE, so a line
  -- written at the same moment either lands before the sum is read or waits
  -- and finds a sheet that is no longer a draft.
  SELECT * INTO v_sheet FROM public.split_sheets s
  WHERE s.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.split_sheet_id ELSE NEW.split_sheet_id END
  FOR SHARE;

  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; -- the sheet is going (cascade)
    RAISE EXCEPTION 'split_lines: the sheet does not exist' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_sheet.status <> 'draft' THEN
      RAISE EXCEPTION 'split_lines: a circulated sheet cannot be edited' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_sheet.status <> 'draft' THEN
      RAISE EXCEPTION 'split_lines: a circulated sheet cannot be edited' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.signed_at IS NOT NULL OR NEW.signature_method IS NOT NULL OR NEW.signature_asset_id IS NOT NULL THEN
      RAISE EXCEPTION 'split_lines: a new line is not signed' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.split_sheet_id <> OLD.split_sheet_id OR NEW.org_id <> OLD.org_id OR NEW.track_id <> OLD.track_id THEN
      RAISE EXCEPTION 'split_lines: a line stays on its sheet' USING ERRCODE = 'check_violation';
    END IF;
    IF v_sheet.status <> 'draft' THEN
      -- Only the signature may be written, once; its file may be cleared.
      IF NEW.party_id <> OLD.party_id OR NEW.role <> OLD.role OR NEW.share <> OLD.share THEN
        RAISE EXCEPTION 'split_lines: a circulated sheet cannot be edited' USING ERRCODE = 'check_violation';
      END IF;
      IF OLD.signed_at IS NOT NULL AND (NEW.signed_at IS DISTINCT FROM OLD.signed_at OR NEW.signature_method IS DISTINCT FROM OLD.signature_method
         OR NEW.signed_by IS DISTINCT FROM OLD.signed_by) THEN
        RAISE EXCEPTION 'split_lines: a signature cannot be changed' USING ERRCODE = 'check_violation';
      END IF;
      IF OLD.signed_at IS NULL AND NEW.signed_at IS NOT NULL AND v_sheet.status <> 'circulated' THEN
        RAISE EXCEPTION 'split_lines: this version is not open for signatures' USING ERRCODE = 'check_violation';
      END IF;
      IF OLD.signature_asset_id IS NOT NULL AND NEW.signature_asset_id IS NOT NULL AND NEW.signature_asset_id <> OLD.signature_asset_id THEN
        RAISE EXCEPTION 'split_lines: a signature cannot be changed' USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.signed_at IS NOT NULL OR NEW.signature_method IS NOT NULL OR NEW.signature_asset_id IS NOT NULL THEN
      RAISE EXCEPTION 'split_lines: a draft is not signed' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Draft insert / update: the line belongs to its sheet's org, song and kind.
  NEW.org_id := v_sheet.org_id;
  NEW.track_id := v_sheet.track_id;
  IF NOT public.labelos_split_role_ok(v_sheet.kind, NEW.role) THEN
    RAISE EXCEPTION 'split_lines: % is not a role of a % sheet', NEW.role, v_sheet.kind USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.parties p WHERE p.id = NEW.party_id AND p.org_id = v_sheet.org_id) THEN
    RAISE EXCEPTION 'split_lines: the party must belong to the same organization' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.split_lines_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.split_lines_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS split_lines_guard ON public.split_lines;
CREATE TRIGGER split_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.split_lines
  FOR EACH ROW EXECUTE FUNCTION public.split_lines_guard();

DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.split_sheets;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.split_sheets
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.split_lines;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.split_lines
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');

-- ── 4. Reads ─────────────────────────────────────────────────────────────
-- The caller's own lines on sheets that have left draft (D2). One call, no
-- argument that varies by row: a hashed subplan in the policies below.

CREATE OR REPLACE FUNCTION public.labelos_my_split_lines()
RETURNS TABLE (sheet_id uuid, line_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.split_sheet_id, l.id
  FROM public.split_lines l
  JOIN public.split_sheets s ON s.id = l.split_sheet_id
  JOIN public.parties p ON p.id = l.party_id
  WHERE p.user_id = auth.uid()
    AND s.status <> 'draft'
    AND s.org_id IN (SELECT m.org_id FROM public.org_members m WHERE m.user_id = auth.uid());
$$;

ALTER FUNCTION public.labelos_my_split_lines() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_my_split_lines() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.labelos_my_split_lines() TO authenticated, anon;

DROP POLICY IF EXISTS split_sheets_member_read ON public.split_sheets;
CREATE POLICY split_sheets_member_read ON public.split_sheets
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
        OR (org_id, track_id) IN (SELECT st.org_id, st.track_id FROM public.labelos_scoped_tracks() st)
      )
    )
    OR id IN (SELECT ml.sheet_id FROM public.labelos_my_split_lines() ml)
  );

DROP POLICY IF EXISTS split_lines_member_read ON public.split_lines;
CREATE POLICY split_lines_member_read ON public.split_lines
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
        OR (org_id, track_id) IN (SELECT st.org_id, st.track_id FROM public.labelos_scoped_tracks() st)
      )
    )
    OR id IN (SELECT ml.line_id FROM public.labelos_my_split_lines() ml)
  );

-- ── 5. Writes: create / save a draft ─────────────────────────────────────
-- p_lines: [{ "party_id": uuid, "role": text, "share": "33.3333" }, ...]

CREATE OR REPLACE FUNCTION public.labelos_split_create_draft(
  p_org uuid,
  p_actor uuid,
  p_track uuid,
  p_kind text,
  p_note text,
  p_lines jsonb,
  p_copy_from uuid
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_sheet public.split_sheets%ROWTYPE;
  v_src   public.split_sheets%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('composition', 'master') THEN
    RAISE EXCEPTION 'unknown split kind %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NOT NULL AND jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'lines must be an array' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = p_track AND t.org_id = p_org AND t.type = 'song') THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF EXISTS (SELECT 1 FROM public.split_sheets s WHERE s.track_id = p_track AND s.kind = p_kind AND s.status = 'draft') THEN
    RETURN jsonb_build_object('error', 'draft_exists');
  END IF;

  IF p_copy_from IS NOT NULL THEN
    SELECT * INTO v_src FROM public.split_sheets s
    WHERE s.id = p_copy_from AND s.org_id = p_org AND s.track_id = p_track AND s.kind = p_kind;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'not_found');
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.split_sheets (org_id, track_id, kind, version, status, note, created_by)
    VALUES (p_org, p_track, p_kind, NULL, 'draft', COALESCE(p_note, v_src.note), p_actor)
    RETURNING * INTO v_sheet;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error', 'draft_exists');
  END;

  IF p_copy_from IS NOT NULL THEN
    INSERT INTO public.split_lines (split_sheet_id, org_id, track_id, party_id, role, share)
    SELECT v_sheet.id, p_org, p_track, l.party_id, l.role, l.share
    FROM public.split_lines l WHERE l.split_sheet_id = p_copy_from;
  ELSIF p_lines IS NOT NULL THEN
    INSERT INTO public.split_lines (split_sheet_id, org_id, track_id, party_id, role, share)
    SELECT v_sheet.id, p_org, p_track, (e->>'party_id')::uuid, e->>'role', (e->>'share')::numeric
    FROM jsonb_array_elements(p_lines) e;
  END IF;

  RETURN jsonb_build_object('sheet', to_jsonb(v_sheet));
END;
$fn$;

ALTER FUNCTION public.labelos_split_create_draft(uuid, uuid, uuid, text, text, jsonb, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_split_create_draft(uuid, uuid, uuid, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_split_create_draft(uuid, uuid, uuid, text, text, jsonb, uuid) TO service_role;

-- Replace a draft's note and/or its whole set of lines in one transaction.
-- p_set_note / p_set_lines say which of the two the caller names (a NULL note
-- is "clear it", so the flag is separate).
CREATE OR REPLACE FUNCTION public.labelos_split_save_draft(
  p_org uuid,
  p_sheet uuid,
  p_set_note boolean,
  p_note text,
  p_set_lines boolean,
  p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_sheet public.split_sheets%ROWTYPE;
BEGIN
  IF p_set_lines AND (p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array') THEN
    RAISE EXCEPTION 'lines must be an array' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sheet FROM public.split_sheets s WHERE s.id = p_sheet AND s.org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_sheet.status <> 'draft' THEN
    RETURN jsonb_build_object('error', 'not_draft');
  END IF;

  IF p_set_lines THEN
    DELETE FROM public.split_lines WHERE split_sheet_id = p_sheet;
    INSERT INTO public.split_lines (split_sheet_id, org_id, track_id, party_id, role, share)
    SELECT p_sheet, v_sheet.org_id, v_sheet.track_id, (e->>'party_id')::uuid, e->>'role', (e->>'share')::numeric
    FROM jsonb_array_elements(p_lines) e;
  END IF;
  IF p_set_note THEN
    UPDATE public.split_sheets SET note = p_note WHERE id = p_sheet;
  ELSE
    UPDATE public.split_sheets SET updated_at = now() WHERE id = p_sheet;
  END IF;

  SELECT * INTO v_sheet FROM public.split_sheets s WHERE s.id = p_sheet;
  RETURN jsonb_build_object('sheet', to_jsonb(v_sheet));
END;
$fn$;

ALTER FUNCTION public.labelos_split_save_draft(uuid, uuid, boolean, text, boolean, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_split_save_draft(uuid, uuid, boolean, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_split_save_draft(uuid, uuid, boolean, text, boolean, jsonb) TO service_role;

-- ── 6. Audit transitions ─────────────────────────────────────────────────

-- Shared payload guard (146's rule: an object, no secret-looking key, small).
CREATE OR REPLACE FUNCTION public.labelos_split_check_payload(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'audit payload must be an object' USING ERRCODE = '22023';
  END IF;
  IF p_payload::text ~* '"[^"]*(token|password|secret)[^"]*"\s*:' THEN
    RAISE EXCEPTION 'audit payload carries a secret-looking key' USING ERRCODE = '22023';
  END IF;
  IF pg_column_size(p_payload) > 16384 THEN
    RAISE EXCEPTION 'audit payload is too large' USING ERRCODE = '22023';
  END IF;
END;
$$;

ALTER FUNCTION public.labelos_split_check_payload(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_split_check_payload(jsonb) FROM PUBLIC;

-- Circulate a draft. Answers {"sheet": <row>, "superseded": <id>|null},
-- {"error": "not_found" | "not_draft" | "no_lines" | "bad_total", "total"?}.
-- The previous live version of the same song and kind becomes `superseded`
-- first (the one-live index would otherwise refuse the move), with its own
-- `split_sheet.superseded` event, in the same transaction.
CREATE OR REPLACE FUNCTION public.labelos_audit_split_circulate(
  p_org uuid,
  p_actor uuid,
  p_sheet uuid,
  p_subject jsonb,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_sheet public.split_sheets%ROWTYPE;
  v_old   public.split_sheets%ROWTYPE;
  v_total numeric;
  v_count int;
  v_art   uuid;
  v_proj  uuid;
  v_song  uuid;
BEGIN
  PERFORM public.labelos_split_check_payload(p_payload);

  SELECT * INTO v_sheet FROM public.split_sheets s WHERE s.id = p_sheet AND s.org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_sheet.status <> 'draft' THEN
    RETURN jsonb_build_object('error', 'not_draft');
  END IF;

  SELECT COALESCE(SUM(l.share), 0), COUNT(*) INTO v_total, v_count FROM public.split_lines l WHERE l.split_sheet_id = p_sheet;
  IF v_count = 0 THEN
    RETURN jsonb_build_object('error', 'no_lines');
  END IF;
  IF v_total <> 100 THEN
    RETURN jsonb_build_object('error', 'bad_total', 'total', v_total);
  END IF;

  v_art  := NULLIF(p_subject->>'artist_id', '')::uuid;
  v_proj := NULLIF(p_subject->>'project_id', '')::uuid;
  v_song := NULLIF(p_subject->>'song_id', '')::uuid;

  SELECT * INTO v_old FROM public.split_sheets s
  WHERE s.track_id = v_sheet.track_id AND s.kind = v_sheet.kind AND s.id <> p_sheet
    AND s.status IN ('circulated', 'signed', 'disputed')
  FOR UPDATE;
  IF FOUND THEN
    UPDATE public.split_sheets SET status = 'superseded', superseded_by = p_sheet WHERE id = v_old.id;
    INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, song_id, payload, audit, visibility)
    VALUES (p_org, p_actor, 'split_sheet.superseded', 'split_sheet', v_old.id, v_art, v_proj, v_song,
            jsonb_build_object('kind', v_old.kind, 'version', v_old.version, 'by_version', v_sheet.version), true, 'internal');
  END IF;

  UPDATE public.split_sheets
  SET status = 'circulated', circulated_by = p_actor, circulated_at = now()
  WHERE id = p_sheet
  RETURNING * INTO v_sheet;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, song_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'split_sheet.circulated', 'split_sheet', v_sheet.id, v_art, v_proj, v_song,
          CASE WHEN v_old.id IS NULL THEN p_payload ELSE p_payload || jsonb_build_object('supersedes_version', v_old.version) END,
          true, 'internal');

  RETURN jsonb_build_object('sheet', to_jsonb(v_sheet), 'superseded', v_old.id);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_split_circulate(uuid, uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_split_circulate(uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_split_circulate(uuid, uuid, uuid, jsonb, jsonb) TO service_role;

-- Record a signature. p_line NULL = every unsigned line of the sheet (a signed
-- PDF covering the whole sheet, method 'upload' only). p_asset: the restricted
-- split_sheet file, required for 'upload'. When the last line is signed the
-- sheet becomes `signed`. Answers {"sheet": <row>, "complete": bool, "signed": n},
-- {"error": "not_found" | "not_circulated" | "no_line" | "already_signed" | "bad_asset" | "bad_method"}.
CREATE OR REPLACE FUNCTION public.labelos_audit_split_sign(
  p_org uuid,
  p_actor uuid,
  p_sheet uuid,
  p_line uuid,
  p_method text,
  p_asset uuid,
  p_subject jsonb,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_sheet    public.split_sheets%ROWTYPE;
  v_signed   int;
  v_unsigned int;
  v_complete boolean := false;
  v_art      uuid;
  v_proj     uuid;
  v_song     uuid;
BEGIN
  PERFORM public.labelos_split_check_payload(p_payload);
  IF p_method NOT IN ('upload', 'acknowledged') THEN
    RETURN jsonb_build_object('error', 'bad_method');
  END IF;
  IF p_method = 'acknowledged' AND (p_line IS NULL OR p_asset IS NOT NULL) THEN
    RETURN jsonb_build_object('error', 'bad_method');
  END IF;
  IF p_method = 'upload' AND p_asset IS NULL THEN
    RETURN jsonb_build_object('error', 'bad_asset');
  END IF;
  IF p_asset IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.project_assets a
    WHERE a.id = p_asset AND a.org_id = p_org AND a.kind = 'split_sheet' AND a.sensitivity = 'restricted'
  ) THEN
    RETURN jsonb_build_object('error', 'bad_asset');
  END IF;

  SELECT * INTO v_sheet FROM public.split_sheets s WHERE s.id = p_sheet AND s.org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_sheet.status <> 'circulated' THEN
    RETURN jsonb_build_object('error', 'not_circulated');
  END IF;

  IF p_line IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.split_lines l WHERE l.id = p_line AND l.split_sheet_id = p_sheet) THEN
      RETURN jsonb_build_object('error', 'no_line');
    END IF;
    IF EXISTS (SELECT 1 FROM public.split_lines l WHERE l.id = p_line AND l.signed_at IS NOT NULL) THEN
      RETURN jsonb_build_object('error', 'already_signed');
    END IF;
    UPDATE public.split_lines
    SET signed_at = now(), signature_method = p_method, signature_asset_id = p_asset, signed_by = p_actor
    WHERE id = p_line;
    v_signed := 1;
  ELSE
    UPDATE public.split_lines
    SET signed_at = now(), signature_method = p_method, signature_asset_id = p_asset, signed_by = p_actor
    WHERE split_sheet_id = p_sheet AND signed_at IS NULL;
    GET DIAGNOSTICS v_signed = ROW_COUNT;
    IF v_signed = 0 THEN
      RETURN jsonb_build_object('error', 'already_signed');
    END IF;
  END IF;

  SELECT COUNT(*) FILTER (WHERE l.signed_at IS NULL) INTO v_unsigned FROM public.split_lines l WHERE l.split_sheet_id = p_sheet;
  IF v_unsigned = 0 THEN
    v_complete := true;
    UPDATE public.split_sheets
    SET status = 'signed', signed_at = now(),
        document_asset_id = CASE WHEN p_line IS NULL THEN p_asset ELSE document_asset_id END
    WHERE id = p_sheet
    RETURNING * INTO v_sheet;
  ELSIF p_line IS NULL THEN
    UPDATE public.split_sheets SET document_asset_id = p_asset WHERE id = p_sheet RETURNING * INTO v_sheet;
  END IF;

  v_art  := NULLIF(p_subject->>'artist_id', '')::uuid;
  v_proj := NULLIF(p_subject->>'project_id', '')::uuid;
  v_song := NULLIF(p_subject->>'song_id', '')::uuid;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, song_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'split_sheet.signed', 'split_sheet', v_sheet.id, v_art, v_proj, v_song,
          p_payload || jsonb_build_object('complete', v_complete, 'lines', v_signed), true, 'internal');

  RETURN jsonb_build_object('sheet', to_jsonb(v_sheet), 'complete', v_complete, 'signed', v_signed);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_split_sign(uuid, uuid, uuid, uuid, text, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_split_sign(uuid, uuid, uuid, uuid, text, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_split_sign(uuid, uuid, uuid, uuid, text, uuid, jsonb, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
