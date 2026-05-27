-- 060_buyer_profiles.sql
--
-- Real buyer-side persistence. Until now buyers were anonymous-ish:
-- the magic-link token in /store/account/[token] just looks up
-- purchases by email. This migration adds three small tables so a
-- magic-linked buyer also gets:
--
--   1. Listening history       — every play they make on /store gets
--                                logged (last 100 retained per buyer
--                                via the read-time LIMIT, not a cron).
--   2. Persistent favourites   — the existing localStorage wishlist
--                                gets a DB shadow so changing devices
--                                doesn't lose hearts.
--   3. Custom playlists        — buyer-owned playlists of tracks they
--                                like (free + previewable + licensed),
--                                playable from the persistent player.
--
-- The buyer's email is the identity. No password — auth is the magic
-- link in /store/account/[token]. Mutations go through API routes
-- that verify the buyer token first (lib/buyer-tokens.ts), so RLS is
-- "no public access" + service-role writes from the API layer.

CREATE TABLE IF NOT EXISTS public.buyer_listening_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL,
  track_id   uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  played_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_buyer_history_email_played
  ON public.buyer_listening_history (email, played_at DESC);

CREATE TABLE IF NOT EXISTS public.buyer_favorites (
  email      text NOT NULL,
  track_id   uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, track_id)
);
CREATE INDEX IF NOT EXISTS idx_buyer_favorites_email
  ON public.buyer_favorites (email, created_at DESC);

CREATE TABLE IF NOT EXISTS public.buyer_playlists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_buyer_playlists_email
  ON public.buyer_playlists (email, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.buyer_playlist_tracks (
  playlist_id uuid NOT NULL REFERENCES public.buyer_playlists(id) ON DELETE CASCADE,
  track_id    uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, track_id)
);

ALTER TABLE public.buyer_listening_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buyer_favorites          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buyer_playlists          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buyer_playlist_tracks    ENABLE ROW LEVEL SECURITY;

-- Public PostgREST surface = nothing. All access is through service-
-- role API routes which verify the magic-link token first.

NOTIFY pgrst, 'reload schema';
