-- Behaviour checks for 178_labelos_contract_signing.sql (LABEL-60), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven:
--   1. SIGNATURES ARE APPEND-ONLY — no UPDATE, no direct DELETE, no TRUNCATE (even as the
--      table owner / service role); the org's hard delete (a cascade) still goes through.
--   2. NO API-ROLE ACCESS — authenticated and anon read, insert, update and delete nothing
--      in contract_signers / contract_signatures (no privilege and a deny-all policy).
--   3. SIGNING — only a `sent` contract takes a signature; at the version the signer read; for
--      a party on it; once per party per document. The LAST party's signature moves sent →
--      signed in the same transaction, with both audit events. A signature on an older document
--      does not complete the contract.
--   4. LINKS — issued only for a sent contract and a party on it; the token hash is stored
--      (never a token); revoking clears it; a second issue replaces it.
--   5. SUPERSEDE — voids a sent / signed contract, makes a draft copy with the same parties and
--      no internal note, links the two, and revokes the old links.
--   6. PROVIDER URL — https only.
--   7. Another org's contract / party cannot be signed or linked.

\set O    '''a1780000-0000-4000-8000-000000000001'''
\set X    '''a1780000-0000-4000-8000-000000000009'''
\set L    '''b1780000-0000-4000-8000-000000000001'''
\set L2   '''b1780000-0000-4000-8000-000000000002'''
\set PA   '''f1780000-0000-4000-8000-0000000000a1'''
\set PB   '''f1780000-0000-4000-8000-0000000000a2'''
\set XP   '''f1780000-0000-4000-8000-0000000000a9'''
\set SHA1 '''1111111111111111111111111111111111111111111111111111111111111111'''
\set SHA2 '''2222222222222222222222222222222222222222222222222222222222222222'''
\set H1   '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
\set LINKH '''dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'''
\set H2   '''bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'''

