-- 139_labelos_org_contacts.sql
-- Label OS (LABEL-10): org-scoped contacts as the artist roster, plus
-- artist scopes for members.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 136–138 (docs/bstudio-label-os/16-execution-runbook.md).
--
-- 17-reconciliation R3: an artist is a contact in workspace mode, so the
-- roster is an org's contacts — no `artists` table. Q2 (answered yes,
-- 2026-10-02): a label org keeps its OWN contacts directory and sees nothing
-- of the producer's CRM.
--
-- Expand only:
--   - contacts.org_id (nullable FK, indexed). The producer's rows keep
--     org_id IS NULL (M7, org-scoping them, is out of scope);
--   - contacts_org_or_owner: an org contact never has a user_id, so it can
--     never match a producer route's `user_id = <producer>` filter or the
--     producer's owner_only policy. M7 drops this when it backfills;
--   - an org contact's org never changes (scope rows and events point at it);
--   - member_artist_scopes(org_id, user_id, contact_id) + a same-org trigger;
--   - can_see_artist(org, contact), the SQL twin of artistScopeAllows in
--     src/lib/auth/org-access.ts;
--   - ONE additive SELECT policy on contacts, org_member_read.
--   - labelos_accept_invitation (138) also writes the invitation's artist
--     list into member_artist_scopes, in the same transaction; members who
--     joined before this migration are backfilled.
--   - an artist-kind org gets its single roster contact when it is created
--     (D1, R3).
--
-- R-04: contacts' existing policy (owner_only, 097) is NOT touched. Postgres
-- OR-combines permissive policies, so org_member_read must never admit a
-- row the producer or a buyer could not already see: it requires
-- `org_id IS NOT NULL` (producer rows are NULL), membership with
-- catalog.read in THAT org, and the artist scope. Proven as anon /
-- authenticated users in supabase/local/checks/139_labelos_org_contacts.sql
-- and held by src/lib/security/rls-final-state.test.ts.
--
-- Writes stay on the service role (/api/org/[orgId]/contacts): there is no
-- org write policy on contacts and none at all on member_artist_scopes.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS first.

-- ── contacts.org_id ─────────────────────────────────────────────────────

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_contacts_org
  ON public.contacts (org_id)
  WHERE org_id IS NOT NULL;

-- One person once per org directory, matched as lib/contacts/email.ts
-- normalises (the routes store emails normalised). The producer's own
-- uniqueness is 096's (user_id, email); org rows have no user_id.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_email_uniq
  ON public.contacts (org_id, email)
  WHERE org_id IS NOT NULL AND email IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_org_or_owner' AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_org_or_owner CHECK (org_id IS NULL OR user_id IS NULL);
  END IF;
END $$;

-- An org contact stays in its org. Producer rows (OLD.org_id IS NULL) are
-- not affected by this trigger at all.
CREATE OR REPLACE FUNCTION public.contacts_org_is_fixed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.org_id IS NOT NULL AND NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'an organization contact cannot move to another organization'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.contacts_org_is_fixed() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contacts_org_is_fixed() FROM PUBLIC;

DROP TRIGGER IF EXISTS contacts_org_is_fixed ON public.contacts;
CREATE TRIGGER contacts_org_is_fixed
  BEFORE UPDATE OF org_id ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_org_is_fixed();

-- ── member_artist_scopes ────────────────────────────────────────────────
-- 06 §2.5: a member with scope `artists` (always, for role `artist`) sees
-- only the roster contacts listed here. A row goes when the membership or
-- the contact does. An artists-scoped member with no rows sees nothing.
--
-- No FK of its own to organizations: the composite FK to org_members
-- already ties the row to its org (and cascades when the org goes, through
-- org_members). A second FK would make this table a junction between
-- org_members and organizations in PostgREST's eyes, and every
-- `org_members → organizations!inner(…)` embed (org-access readMembership)
-- would fail as ambiguous. 139's local check asserts it stays that way.

