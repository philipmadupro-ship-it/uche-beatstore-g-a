-- 057_license_contracts.sql
--
-- Per-producer license-agreement template + per-purchase generated PDF.
--
-- Producers store a single markdown-flavoured template in their profile.
-- Substitution variables like {{buyer_name}}, {{track_title}}, etc. get
-- filled in at purchase time, the result is rendered to a PDF, uploaded
-- to R2, and the URL is stamped on the matching license_purchases row.
-- The Resend delivery email attaches the PDF so the buyer gets a proper
-- signed-feeling contract with their files.
--
-- license_template_md is NULL = use the system default (lib/contracts/license-template.ts).
-- contract_pdf_url is NULL until the webhook generates it.
--
-- Idempotent.

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS license_template_md text;

ALTER TABLE public.license_purchases
  ADD COLUMN IF NOT EXISTS contract_pdf_url text;

NOTIFY pgrst, 'reload schema';