INSERT INTO auth.users (id, email) VALUES (:O, 'o178@local.test'), (:X, 'x178@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-178', 'label', :O),
  (:L2, 'Label L2', 'label-l2-178', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'), (:L2, :X, 'owner', '{}', 'org');
INSERT INTO public.parties (id, org_id, kind, display_name) VALUES
  (:PA, :L, 'company', 'Label L Ltd'),
  (:PB, :L, 'person', 'Nova Example'),
  (:XP, :L2, 'person', 'Outsider');

CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;
CREATE FUNCTION public.check_raises(label text, stmt text, pattern text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~* pattern THEN RETURN; END IF;
    RAISE EXCEPTION 'CHECK FAILED: % — raised "%", wanted /%/', label, SQLERRM, pattern;
  END;
  RAISE EXCEPTION 'CHECK FAILED: % — statement succeeded, wanted /%/', label, pattern;
END $$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text) TO anon, authenticated, service_role;

-- A sent contract between the label (PA) and Nova (PB).
SELECT public.labelos_contract_save(:L, :O, NULL,
  jsonb_build_object('type', 'recording', 'title', 'K1', 'template_source', 'platform:recording@1', 'template_version', 1,
    'clauses', '[{"id":"a","heading":"H","body":"B"}]'::jsonb, 'effective_date', '2026-01-01', 'term_months', 12),
  jsonb_build_array(jsonb_build_object('party_id', :PA, 'role', 'label', 'position', 0), jsonb_build_object('party_id', :PB, 'role', 'artist', 'position', 1)));
SELECT id AS k1raw FROM public.contracts WHERE title = 'K1' \gset
\set K1 :'k1raw'
UPDATE public.contracts SET internal_note = 'chase', status = 'sent', sent_document_sha256 = :SHA1, sent_document_ref = 'local://orgs/b1780000-0000-4000-8000-000000000001/assets/x/sent.pdf',
  sent_snapshot = '{"title":"K1","typeLabel":"Recording","version":1,"parties":[],"clauses":[]}'::jsonb WHERE id = :K1;

SELECT public.check_raises('the frozen sent copy is never changed (hash)', format($q$UPDATE public.contracts SET sent_document_sha256 = %L WHERE id = %L$q$, :SHA2, :K1), 'left draft');
SELECT public.check_raises('… nor its stored bytes', format($q$UPDATE public.contracts SET sent_document_ref = 'local://x/other.pdf' WHERE id = %L$q$, :K1), 'left draft');
SELECT public.check_raises('… nor its text', format($q$UPDATE public.contracts SET sent_snapshot = '{}'::jsonb WHERE id = %L$q$, :K1), 'left draft');
SELECT public.check_raises('a hash without its stored copy is refused', $$INSERT INTO public.contracts (org_id, type, title, template_source, clauses, sent_document_sha256) VALUES ('b1780000-0000-4000-8000-000000000001', 'nda', 'x', 'p', '[{"a":1}]', repeat('a', 64))$$, 'contracts_sent_document_check');

-- ── 3. Signing ───────────────────────────────────────────────────────────

SELECT public.check_eq('a draft takes no signature',
  (SELECT public.labelos_audit_contract_sign(:L, :O, (SELECT id FROM public.contracts WHERE title = 'nope'), :PA, 'label', 1, :SHA1, 'Label L', 'typed', NULL, 'member', true, NULL, NULL, '{}'::jsonb) ->> 'error'),
  'not_found');
SELECT public.check_eq('the wrong version is refused',
  (SELECT public.labelos_audit_contract_sign(:L, :O, :K1, :PA, 'label', 2, :SHA1, 'Label L', 'typed', NULL, 'member', true, NULL, NULL, '{}'::jsonb) ->> 'error'), 'changed');
SELECT public.check_eq('a party that is not on the contract is refused',
  (SELECT public.labelos_audit_contract_sign(:L, :O, :K1, :XP, 'artist', 1, :SHA1, 'Outsider', 'typed', NULL, 'member', false, NULL, NULL, '{}'::jsonb) ->> 'error'), 'not_party');
SELECT public.check_eq('a party in another role is refused',
  (SELECT public.labelos_audit_contract_sign(:L, :O, :K1, :PB, 'label', 1, :SHA1, 'Nova Example', 'typed', NULL, 'member', false, NULL, NULL, '{}'::jsonb) ->> 'error'), 'not_party');
SELECT public.check_eq('another org cannot sign it',
  (SELECT public.labelos_audit_contract_sign(:L2, :X, :K1, :PA, 'label', 1, :SHA1, 'Mallory', 'typed', NULL, 'member', false, NULL, NULL, '{}'::jsonb) ->> 'error'), 'not_found');

SELECT public.check_raises('a secret-looking payload key is refused',
  format($q$SELECT public.labelos_audit_contract_sign(%L, %L, %L, %L, 'label', 1, %L, 'Label L', 'typed', NULL, 'member', true, NULL, NULL, '{"token":"x"}'::jsonb)$q$, :L, :O, :K1, :PA, :SHA1), 'secret-looking');

SELECT public.check_eq('the label countersigns first: signed, not completed',
  (SELECT public.labelos_audit_contract_sign(:L, :O, :K1, :PA, 'label', 1, :SHA1, 'Label L', 'typed', NULL, 'member', true, 'abcdef0123456789abcdef0123456789', NULL, '{"x":1}'::jsonb) ->> 'completed'), 'false');
SELECT public.check_eq('still sent', (SELECT status FROM public.contracts WHERE id = :K1), 'sent');
SELECT public.check_eq('the same party twice on the same document is a duplicate',
  (SELECT public.labelos_audit_contract_sign(:L, :O, :K1, :PA, 'label', 1, :SHA1, 'Label L', 'typed', NULL, 'member', true, NULL, NULL, '{}'::jsonb) ->> 'error'), 'duplicate');
SELECT public.check_eq('an event was written for the signature',
  (SELECT count(*)::int FROM public.activity_events WHERE org_id = :L AND verb = 'contract.signature_added' AND audit), 1);

SELECT public.check_eq('a link signer with no live link is refused (link_gone)',
  (SELECT public.labelos_audit_contract_sign(:L, NULL, :K1, :PB, 'artist', 1, :SHA1, 'Nova Example', 'typed', NULL, 'link', false, NULL, :LINKH, '{}'::jsonb) ->> 'error'), 'link_gone');
SELECT public.labelos_audit_contract_link_issue(:L, :O, :K1, :PB, :LINKH, now() + interval '30 days', '{}'::jsonb);
SELECT public.check_eq('… a different link hash is refused too',
  (SELECT public.labelos_audit_contract_sign(:L, NULL, :K1, :PB, 'artist', 1, :SHA1, 'Nova Example', 'typed', NULL, 'link', false, NULL, :H1, '{}'::jsonb) ->> 'error'), 'link_gone');

-- A signature on a hash that is not the frozen sent copy's is refused: the signer must have read THAT text.
SELECT public.check_eq('Nova signs another hash: refused (changed), nothing recorded',
  (SELECT public.labelos_audit_contract_sign(:L, NULL, :K1, :PB, 'artist', 1, :SHA2, 'Nova Example', 'typed', NULL, 'link', false, NULL, :LINKH, '{}'::jsonb) ->> 'error'), 'changed');
SELECT public.check_eq('still sent', (SELECT status FROM public.contracts WHERE id = :K1), 'sent');
-- Now Nova signs the current document (drawn): the last party, so the contract becomes signed with both events.
SELECT public.check_eq('Nova signs SHA1 (drawn) and completes',
  (SELECT public.labelos_audit_contract_sign(:L, NULL, :K1, :PB, 'artist', 1, :SHA1, 'Nova Example', 'drawn', 'local://orgs/b1780000-0000-4000-8000-000000000001/assets/x/y.png', 'link', false, NULL, :LINKH, '{}'::jsonb) ->> 'completed'), 'true');
SELECT public.check_eq('the contract is signed', (SELECT status FROM public.contracts WHERE id = :K1), 'signed');
SELECT public.check_eq('contract.signed recorded once',
  (SELECT count(*)::int FROM public.activity_events WHERE org_id = :L AND verb = 'contract.signed' AND audit), 1);
SELECT public.check_eq('the link signer’s event has no actor', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'contract.signature_added' AND actor_id IS NULL), 1);
SELECT public.check_eq('a signed contract takes no more signatures',
  (SELECT public.labelos_audit_contract_sign(:L, :O, :K1, :PA, 'label', 1, :H1, 'Label L', 'typed', NULL, 'member', true, NULL, NULL, '{}'::jsonb) ->> 'error'), 'already_signed');
