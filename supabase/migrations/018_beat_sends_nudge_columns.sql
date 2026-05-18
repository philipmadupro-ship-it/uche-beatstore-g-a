-- 018_beat_sends_nudge_columns.sql
--
-- Add nudge bookkeeping columns to beat_sends so the time-decay
-- cron (/api/cron/nudge-stale) can fire follow-ups at the 3/5/10
-- day milestones without spamming the recipient.
--
-- Same shape as the columns already on campaign_targets — when a
-- send is attached to a campaign the two will be kept in sync by
-- application code.
--
--   nudge_count   — how many auto-followups have already fired.
--                   0 = no followups yet. Caps at 3 (matches the
--                   number of milestones in the cron). After 3
--                   the cron stops touching the row.
--   last_nudge_at — timestamp of the most recent auto-followup,
--                   used for debugging and the contact-row "last
--                   nudged Nm ago" hint in the CRM UI.

ALTER TABLE beat_sends
  ADD COLUMN IF NOT EXISTS nudge_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_nudge_at timestamptz;

-- Partial index over the rows the cron actually inspects (status=sent
-- and not yet fully nudged). Keeps the cron's scan cheap even when
-- the global beat_sends table grows past the "useful index" point.
CREATE INDEX IF NOT EXISTS beat_sends_pending_nudge_idx
  ON beat_sends (sent_at)
  WHERE status = 'sent' AND nudge_count < 3;
