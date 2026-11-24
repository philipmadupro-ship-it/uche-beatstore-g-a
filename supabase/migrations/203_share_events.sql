-- 203_share_events.sql
-- SHARE-06: one append-only log of what happens on a share link, so /links can
-- say "N people opened it, X plays, Y downloads" instead of one counter.
--
-- NOT APPLIED. Numbered 203 because 202 belongs to another task.
--
-- Until now: `share_links.plays` / `project_shares.plays` count page OPENS (all
-- time, every refresh), `share_plays` holds one row per share_links open plus
-- per-track plays, and share-link DOWNLOADS were recorded nowhere. This table
-- adds the missing pieces for both share tables; the old counters stay as they
-- are and are not backfilled.
--
-- Shape:
--   share_source  'share_links' | 'project_shares'
--   share_id      the share ROW id, never its token (the token is a bearer
--                 credential for the audio). No foreign key: the id is
--                 polymorphic, and events outlive a deleted link until the
--                 owner's account goes.
--   owner_user_id REFERENCES auth.users ON DELETE CASCADE. Erasing the
--                 producer erases their events (the trigger below lets that
--                 cascade through, and nothing else).
--   kind          open | play | download | download_all
--   track_id      the track a play/download was for. No foreign key on purpose:
--                 ON DELETE SET NULL would be an UPDATE, which this table
--                 refuses.
--   ip_hash       the SAME salted hash store_events carries (lib/security/ip-hash).
--
-- Access: the producer reads their own rows (RLS). Nobody can write through the
-- API roles; the server writes with the service role, INSERT only. Rows are
-- never updated or deleted (trigger), except by the account-deletion cascade.
-- TRUNCATE is not covered (no route can issue it), as for activity_events.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.share_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_source   text NOT NULL CHECK (share_source IN ('share_links', 'project_shares')),
  share_id       uuid NOT NULL,
  owner_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('open', 'play', 'download', 'download_all')),
  track_id       uuid,
  ip_hash        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One index serves both reads: the producer's per-link aggregate (owner, share,
-- newest first) and the 30-minute open dedupe, whose ip_hash and kind filters
-- are answered from the INCLUDEd columns without touching the heap.
CREATE INDEX IF NOT EXISTS idx_share_events_owner_share_created
  ON public.share_events (owner_user_id, share_id, created_at DESC)
  INCLUDE (ip_hash, kind);

ALTER TABLE public.share_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'share_events' AND policyname = 'Owner reads share events'
  ) THEN
    CREATE POLICY "Owner reads share events"
      ON public.share_events FOR SELECT
      USING (owner_user_id = auth.uid());
  END IF;
END $$;

-- No API role may write: only the server (service_role), and only INSERT.
REVOKE ALL ON public.share_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.share_events TO authenticated;
GRANT SELECT, INSERT ON public.share_events TO service_role;

-- Append-only for every role. The one exception is the cascade from deleting
-- the owner's account: by the time it reaches a row, the auth.users row is
-- gone, which a direct DELETE can never see (the foreign key holds while it
-- exists) — the same test 163 uses for the organization purge.
CREATE OR REPLACE FUNCTION public.share_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.owner_user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'share_events is append-only (% refused)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS share_events_append_only ON public.share_events;
CREATE TRIGGER share_events_append_only
  BEFORE UPDATE OR DELETE ON public.share_events
  FOR EACH ROW EXECUTE FUNCTION public.share_events_append_only();

NOTIFY pgrst, 'reload schema';