SELECT public.check_eq('two signature rows, both on the frozen hash', (SELECT count(*)::int FROM public.contract_signatures WHERE contract_id = :K1 AND document_sha256 = :SHA1), 2);

-- ── 1. Append-only ───────────────────────────────────────────────────────

SELECT public.check_raises('a signature is never updated', format($q$UPDATE public.contract_signatures SET signer_name = 'Someone Else' WHERE contract_id = %L$q$, :K1), 'never changed');
SELECT public.check_raises('… not even its hash', format($q$UPDATE public.contract_signatures SET document_sha256 = %L WHERE contract_id = %L$q$, :H1, :K1), 'never changed');
SELECT public.check_raises('a signature is never deleted', format($q$DELETE FROM public.contract_signatures WHERE contract_id = %L$q$, :K1), 'never deleted');
SELECT public.check_raises('… nor truncated', $$TRUNCATE public.contract_signatures$$, 'never truncated');
SELECT public.check_raises('a drawn signature must carry an image', format($q$INSERT INTO public.contract_signatures (contract_id, org_id, party_id, role, contract_version, document_sha256, signer_name, method, via) VALUES (%L, %L, %L, 'label', 1, %L, 'Label L', 'drawn', 'member')$q$, :K1, :L, :PA, :H2), 'contract_signatures_image_check');
SELECT public.check_raises('… and never a URL', format($q$INSERT INTO public.contract_signatures (contract_id, org_id, party_id, role, contract_version, document_sha256, signer_name, method, signature_image, via) VALUES (%L, %L, %L, 'label', 1, %L, 'Label L', 'drawn', 'https://evil.test/x.png', 'member')$q$, :K1, :L, :PA, :H2), 'contract_signatures_image_check');
SELECT public.check_raises('a typed signature carries no image', format($q$INSERT INTO public.contract_signatures (contract_id, org_id, party_id, role, contract_version, document_sha256, signer_name, method, signature_image, via) VALUES (%L, %L, %L, 'label', 1, %L, 'Label L', 'typed', 'local://x/y.png', 'member')$q$, :K1, :L, :PA, :H2), 'contract_signatures_image_check');
SELECT public.check_raises('a signature of a party not on the contract (direct insert)', format($q$INSERT INTO public.contract_signatures (contract_id, org_id, party_id, role, contract_version, document_sha256, signer_name, method, via) VALUES (%L, %L, %L, 'artist', 1, %L, 'Outsider', 'typed', 'member')$q$, :K1, :L, :XP, :H2), 'not on this contract|belongs to another');

