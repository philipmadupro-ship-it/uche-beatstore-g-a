-- 038_buyer_pipeline.sql
-- Adds a buyer-specific pipeline status to contacts.
-- The 'buyer' category is a new ContactCategory value used for
-- store visitors who complete a free download or contact form.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS buyer_pipeline_status text DEFAULT NULL
    CHECK (buyer_pipeline_status IS NULL OR buyer_pipeline_status IN (
      'new_lead', 'contacted', 'negotiating', 'purchased', 'repeat_buyer'
    ));

NOTIFY pgrst, 'reload schema';
