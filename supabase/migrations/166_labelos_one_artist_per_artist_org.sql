-- 166_labelos_one_artist_per_artist_org.sql
-- Label OS (LABEL-44, review G2 D1): an artist-kind organization has at most
-- ONE artist contact, held by a unique index rather than by the routes alone.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 136–165. Never part of supabase/apply/pending.sql.
--
-- Why: D1 says an artist org's roster is the artist themselves (139 creates
-- that contact with the org). The contacts routes enforce it with
-- `artistOrgRosterError` (lib/labelos/roster.ts) — read the org's contacts,
-- then insert — so two requests at the same moment both pass the check and
-- the org ends up with two artists. A unique index is the only rule
-- Postgres enforces across concurrent transactions.
--
-- A partial index cannot look at another table, and "artist-kind org" lives
-- on `organizations`. So:
--   - contacts.org_self_artist boolean: true exactly for an artist contact
--     (category or secondary_category in the artist group,
--     `groupOfCategory`) of an artist-kind org. Kept by a BEFORE trigger
--     from the row and its org, never from what the writer sent, so no
--     caller can set or clear it. Producer contacts (org_id NULL) are always
--     false and cost no query.
--   - an org whose kind changes has its contacts' flags recomputed (no
--     route changes a kind; this keeps the flag true if SQL ever does).
--   - CREATE UNIQUE INDEX contacts_one_artist_per_artist_org ON contacts
--     (org_id) WHERE org_self_artist. The second artist is a 23505 naming
--     the index, which the routes answer as their own 409 (`ONE_ARTIST`).
--
-- Existing data: before building the index, the migration counts artist
-- orgs that already hold more than one artist contact. If there are any, it
-- RAISES naming them before any table is touched (only the helper function
-- above it exists by then). It never picks which artist to demote — that is the
-- owner's call: set the extra contacts' category to something else (or
-- delete them) and run it again. Today no route creates an artist org and
-- 139's backfill makes exactly one contact per artist org, so on every
-- database this has been run on the count is zero.
--
-- The `artist` group's categories are written once here, in
-- labelos_is_artist_category (trimmed of any whitespace and lower-cased, as
-- groupOfCategory does), and src/lib/labelos/roster.test.ts holds them
-- equal to lib/contacts/roles.ts#ARTIST_GROUP_CATEGORIES.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, IF NOT EXISTS.

CREATE OR REPLACE FUNCTION public.labelos_is_artist_category(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(lower(regexp_replace(p, '^\s+|\s+$', '', 'g')) = ANY (ARRAY['artist', 'rapper', 'singer', 'songwriter', 'topliner']), false)
$$;

ALTER FUNCTION public.labelos_is_artist_category(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_is_artist_category(text) FROM PUBLIC;

-- Refuse first, on data as it stands: nothing below runs if an artist org
-- already breaks the rule.
DO $$
DECLARE
  v_orgs text;
BEGIN
  SELECT string_agg(org_id::text, ', ' ORDER BY org_id) INTO v_orgs
  FROM (
    SELECT c.org_id
    FROM public.contacts c
    JOIN public.organizations o ON o.id = c.org_id AND o.kind = 'artist'
    WHERE public.labelos_is_artist_category(c.category) OR public.labelos_is_artist_category(c.secondary_category)
    GROUP BY c.org_id
    HAVING count(*) > 1
  ) dup;
  IF v_orgs IS NOT NULL THEN
    RAISE EXCEPTION 'migration 166: these artist organizations have more than one artist contact: %. Give the extra contacts another role (or delete them), then run 166 again.', v_orgs
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS org_self_artist boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.contacts_org_self_artist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    NEW.org_self_artist := false;
  ELSE
    NEW.org_self_artist := (public.labelos_is_artist_category(NEW.category) OR public.labelos_is_artist_category(NEW.secondary_category))
      AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = NEW.org_id AND o.kind = 'artist');
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION public.contacts_org_self_artist() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contacts_org_self_artist() FROM PUBLIC;

DROP TRIGGER IF EXISTS contacts_org_self_artist ON public.contacts;
CREATE TRIGGER contacts_org_self_artist
  BEFORE INSERT OR UPDATE OF org_id, category, secondary_category, org_self_artist ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_org_self_artist();

-- An org's kind changing recomputes its contacts (the trigger above does the
-- work: setting the column fires it, and it ignores the value written).
CREATE OR REPLACE FUNCTION public.organizations_kind_self_artist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.contacts SET org_self_artist = false WHERE org_id = NEW.id;
  RETURN NULL;
END $$;

ALTER FUNCTION public.organizations_kind_self_artist() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.organizations_kind_self_artist() FROM PUBLIC;

DROP TRIGGER IF EXISTS organizations_kind_self_artist ON public.organizations;
CREATE TRIGGER organizations_kind_self_artist
  AFTER UPDATE OF kind ON public.organizations
  FOR EACH ROW WHEN (OLD.kind IS DISTINCT FROM NEW.kind)
  EXECUTE FUNCTION public.organizations_kind_self_artist();

-- Backfill the flag on existing org contacts (the trigger computes it).
UPDATE public.contacts SET org_self_artist = false WHERE org_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_one_artist_per_artist_org
  ON public.contacts (org_id)
  WHERE org_self_artist;

NOTIFY pgrst, 'reload schema';