CREATE TABLE IF NOT EXISTS public.member_artist_scopes (
  org_id     uuid NOT NULL,
  user_id    uuid NOT NULL,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, contact_id),
  FOREIGN KEY (org_id, user_id) REFERENCES public.org_members (org_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_member_artist_scopes_contact
  ON public.member_artist_scopes (contact_id);

-- Same org: the contact must be in the org the scope row names. Refuses a
-- producer contact (org_id IS NULL) and another org's contact alike.
CREATE OR REPLACE FUNCTION public.member_artist_scopes_same_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = NEW.contact_id AND c.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'artist scope contact % is not a contact of organization %', NEW.contact_id, NEW.org_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.member_artist_scopes_same_org() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.member_artist_scopes_same_org() FROM PUBLIC;

DROP TRIGGER IF EXISTS member_artist_scopes_same_org ON public.member_artist_scopes;
CREATE TRIGGER member_artist_scopes_same_org
  BEFORE INSERT OR UPDATE ON public.member_artist_scopes
  FOR EACH ROW EXECUTE FUNCTION public.member_artist_scopes_same_org();

-- ── can_see_artist(org, contact) ────────────────────────────────────────
-- Is this roster contact inside the caller's artist scope in this org?
-- False for a non-member, a soft-deleted org, a contact of another org or
-- a producer contact. A member with scope `org` (never role `artist`, which
-- is always scoped) sees every contact of the org; anyone else only those
-- in member_artist_scopes. Capabilities are has_org_cap's job, not this.
-- SECURITY DEFINER as postgres, so the contacts lookup inside contacts'
-- own policy does not recurse into contacts' RLS.

CREATE OR REPLACE FUNCTION public.can_see_artist(p_org uuid, p_contact uuid)
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
    JOIN public.contacts c ON c.id = p_contact AND c.org_id = om.org_id
    WHERE om.org_id = p_org
      AND om.user_id = auth.uid()
      AND o.deleted_at IS NULL
      AND (
        (om.scope = 'org' AND om.role <> 'artist')
        OR EXISTS (
          SELECT 1 FROM public.member_artist_scopes s
          WHERE s.org_id = om.org_id
            AND s.user_id = om.user_id
            AND s.contact_id = p_contact
        )
      )
  );
$$;

ALTER FUNCTION public.can_see_artist(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_see_artist(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_see_artist(uuid, uuid) TO authenticated, anon;

-- ── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.member_artist_scopes ENABLE ROW LEVEL SECURITY;

-- A member reads their own scope; whoever manages members reads everyone's.
DROP POLICY IF EXISTS member_artist_scopes_read ON public.member_artist_scopes;
CREATE POLICY member_artist_scopes_read ON public.member_artist_scopes
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.has_org_cap(org_id, 'members.manage'))
    OR (user_id = (SELECT auth.uid()) AND (SELECT public.org_role(org_id)) IS NOT NULL)
  );

-- Scope is changed only by the service-role members route (members.manage)
-- and the accept function. A member who could write here could widen
-- their own scope.
REVOKE INSERT, UPDATE, DELETE ON public.member_artist_scopes FROM anon, authenticated;

-- The additive contacts policy. owner_only (097) is untouched; producer
-- rows are org_id IS NULL and so never match this one.
DROP POLICY IF EXISTS org_member_read ON public.contacts;
CREATE POLICY org_member_read ON public.contacts
  FOR SELECT
  TO authenticated
  USING (
    org_id IS NOT NULL
    AND (SELECT public.has_org_cap(org_id, 'catalog.read'))
    AND (SELECT public.can_see_artist(org_id, id))
  );

-- ── labelos_accept_invitation (138, extended) ───────────────────────────
-- Identical to 138 except step 4: a membership limited to named artists
-- now gets one member_artist_scopes row per invitation contact that is
-- still a contact of the org (a contact deleted since the invitation is
-- skipped, never an error), in the same transaction as the membership. The
-- audit event's contact_ids are the rows actually written.

