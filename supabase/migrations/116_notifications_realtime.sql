-- Enable Supabase Realtime for `notifications`.
--
-- `TopBar` has always subscribed to this table:
--
--     useRealtimeTable({ table: 'notifications', onChange: fetchNotifs });
--
-- but the table was never added to the `supabase_realtime` publication, so
-- Postgres never broadcast its row changes and that subscription has been
-- silently inert since migration 064 created the table. The bell only ever
-- updated on the 60-second poll beside it, which is why a sale could sit
-- unseen for up to a minute — and why the OS notification for it was late by
-- the same amount.
--
-- It degraded quietly rather than breaking, which is how it went unnoticed:
-- the poll is a deliberate fallback and `lib/notifications/desktop.ts` fires
-- from whatever the poll returns, so everything still arrived, just slowly.
--
-- Numbered 116, not 115: `115_track_collaborators.sql` already exists on
-- branch `claude/code-review-agent-integration-cdf964`. Two branches claiming
-- one number is the collision CLAUDE.md warns about and that already forced a
-- 040/041 -> 046/047 renumber once.
--
-- REPLICA IDENTITY FULL, matching 012: without it a DELETE broadcasts only the
-- primary key. Nothing deletes notifications today, but a partial payload is a
-- trap to leave lying around for whoever adds that.
--
-- Idempotent — re-running adds the table only if it is not already a member.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;

ALTER TABLE public.notifications REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
