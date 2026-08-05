-- 064_notifications.sql
-- Per-user notification inbox for purchase, refund, dispute, and other
-- producer-facing events. Rows are inserted server-side (service role)
-- from the Stripe webhook and other API handlers.
CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       text        NOT NULL, -- 'purchase' | 'refund' | 'dispute' | 'stems_request' | 'share_viewed'
  title      text        NOT NULL,
  body       text,
  data       jsonb,
  read       boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner" ON public.notifications;
CREATE POLICY "owner" ON public.notifications
  FOR ALL USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