CREATE OR REPLACE FUNCTION public.labelos_accept_invitation(p_token_hash text, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_email     text;
  v_confirmed timestamptz;
  v_inv       public.org_invitations%ROWTYPE;
  v_rows      int;
  v_scope     text;
  v_scoped    uuid[] := '{}';
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_user IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  SELECT lower(btrim(u.email)), u.email_confirmed_at INTO v_email, v_confirmed
  FROM auth.users u WHERE u.id = p_user;
  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('error', 'email_mismatch');
  END IF;

  SELECT i.* INTO v_inv
  FROM public.org_invitations i
  JOIN public.organizations o ON o.id = i.org_id
  WHERE i.token_hash = p_token_hash
    AND o.deleted_at IS NULL
  FOR UPDATE OF i;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF v_inv.email <> v_email THEN
    RETURN jsonb_build_object('error', 'email_mismatch');
  END IF;
  IF v_confirmed IS NULL THEN
    RETURN jsonb_build_object('error', 'email_unverified');
  END IF;
  IF v_inv.project_id IS NOT NULL OR v_inv.role = 'owner' THEN
    RETURN jsonb_build_object('error', 'unsupported');
  END IF;
  IF v_inv.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'revoked');
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.org_members WHERE org_id = v_inv.org_id AND user_id = p_user) THEN
      RETURN jsonb_build_object('status', 'already_member', 'org_id', v_inv.org_id);
    END IF;
    RETURN jsonb_build_object('error', 'used');
  END IF;
  IF v_inv.expires_at <= now() THEN
    RETURN jsonb_build_object('error', 'expired');
  END IF;
  IF v_inv.invited_by IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = v_inv.org_id AND m.user_id = v_inv.invited_by AND m.role IN ('owner', 'admin')
  ) THEN
    RETURN jsonb_build_object('error', 'revoked');
  END IF;

  v_scope := CASE WHEN v_inv.role = 'artist' OR cardinality(v_inv.artist_ids) > 0 THEN 'artists' ELSE 'org' END;

  INSERT INTO public.org_members (org_id, user_id, role, functions, scope, invited_by)
  VALUES (
    v_inv.org_id,
    p_user,
    v_inv.role,
    CASE WHEN v_inv.role = 'member' THEN v_inv.functions ELSE '{}'::text[] END,
    v_scope,
    v_inv.invited_by
  )
  ON CONFLICT (org_id, user_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  UPDATE public.org_invitations SET accepted_at = now() WHERE id = v_inv.id;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object('status', 'already_member', 'org_id', v_inv.org_id);
  END IF;

  -- LABEL-10: the artist list becomes the member's scope. `artist_ids` holds
  -- roster CONTACT ids (17 R3); the column keeps 136's name. Only contacts
  -- still in this org; the same-org trigger would refuse anything else.
  IF v_scope = 'artists' AND cardinality(v_inv.artist_ids) > 0 THEN
    WITH written AS (
      INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id)
      SELECT v_inv.org_id, p_user, c.id
      FROM public.contacts c
      WHERE c.id = ANY (v_inv.artist_ids)
        AND c.org_id = v_inv.org_id
      ON CONFLICT DO NOTHING
      RETURNING contact_id
    )
    SELECT coalesce(array_agg(contact_id ORDER BY contact_id), '{}') INTO v_scoped FROM written;
  END IF;

  -- 06 §6: membership changes are audit events. Same transaction as the
  -- membership, so one never exists without the other.
  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, payload, audit, visibility)
  VALUES (
    v_inv.org_id,
    p_user,
    'member.joined',
    'member',
    p_user,
    jsonb_build_object(
      'invitation_id', v_inv.id,
      'role', v_inv.role,
      'functions', to_jsonb(CASE WHEN v_inv.role = 'member' THEN v_inv.functions ELSE '{}'::text[] END),
      'contact_ids', to_jsonb(v_scoped),
      'invited_by', v_inv.invited_by
    ),
    true,
    'internal'
  );

  RETURN jsonb_build_object('status', 'joined', 'org_id', v_inv.org_id);
END;
$fn$;

ALTER FUNCTION public.labelos_accept_invitation(text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_accept_invitation(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.labelos_accept_invitation(text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_accept_invitation(text, uuid) TO service_role;

-- ── Backfill (LABEL-08 carried note) ────────────────────────────────────
-- Members who accepted an artist-limited invitation before this migration:
-- their member.joined event names the invitation, whose artist_ids become
-- scope rows — only contacts of that org, only for memberships that are
-- still artist-scoped. contacts.org_id is new in this file, so on a first
-- apply no contact qualifies yet; the statement is here so the rule is
-- written once and a replay stays a no-op (ON CONFLICT DO NOTHING).

INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id)
SELECT DISTINCT m.org_id, m.user_id, c.id
FROM public.activity_events e
JOIN public.org_invitations i
  ON i.org_id = e.org_id
 AND i.id::text = e.payload ->> 'invitation_id'
JOIN public.org_members m
  ON m.org_id = e.org_id
 AND m.user_id = e.subject_id
 AND m.scope = 'artists'
JOIN public.contacts c
  ON c.id = ANY (i.artist_ids)
 AND c.org_id = e.org_id
WHERE e.verb = 'member.joined'
  AND e.subject_type = 'member'
ON CONFLICT DO NOTHING;

-- ── Artist orgs: one roster contact, created with the org (D1, R3) ──────
-- An artist org's roster is the artist themselves. The contact is named
-- after the org (the org IS the artist) and carries the creator's email.
-- No user_id: it is an org contact (contacts_org_or_owner).

CREATE OR REPLACE FUNCTION public.labelos_artist_org_self_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  IF NEW.kind <> 'artist' THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.contacts WHERE org_id = NEW.id) THEN
    RETURN NULL;
  END IF;
  SELECT nullif(lower(btrim(u.email)), '') INTO v_email
  FROM auth.users u WHERE u.id = NEW.created_by;
  INSERT INTO public.contacts (org_id, user_id, name, email, category)
  VALUES (NEW.id, NULL, NEW.name, v_email, 'artist');
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.labelos_artist_org_self_contact() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_artist_org_self_contact() FROM PUBLIC;

DROP TRIGGER IF EXISTS labelos_artist_org_self_contact ON public.organizations;
CREATE TRIGGER labelos_artist_org_self_contact
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.labelos_artist_org_self_contact();

-- Artist orgs created before this migration (none are created by any route
-- yet; this keeps the rule true for any made by hand).
INSERT INTO public.contacts (org_id, user_id, name, email, category)
SELECT o.id, NULL, o.name, nullif(lower(btrim(u.email)), ''), 'artist'
FROM public.organizations o
LEFT JOIN auth.users u ON u.id = o.created_by
WHERE o.kind = 'artist'
  AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.org_id = o.id);

NOTIFY pgrst, 'reload schema';
