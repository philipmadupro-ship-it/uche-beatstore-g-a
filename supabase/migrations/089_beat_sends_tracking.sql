-- 089_beat_sends_tracking.sql
-- Email-level tracking for beat sends. Enables "did they open it?" once the
-- Resend webhook is connected. Until then, the UI renders a "pending" indicator
-- and the producer can manually advance the status (existing pattern).
--
-- email_resend_id: Resend message id returned on send — used to correlate
--   webhook events (email.opened, email.link.clicked) to a beat_send row.
-- opened_at: Set by the Resend webhook handler on first open event.
-- link_clicked_at: Set on first share-link click event from Resend.

ALTER TABLE public.beat_sends
  ADD COLUMN IF NOT EXISTS email_resend_id text,
  ADD COLUMN IF NOT EXISTS opened_at       timestamptz,
  ADD COLUMN IF NOT EXISTS link_clicked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_beat_sends_resend_id
  ON public.beat_sends (email_resend_id)
  WHERE email_resend_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
