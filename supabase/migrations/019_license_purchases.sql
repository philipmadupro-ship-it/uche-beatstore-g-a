-- 019_license_purchases.sql
--
-- Records a completed Stripe Checkout for a license of one (or more)
-- tracks. Inserted by the webhook handler on `checkout.session.completed`.
-- Read by:
--   - the share-page UI to flip the license card from "Buy" to
--     "Purchased — download" once the buyer's email matches.
--   - the gated download endpoint that issues signed R2 URLs.
--
-- One row per Checkout Session. A buyer who purchases two tracks in
-- one session gets one row with `track_ids` as the array; a buyer
-- who comes back next month for a different track gets a second row.

CREATE TABLE IF NOT EXISTS license_purchases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Owner of the tracks being licensed — derived from the share at
  -- checkout-creation time, locked in so renaming a creator profile
  -- later doesn't orphan old purchases.
  seller_user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The buyer doesn't need an account. Email + Stripe customer are
  -- the identifiers we have to work with.
  buyer_email           text NOT NULL,
  buyer_stripe_customer text,
  -- Share token the purchase was initiated from. Useful for analytics
  -- ("which share link converted") and for matching purchases back to
  -- the share page that initiated them.
  share_token           text,
  -- Which tracks the buyer licensed. Multi-track means the buyer
  -- selected several from a share page in one go.
  track_ids             uuid[] NOT NULL,
  license_type          text NOT NULL CHECK (license_type IN ('lease', 'exclusive')),
  amount_usd            numeric NOT NULL,
  stripe_session_id     text UNIQUE NOT NULL,
  stripe_payment_intent text,
  status                text NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid', 'refunded', 'disputed', 'failed')),
  -- WAV download exposure flag — flips false on refund/dispute so
  -- the download endpoint can revoke access without deleting the
  -- purchase record (we want the audit trail).
  download_unlocked     boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS license_purchases_seller_idx ON license_purchases(seller_user_id);
CREATE INDEX IF NOT EXISTS license_purchases_buyer_email_idx ON license_purchases(buyer_email);
CREATE INDEX IF NOT EXISTS license_purchases_share_token_idx ON license_purchases(share_token);

-- RLS: sellers can read their own sales. The buyer-facing download
-- endpoint reads with the service-role client because anonymous
-- share-page visitors have no auth session.
ALTER TABLE license_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS license_purchases_select ON license_purchases;
CREATE POLICY license_purchases_select ON license_purchases
  FOR SELECT USING (seller_user_id = auth.uid());

-- Insert/update lives in webhook handler (service role) so no RLS
-- policies for those — INSERTs from non-service-role contexts are
-- intentionally blocked.

CREATE OR REPLACE FUNCTION license_purchases_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS license_purchases_touch ON license_purchases;
CREATE TRIGGER license_purchases_touch
  BEFORE UPDATE ON license_purchases
  FOR EACH ROW EXECUTE FUNCTION license_purchases_touch_updated_at();
