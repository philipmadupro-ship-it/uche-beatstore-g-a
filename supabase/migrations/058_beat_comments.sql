-- 058_beat_comments.sql
--
-- Public timestamped comments on individual store-listed beats.
-- SoundCloud-style: a fan can drop a comment pinned to a specific
-- moment in the track (e.g. "0:42 is fire"). The producer moderates
-- (delete / pin / hide) from the dashboard.
--
-- Identity model: lightweight. We don't have buyer accounts yet, so
-- each comment carries the author's display name + optional email
-- (used for moderation notifications, never shown publicly). IP hash
-- is stored for rate-limiting + abuse triage; not for tracking.
--
-- Visibility: by default visible to everyone. Producer can flip
-- is_hidden=true to soft-delete without losing the row.

CREATE TABLE IF NOT EXISTS public.beat_comments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id      uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  -- Denormalised owner so the producer dashboard can scope without
  -- joining through tracks for every read.
  seller_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name   text NOT NULL CHECK (char_length(author_name) BETWEEN 1 AND 60),
  author_email  text,
  -- 0..duration seconds — clamp client-side, also enforce here.
  timestamp_seconds numeric(8, 2) NOT NULL DEFAULT 0 CHECK (timestamp_seconds >= 0),
  body          text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  is_pinned     boolean NOT NULL DEFAULT false,
  is_hidden     boolean NOT NULL DEFAULT false,
  ip_hash       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_beat_comments_track ON public.beat_comments (track_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_beat_comments_seller ON public.beat_comments (seller_user_id, created_at DESC);

ALTER TABLE public.beat_comments ENABLE ROW LEVEL SECURITY;

-- Public read of non-hidden comments
DROP POLICY IF EXISTS beat_comments_public_read ON public.beat_comments;
CREATE POLICY beat_comments_public_read ON public.beat_comments
  FOR SELECT
  USING (is_hidden = false);

-- Owner can read everything (including hidden)
DROP POLICY IF EXISTS beat_comments_owner_read ON public.beat_comments;
CREATE POLICY beat_comments_owner_read ON public.beat_comments
  FOR SELECT
  USING (seller_user_id = auth.uid());

-- Owner can update + delete
DROP POLICY IF EXISTS beat_comments_owner_update ON public.beat_comments;
CREATE POLICY beat_comments_owner_update ON public.beat_comments
  FOR UPDATE
  USING (seller_user_id = auth.uid());
DROP POLICY IF EXISTS beat_comments_owner_delete ON public.beat_comments;
CREATE POLICY beat_comments_owner_delete ON public.beat_comments
  FOR DELETE
  USING (seller_user_id = auth.uid());

-- INSERT is gated at the API layer (rate-limited by ip_hash); we don't
-- expose it via RLS so anon can only write through our service-role
-- route.

NOTIFY pgrst, 'reload schema';
