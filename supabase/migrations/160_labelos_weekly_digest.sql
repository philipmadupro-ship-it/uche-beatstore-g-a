-- 160_labelos_weekly_digest.sql
-- Label OS (LABEL-38): the opt-in weekly owner digest.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main. Never part of supabase/apply/pending.sql.
--
-- 1. `org_digest_members` — one row per (org, member) who has switched the
--    digest on or off. `last_sent_week` is the ISO week ('2026-W42', '' =
--    never) of the last digest CLAIMED for that member: the cron claims with
--    `UPDATE … WHERE last_sent_week <> $week RETURNING`, a compare-and-set,
--    so two concurrent runs cannot both send. A failed send puts the previous
--    value back.
--
-- 2. `org_digest_channels` — one row per org with the Slack incoming-webhook
--    URL, stored only as `slack_webhook_cipher` (AES-256-GCM, versioned
--    format, see lib/labelos/webhook-secret.ts). `organizations.settings` is
--    readable by every member, so the secret cannot live there. `slack_last_week`
--    is that channel's own once-a-week claim.
--
-- 3. Both tables are SERVICE-ROLE ONLY: row level security on, NO policy, and
--    no privilege for anon or authenticated. The routes enforce who may touch
--    what (a member their own row; org.manage the channel) and never return
--    the cipher. Both cascade from the organization (LABEL-39's hard delete)
--    and neither is in the org export (the cipher must never leave).
--
-- Idempotent: IF NOT EXISTS, DROP … IF EXISTS first.

CREATE TABLE IF NOT EXISTS public.org_digest_members (
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled        boolean NOT NULL DEFAULT false,
  last_sent_week text NOT NULL DEFAULT '' CHECK (last_sent_week = '' OR last_sent_week ~ '^[0-9]{4}-W[0-9]{2}$'),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS org_digest_members_enabled_idx ON public.org_digest_members (org_id) WHERE enabled;

CREATE TABLE IF NOT EXISTS public.org_digest_channels (
  org_id              uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  slack_webhook_cipher text,
  slack_last_week     text NOT NULL DEFAULT '' CHECK (slack_last_week = '' OR slack_last_week ~ '^[0-9]{4}-W[0-9]{2}$'),
  configured_by       uuid,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_digest_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_digest_channels ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.org_digest_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.org_digest_channels FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_digest_members TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_digest_channels TO service_role;

NOTIFY pgrst, 'reload schema';
