-- 125_artist_portals.sql
-- Artist Relationship Workspace, phase 1: one permanent private portal per
-- artist.
--
-- The portal is the link between the producer and one artist: a small library
-- of the projects linked to that contact with project_contacts.in_portal set.
-- Adding a beat to a portal project shows up on the artist's next visit; the
-- link never changes, so follow-ups stop being new links.
--
-- One row per contact (UNIQUE contact_id). Revoking sets revoked_at (pages
-- return 410); reissuing rotates `token` on the same row, so the old link dies
-- and history stays attached to the contact.
-- previous_viewed_at is the "NEW since your last visit" watermark: a visit
-- moves last_viewed_at into it before stamping a new last_viewed_at.
--
-- The token is a bearer credential, like every share token. Portal routes are
-- allowlisted in lib/security/api-gate.ts and gate on it server-side.

CREATE TABLE IF NOT EXISTS public.artist_portals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id         uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  token              text NOT NULL,
  password_hash      text,
  revoked_at         timestamptz,
  last_viewed_at     timestamptz,
  previous_viewed_at timestamptz,
  view_count         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artist_portals_contact_key UNIQUE (contact_id),
  CONSTRAINT artist_portals_token_key UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_artist_portals_user ON public.artist_portals (user_id);

CREATE OR REPLACE FUNCTION public.artist_portals_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'artist_portals: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS artist_portals_same_owner ON public.artist_portals;
CREATE TRIGGER artist_portals_same_owner
  BEFORE INSERT OR UPDATE OF user_id, contact_id ON public.artist_portals
  FOR EACH ROW EXECUTE FUNCTION public.artist_portals_same_owner();

-- Owner-only. There is deliberately NO anon policy: the portal is read by
-- token through the service role, after the route checks the token, so the
-- table is never listable through PostgREST by a guest.
ALTER TABLE public.artist_portals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS artist_portals_owner_select ON public.artist_portals;
CREATE POLICY artist_portals_owner_select ON public.artist_portals
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS artist_portals_owner_write ON public.artist_portals;
CREATE POLICY artist_portals_owner_write ON public.artist_portals
  FOR ALL USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.is_producer()));

NOTIFY pgrst, 'reload schema';