-- ── 2. No API-role access ────────────────────────────────────────────────

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :O, 'role', 'authenticated')::text, false);
SELECT public.check_raises('authenticated reads no signature', $$SELECT count(*) FROM public.contract_signatures$$, 'permission denied');
SELECT public.check_raises('authenticated reads no signer link', $$SELECT count(*) FROM public.contract_signers$$, 'permission denied');
SELECT public.check_raises('authenticated cannot insert a signature', format($q$INSERT INTO public.contract_signatures (contract_id, org_id, party_id, role, contract_version, document_sha256, signer_name, method, via) VALUES (%L, %L, %L, 'label', 1, %L, 'Mallory', 'typed', 'member')$q$, :K1, :L, :PA, :H2), 'permission denied');
SELECT public.check_raises('authenticated cannot update', $$UPDATE public.contract_signatures SET signer_name = 'x'$$, 'permission denied');
SELECT public.check_raises('authenticated cannot delete', $$DELETE FROM public.contract_signatures$$, 'permission denied');
SELECT public.check_raises('authenticated cannot read the provider url column', $$SELECT esign_provider_url FROM public.contracts$$, 'permission denied');
SELECT public.check_raises('… nor call the sign function', format($q$SELECT public.labelos_audit_contract_sign(%L, %L, %L, %L, 'label', 1, %L, 'Mallory', 'typed', NULL, 'member', false, NULL, NULL, '{}'::jsonb)$q$, :L, :O, :K1, :PA, :H2), 'permission denied');
RESET ROLE;
SET ROLE anon;
SELECT public.check_raises('anon reads no signature', $$SELECT count(*) FROM public.contract_signatures$$, 'permission denied');
SELECT public.check_raises('anon reads no signer link', $$SELECT count(*) FROM public.contract_signers$$, 'permission denied');
RESET ROLE;

-- ── 4. Links ─────────────────────────────────────────────────────────────

SELECT public.labelos_contract_save(:L, :O, NULL,
  jsonb_build_object('type', 'nda', 'title', 'K2', 'template_source', 'platform:nda@1', 'template_version', 1,
    'clauses', '[{"id":"a","heading":"H","body":"B"}]'::jsonb, 'internal_note', 'private note'),
  jsonb_build_array(jsonb_build_object('party_id', :PA, 'role', 'disclosing', 'position', 0), jsonb_build_object('party_id', :PB, 'role', 'receiving', 'position', 1)));
SELECT id AS k2raw FROM public.contracts WHERE title = 'K2' \gset
\set K2 :'k2raw'
SELECT public.check_eq('no link for a draft', (SELECT public.labelos_audit_contract_link_issue(:L, :O, :K2, :PB, :H1, now() + interval '30 days', '{}'::jsonb) ->> 'error'), 'not_sent');
UPDATE public.contracts SET status = 'sent' WHERE id = :K2;
SELECT public.check_eq('no link for a party that is not on it', (SELECT public.labelos_audit_contract_link_issue(:L, :O, :K2, :XP, :H1, now() + interval '30 days', '{}'::jsonb) ->> 'error'), 'not_party');
SELECT public.check_eq('another org cannot issue', (SELECT public.labelos_audit_contract_link_issue(:L2, :X, :K2, :PB, :H1, now() + interval '30 days', '{}'::jsonb) ->> 'error'), 'not_found');
SELECT public.check_raises('only a sha-256 hash can be stored as the link', format($q$SELECT public.labelos_audit_contract_link_issue(%L, %L, %L, %L, 'a-raw-token', now() + interval '30 days', '{}'::jsonb)$q$, :L, :O, :K2, :PB), 'contract_signers_hash_check');
SELECT public.check_eq('issued', (SELECT public.labelos_audit_contract_link_issue(:L, :O, :K2, :PB, :H1, now() + interval '30 days', '{}'::jsonb) ->> 'issued'), 'true');
SELECT public.check_eq('the role is the first one the party holds', (SELECT role FROM public.contract_signers WHERE contract_id = :K2 AND party_id = :PB), 'receiving');
SELECT public.check_eq('a second issue replaces the hash (rotate)', (SELECT public.labelos_audit_contract_link_issue(:L, :O, :K2, :PB, :H2, now() + interval '30 days', '{}'::jsonb) ->> 'issued'), 'true');
SELECT public.check_eq('… one row, the new hash', (SELECT count(*)::int FROM public.contract_signers WHERE contract_id = :K2 AND token_hash = :H2), 1);
SELECT public.check_eq('… and the old hash is gone', (SELECT count(*)::int FROM public.contract_signers WHERE token_hash = :H1), 0);
SELECT public.check_eq('two issue events', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'contract.signer_link_issued' AND subject_id = :K2), 2);
SELECT public.check_eq('revoked', (SELECT public.labelos_audit_contract_link_revoke(:L, :O, :K2, :PB, '{}'::jsonb) ->> 'revoked'), 'true');
SELECT public.check_eq('… the hash is cleared', (SELECT token_hash IS NULL AND link_revoked_at IS NOT NULL FROM public.contract_signers WHERE contract_id = :K2 AND party_id = :PB), true);
SELECT public.check_eq('revoking a revoked link', (SELECT public.labelos_audit_contract_link_revoke(:L, :O, :K2, :PB, '{}'::jsonb) ->> 'error'), 'no_link');

