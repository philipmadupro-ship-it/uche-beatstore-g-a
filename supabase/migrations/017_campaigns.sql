-- 017_campaigns.sql
--
-- Campaigns + auto-followup scaffolding.
--
-- A "campaign" groups a batch of beat sends so the producer can talk
-- about a push as one thing: "the March drill batch", "the Brent
-- Faiyaz fit pitch". Each beat_send can optionally belong to one
-- campaign, and a campaign has many targets (one per recipient).
--
-- Targets carry their own status snapshot so the campaign view can
-- show a funnel (sent → opened → interested → placed/pass) without
-- joining back to beat_sends every time. The status on
-- campaign_targets is kept loosely in sync by the application layer
-- — beat_sends remains the source of truth for individual sends.
--
-- This migration is intentionally additive: existing beat_sends rows
-- continue to work, and the new `campaign_id` column on beat_sends
-- is nullable so legacy sends stay valid.

-- ────────────────────────────────────────────────────────────────────
-- campaigns — a named batch of outreach
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  -- optional follow-up cadence in days. The /contacts followup view
  -- uses this to decide when a target needs a nudge. NULL falls back
  -- to a global default (5 days) in the UI.
  nudge_after_days  integer,
  started_at   timestamptz,
  ended_at     timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaigns_user_idx ON campaigns(user_id);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaigns_select ON campaigns;
CREATE POLICY campaigns_select ON campaigns
  FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS campaigns_insert ON campaigns;
CREATE POLICY campaigns_insert ON campaigns
  FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS campaigns_update ON campaigns;
CREATE POLICY campaigns_update ON campaigns
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS campaigns_delete ON campaigns;
CREATE POLICY campaigns_delete ON campaigns
  FOR DELETE USING (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────
-- campaign_targets — one row per (campaign, contact) pair
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_targets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  beat_send_id  uuid REFERENCES beat_sends(id) ON DELETE SET NULL,
  -- snapshot of beat_sends.status so the campaign funnel view doesn't
  -- have to join. Application code updates this whenever the
  -- underlying beat_send status moves.
  status        text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'opened', 'interested', 'negotiating', 'placed', 'pass')),
  last_nudge_at timestamptz,                       -- when we last followed up
  nudge_count   integer NOT NULL DEFAULT 0,        -- guardrail against over-nudging
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS campaign_targets_campaign_idx ON campaign_targets(campaign_id);
CREATE INDEX IF NOT EXISTS campaign_targets_contact_idx ON campaign_targets(contact_id);

ALTER TABLE campaign_targets ENABLE ROW LEVEL SECURITY;

-- Targets are accessible iff the parent campaign belongs to the
-- caller. We don't store user_id on targets because the parent
-- already enforces ownership.
DROP POLICY IF EXISTS campaign_targets_select ON campaign_targets;
CREATE POLICY campaign_targets_select ON campaign_targets
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_targets.campaign_id AND c.user_id = auth.uid())
  );
DROP POLICY IF EXISTS campaign_targets_insert ON campaign_targets;
CREATE POLICY campaign_targets_insert ON campaign_targets
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_targets.campaign_id AND c.user_id = auth.uid())
  );
DROP POLICY IF EXISTS campaign_targets_update ON campaign_targets;
CREATE POLICY campaign_targets_update ON campaign_targets
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_targets.campaign_id AND c.user_id = auth.uid())
  );
DROP POLICY IF EXISTS campaign_targets_delete ON campaign_targets;
CREATE POLICY campaign_targets_delete ON campaign_targets
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_targets.campaign_id AND c.user_id = auth.uid())
  );

-- ────────────────────────────────────────────────────────────────────
-- beat_sends.campaign_id — soft link from a send to its campaign
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE beat_sends
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS beat_sends_campaign_idx ON beat_sends(campaign_id);

-- updated_at trigger so the campaigns list can show "last edited".
CREATE OR REPLACE FUNCTION campaigns_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaigns_touch ON campaigns;
CREATE TRIGGER campaigns_touch
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION campaigns_touch_updated_at();
