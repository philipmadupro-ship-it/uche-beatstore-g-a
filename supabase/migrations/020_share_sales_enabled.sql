-- 020_share_sales_enabled.sql
--
-- Per-share flag for whether the share page exposes Buy buttons
-- on the license card. The producer's pricing in creator_profiles
-- is the menu; this flag is whether the menu shows up on a given
-- send.
--
-- Default FALSE so existing shares stay closed-form. The producer
-- has to explicitly opt a share in to "for sale" mode — protects
-- against accidentally turning a casual "check this out" send
-- into a checkout page.
--
-- Same column added to share_links for consistency with how
-- recipient_kind landed in migration 015.

ALTER TABLE project_shares
  ADD COLUMN IF NOT EXISTS sales_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE share_links
  ADD COLUMN IF NOT EXISTS sales_enabled boolean NOT NULL DEFAULT false;

-- Force PostgREST to refresh its schema cache so the next API call
-- sees the new column without waiting for the auto-reload tick.
NOTIFY pgrst, 'reload schema';