-- ── 5. Supersede ─────────────────────────────────────────────────────────

SELECT public.labelos_audit_contract_link_issue(:L, :O, :K2, :PB, :H1, now() + interval '30 days', '{}'::jsonb);
SELECT public.check_eq('a draft cannot be superseded', (SELECT public.labelos_audit_contract_supersede(:L, :O, (SELECT id FROM public.contracts WHERE title = 'K1' AND status = 'draft'), 'x', '{}'::jsonb) ->> 'error'), 'not_found');
SELECT public.labelos_audit_contract_supersede(:L, :O, :K2, 'Wrong term', '{"reason_given":true}'::jsonb) AS sup \gset
SELECT (:'sup'::jsonb ->> 'new_id') AS k3raw \gset
\set K3 :'k3raw'
SELECT public.check_eq('the old contract is void', (SELECT status FROM public.contracts WHERE id = :K2), 'void');
SELECT public.check_eq('… points at its replacement', (SELECT superseded_by FROM public.contracts WHERE id = :K2), :K3::uuid);
SELECT public.check_eq('the replacement is a draft', (SELECT status FROM public.contracts WHERE id = :K3), 'draft');
SELECT public.check_eq('… that points back', (SELECT supersedes_id FROM public.contracts WHERE id = :K3), :K2::uuid);
SELECT public.check_eq('… with the same parties', (SELECT count(*)::int FROM public.contract_parties WHERE contract_id = :K3), 2);
SELECT public.check_eq('… and no internal note', (SELECT internal_note IS NULL FROM public.contracts WHERE id = :K3), true);
SELECT public.check_eq('the old link is revoked with it', (SELECT count(*)::int FROM public.contract_signers WHERE contract_id = :K2 AND token_hash IS NOT NULL), 0);
SELECT public.check_eq('contract.superseded recorded', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'contract.superseded' AND subject_id = :K2 AND audit), 1);
SELECT public.check_eq('a superseded contract cannot be superseded again', (SELECT public.labelos_audit_contract_supersede(:L, :O, :K2, 'x', '{}'::jsonb) ->> 'error'), 'not_sent');
SELECT public.check_eq('a signed contract can be superseded', (SELECT public.labelos_audit_contract_supersede(:L, :O, :K1, NULL, '{}'::jsonb) ->> 'from'), 'signed');
SELECT public.check_eq('… and its signatures remain as the record', (SELECT count(*)::int FROM public.contract_signatures WHERE contract_id = :K1), 2);
SELECT public.check_eq('… the replacement carries no frozen copy (it is sent anew)', (SELECT sent_document_sha256 IS NULL AND sent_snapshot IS NULL FROM public.contracts WHERE supersedes_id = :K1), true);

-- ── 6. Provider url ──────────────────────────────────────────────────────

UPDATE public.contracts SET esign_provider_url = 'https://sign.example.com/doc/1' WHERE id = :K1;
SELECT public.check_raises('http is refused', format($q$UPDATE public.contracts SET esign_provider_url = 'http://sign.example.com/doc/1' WHERE id = %L$q$, :K1), 'contracts_esign_url_check');
SELECT public.check_raises('credentials in the url are refused', format($q$UPDATE public.contracts SET esign_provider_url = 'https://u@sign.example.com/doc/1' WHERE id = %L$q$, :K1), 'contracts_esign_url_check');
SELECT public.check_raises('javascript: is refused', format($q$UPDATE public.contracts SET esign_provider_url = 'javascript:alert(1)' WHERE id = %L$q$, :K1), 'contracts_esign_url_check');

-- ── 7. The org's own deletion cascades through the immutable table ───────
-- (labelos_org_hard_delete.sql proves it for every table; here, the signature rows of THIS org.)

DELETE FROM public.organizations WHERE id = :L;
SELECT public.check_eq('the org’s delete removed its signatures', (SELECT count(*)::int FROM public.contract_signatures WHERE org_id = :L), 0);
SELECT public.check_eq('… and its signer links', (SELECT count(*)::int FROM public.contract_signers WHERE org_id = :L), 0);

SELECT 'LABEL-60 contract signing checks passed' AS result;
