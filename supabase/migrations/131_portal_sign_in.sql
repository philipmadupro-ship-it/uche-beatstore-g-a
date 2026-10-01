-- 131_portal_sign_in.sql
-- Artist Relationship Workspace, phase 3: optional email sign-in for a portal.
--
-- A portal link is a bearer credential: anyone the artist forwards it to gets
-- in. The producer can now require the artist to confirm their email first.
-- The portal then emails a short-lived sign-in link to the address ON THE
-- CONTACT (the visitor never types one, so it cannot be pointed elsewhere),
-- and opening it leaves a signed cookie for that browser
-- (lib/artist-portal/sign-in). No Supabase auth user is created: artists are
-- not buyers and not producers.
--
-- sign_in_sent_at throttles the email (one a minute per portal).

ALTER TABLE public.artist_portals
  ADD COLUMN IF NOT EXISTS require_sign_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sign_in_sent_at timestamptz;

NOTIFY pgrst, 'reload schema';
