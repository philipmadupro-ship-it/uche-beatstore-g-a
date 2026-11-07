-- 186_labelos_listing_consent.sql
-- Label OS (LABEL-71): the artist has the final say on the store (doc 21 §5.1 A/E, doc 22 §5).
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main. Never part of supabase/apply/pending.sql. Depends only on the
-- tables of 136–154 (organizations, contacts, releases, org_connections).
--
-- 1. `listing_consents` — one row per (release, credited artist contact). The
--    label lists a release; every credited artist is asked; the row is
--      proposed   asked, not answered (the release may still serve)
--      yes        agreed
--      no         refused — final: the release comes off the store in the
--                 same step and cannot be listed again until THIS artist
--                 says yes. Any one artist's no withdraws it.
--    `decided_at` is set exactly when the state is not `proposed`. The row
--    never goes back to `proposed`; the release, the org and the artist never
--    change. The contact FK has no cascade (NO ACTION, like
--    `releases.contact_id`, so the org's own purge still cascades through):
--    erasing an artist must not erase their no and so re-open the listing.
--
-- 2. `store_listing_vetoes` — the store owner's own control over music of
--    connected artists on THEIR store ("Releases from connected artists" →
--    Unlist). It lives in the LABEL org's rows (`org_id` = the label that
--    owns the store), because a label never writes to an artist org (154):
--    the public store reads it next to `store_listed`, and the row is the
--    whole veto. Only a label with an ACTIVE connection to the release's org
--    can hold one (trigger).
--
-- 3. NO ACCESS for the API roles on either table — both are read and written
--    by the service role through /api/org (an artist reads only their own
--    consents, the lister the summary; PostgREST would hand a member the
--    rows whole). RLS is on with ONE policy that says no (`USING (false)`),
--    the API roles' privileges are revoked, and 141's service-only trigger
--    says the same: three independent layers, no per-row SECURITY DEFINER
--    call in any policy (R-08).
--
-- Idempotent. Rollback: supabase/rollback/186_labelos_listing_consent.down.sql.

CREATE TABLE IF NOT EXISTS public.listing_consents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  release_id        uuid NOT NULL REFERENCES public.releases(id) ON DELETE CASCADE,
  artist_contact_id uuid NOT NULL REFERENCES public.contacts(id),
  state             text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'yes', 'no')),
  proposed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  proposed_at       timestamptz NOT NULL DEFAULT now(),
  decided_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_consents_decided_shape CHECK ((state = 'proposed') = (decided_at IS NULL)),
  CONSTRAINT listing_consents_one_per_artist UNIQUE (release_id, artist_contact_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_consents_org ON public.listing_consents (org_id, release_id);
CREATE INDEX IF NOT EXISTS idx_listing_consents_artist ON public.listing_consents (org_id, artist_contact_id);
-- The public store asks "does this release have a no?" on every request.
CREATE INDEX IF NOT EXISTS idx_listing_consents_no ON public.listing_consents (release_id) WHERE state = 'no';

ALTER TABLE public.listing_consents ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.labelos_listing_consents_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.releases r WHERE r.id = NEW.release_id AND r.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'listing_consents: the release belongs to another organization'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.artist_contact_id AND c.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'listing_consents: the artist belongs to another organization'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_id <> OLD.org_id OR NEW.release_id <> OLD.release_id OR NEW.artist_contact_id <> OLD.artist_contact_id THEN
      RAISE EXCEPTION 'listing_consents: the organization, release and artist of a consent never change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.state <> 'proposed' AND NEW.state = 'proposed' THEN
      RAISE EXCEPTION 'listing_consents: an answered consent does not go back to asked'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS listing_consents_guard ON public.listing_consents;
CREATE TRIGGER listing_consents_guard BEFORE INSERT OR UPDATE ON public.listing_consents
  FOR EACH ROW EXECUTE FUNCTION public.labelos_listing_consents_guard();

-- Writes are the service role's (141): the API roles can neither forge nor edit an answer.
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.listing_consents;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.listing_consents
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');

DROP POLICY IF EXISTS listing_consents_no_direct_access ON public.listing_consents;
CREATE POLICY listing_consents_no_direct_access ON public.listing_consents
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

REVOKE ALL ON public.listing_consents FROM anon, authenticated;

-- ── The store owner's veto ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.store_listing_vetoes (
  release_id uuid PRIMARY KEY REFERENCES public.releases(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vetoed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  vetoed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_listing_vetoes_org ON public.store_listing_vetoes (org_id);

ALTER TABLE public.store_listing_vetoes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.labelos_store_listing_vetoes_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.release_id <> OLD.release_id OR NEW.org_id <> OLD.org_id) THEN
    RAISE EXCEPTION 'store_listing_vetoes: the release and the organization of a veto never change'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Only a label with an active connection to the release's organization has a say on its store.
  IF NOT EXISTS (
    SELECT 1
    FROM public.releases r
    JOIN public.org_connections oc ON oc.artist_org_id = r.org_id
    WHERE r.id = NEW.release_id
      AND oc.label_org_id = NEW.org_id
      AND oc.status = 'active'
  ) THEN
    RAISE EXCEPTION 'store_listing_vetoes: the organization has no active connection to the release''s organization'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS store_listing_vetoes_guard ON public.store_listing_vetoes;
CREATE TRIGGER store_listing_vetoes_guard BEFORE INSERT OR UPDATE ON public.store_listing_vetoes
  FOR EACH ROW EXECUTE FUNCTION public.labelos_store_listing_vetoes_guard();

DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.store_listing_vetoes;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.store_listing_vetoes
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');

DROP POLICY IF EXISTS store_listing_vetoes_no_direct_access ON public.store_listing_vetoes;
CREATE POLICY store_listing_vetoes_no_direct_access ON public.store_listing_vetoes
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

REVOKE ALL ON public.store_listing_vetoes FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
