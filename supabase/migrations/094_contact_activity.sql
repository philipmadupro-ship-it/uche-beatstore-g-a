-- 094_contact_activity.sql
-- Unified activity timeline per contact — the spine of a real CRM.
--
-- Every interaction lands here as one row so a contact's detail page becomes
-- a chronological story instead of a static record:
--   beat_sent | email_opened | link_clicked | track_played | purchase
--   | note | stage_change
--
-- Rows are written by:
--   - /api/contacts/[id]/activity POST          (manual notes)
--   - the Stripe webhook                         (purchase, when buyer_email
--                                                 matches a contact)
--   - the Resend webhook                         (email_opened / link_clicked)
--   - the beat-send flow                         (beat_sent)
--
-- `kind` is free text validated in Zod (not a CHECK) so new activity types
-- need no migration. `metadata` carries the structured payload
-- (track_ids, amount_usd, beat_send_id, stripe_session_id, …).

CREATE TABLE IF NOT EXISTS public.contact_activity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Timeline read: newest-first per contact.
CREATE INDEX IF NOT EXISTS idx_contact_activity_contact
  ON public.contact_activity (contact_id, occurred_at DESC);

-- Owner-wide activity feed (analytics / recent-activity panel).
CREATE INDEX IF NOT EXISTS idx_contact_activity_user
  ON public.contact_activity (user_id, occurred_at DESC);

-- Idempotency guard for system-generated rows: a (contact, kind, dedupe_key)
-- in metadata lets the webhook avoid double-logging the same purchase / open.
-- Implemented as a partial unique index on a generated dedupe expression.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_activity_dedupe
  ON public.contact_activity (contact_id, kind, (metadata->>'dedupe_key'))
  WHERE metadata->>'dedupe_key' IS NOT NULL;

ALTER TABLE public.contact_activity ENABLE ROW LEVEL SECURITY;

-- Owner-only. auth.uid() wrapped in a subselect so the planner evaluates it
-- once per query rather than per row (Supabase RLS perf guidance, mig 093).
DROP POLICY IF EXISTS contact_activity_owner ON public.contact_activity;
CREATE POLICY contact_activity_owner ON public.contact_activity
  FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';
