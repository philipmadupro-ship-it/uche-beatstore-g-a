#!/usr/bin/env node
// Prints ONE SQL script that removes exactly what seed-test-accounts.mjs made.
//
//   node scripts/ops/remove-test-accounts.mjs [--email-base <addr>] > scripts/ops/out/remove-test-accounts.sql
//
// Needs no password. A row is removed only if it is marked and named by the model:
//  * users: raw_user_meta_data.seed = 'bstudio-test-accounts' AND the email is one of the test addresses;
//  * organizations: created by one of those users AND every owner is one of those users. (Another
//    org a test user merely belongs to keeps existing; only their membership goes.)
// Migration 195 only lets an organization row go 30 days after deleted_at, so the script first
// sets deleted_at back 31 days on those orgs (the purge cron's own precondition), deletes the orgs
// (every org table cascades), then the users — the sole-owner guard is satisfied because the orgs
// are gone by then. Buyer rows keyed by a test email (favourites, history, playlists) go too.
// It aborts, changing nothing, on any error.

import { ACCOUNTS, DEFAULT_EMAIL_BASE, SEED_MARKER, emailFor, parseArgs, sqlLit } from './test-accounts-model.mjs';

export function buildRemoveSql({ emailBase }) {
  const emails = ACCOUNTS.map((a) => sqlLit(emailFor(emailBase, a.tag))).join(', ');
  const marker = sqlLit(SEED_MARKER);
  return `-- Removes the Label OS test accounts made by seed-test-accounts.mjs — and nothing else.
-- Paste into the Supabase SQL editor with nothing selected. Safe to re-run.

DO $remove$
DECLARE
  v_users uuid[];
  v_orgs  uuid[];
  v_org   uuid;
  v_n     int;
BEGIN
  SELECT coalesce(array_agg(u.id), '{}') INTO v_users
    FROM auth.users u
   WHERE u.raw_user_meta_data ->> 'seed' = ${marker}
     AND lower(u.email) IN (${emails});

  SELECT coalesce(array_agg(o.id), '{}') INTO v_orgs
    FROM public.organizations o
   WHERE o.created_by = ANY (v_users)
     AND NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = o.id AND m.role = 'owner' AND m.user_id <> ALL (v_users));

  -- 195: an organization row is deleted only 30 days after deleted_at. Back-date it, then delete.
  FOREACH v_org IN ARRAY v_orgs LOOP
    UPDATE public.organizations SET deleted_at = now() - interval '31 days' WHERE id = v_org;
    DELETE FROM public.organizations WHERE id = v_org;
  END LOOP;

  -- Buyer rows are keyed by email, not by user id.
  IF to_regclass('public.buyer_favorites') IS NOT NULL THEN
    DELETE FROM public.buyer_favorites WHERE lower(email) IN (${emails});
  END IF;
  IF to_regclass('public.buyer_listening_history') IS NOT NULL THEN
    DELETE FROM public.buyer_listening_history WHERE lower(email) IN (${emails});
  END IF;
  IF to_regclass('public.buyer_playlists') IS NOT NULL THEN
    DELETE FROM public.buyer_playlists WHERE lower(email) IN (${emails});
  END IF;

  -- identities and memberships cascade from the user; the sole-owner guard no longer applies (orgs are gone).
  DELETE FROM auth.users WHERE id = ANY (v_users);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'removed % organizations and % users', cardinality(v_orgs), v_n;
END
$remove$;

-- Read-only: both counts must be 0.
SELECT (SELECT count(*) FROM auth.users WHERE raw_user_meta_data ->> 'seed' = ${marker}) AS test_users_left,
       (SELECT count(*) FROM public.organizations WHERE slug IN ('test-label', 'test-artist-solo')) AS test_orgs_left;
`;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const emailBase = typeof args['email-base'] === 'string' ? args['email-base'] : DEFAULT_EMAIL_BASE;
    process.stdout.write(buildRemoveSql({ emailBase }));
  } catch (err) {
    process.stderr.write(`remove-test-accounts: ${err.message}\n`);
    process.exit(1);
  }
}
