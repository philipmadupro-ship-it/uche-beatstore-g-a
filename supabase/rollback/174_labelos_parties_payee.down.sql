-- Rollback for 174_labelos_parties_payee.sql (LABEL-54).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the withdraw function, the identity lock and the new columns (their
-- data goes with them: address, country, tax id, payment instructions and the
-- confirmation stamps), and puts 153's parties policy and table-wide SELECT
-- back. Credits already withdrawn stay withdrawn; their audit events remain.

DROP FUNCTION IF EXISTS public.labelos_audit_credit_withdraw(uuid, uuid, uuid, jsonb, jsonb);

DROP TRIGGER IF EXISTS parties_confirmation_reset ON public.parties;
DROP FUNCTION IF EXISTS public.parties_confirmation_reset();
DROP TRIGGER IF EXISTS parties_identity_lock ON public.parties;
DROP FUNCTION IF EXISTS public.parties_identity_lock();

-- 153's policy, word for word.
DROP POLICY IF EXISTS parties_member_read ON public.parties;
CREATE POLICY parties_member_read ON public.parties
  FOR SELECT
  USING (
    (
      org_id IN (
        SELECT cm.org_id
        FROM public.org_members cm
        WHERE cm.user_id = (SELECT auth.uid())
          AND public.has_org_cap(cm.org_id, 'rights.read')
      )
      AND (
        org_id IN (
          SELECT om.org_id
          FROM public.org_members om
          WHERE om.user_id = (SELECT auth.uid())
            AND om.scope = 'org'
            AND om.role <> 'artist'
        )
        OR (org_id, id) IN (SELECT sp.org_id, sp.party_id FROM public.labelos_scoped_parties() sp)
      )
    )
    OR (
      user_id = (SELECT auth.uid())
      AND org_id IN (SELECT mm.org_id FROM public.org_members mm WHERE mm.user_id = (SELECT auth.uid()))
    )
  );

-- Before 174 the API roles held the table-wide SELECT (policies decided the rows).
GRANT SELECT ON public.parties TO anon, authenticated;

ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_payment_instructions_check;
ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_tax_id_check;
ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_country_check;
ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_address_check;
ALTER TABLE public.parties DROP COLUMN IF EXISTS details_confirmed_at;
ALTER TABLE public.parties DROP COLUMN IF EXISTS details_confirmed_by;
ALTER TABLE public.parties DROP COLUMN IF EXISTS payment_instructions;
ALTER TABLE public.parties DROP COLUMN IF EXISTS tax_id;
ALTER TABLE public.parties DROP COLUMN IF EXISTS country;
ALTER TABLE public.parties DROP COLUMN IF EXISTS address;
DROP FUNCTION IF EXISTS public.labelos_looks_like_bank_number(text);

NOTIFY pgrst, 'reload schema';
