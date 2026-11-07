# 28 — Migration apply order, 136 … 196

**Written 2026-11-07 for LABEL-78. Documentation only. Nothing here has been applied to any database, and neither `supabase/apply/pending.sql` nor any migration file was touched.** The ledger of record stays `supabase/MIGRATIONS.md`; if the two disagree, the ledger wins and this file is stale.

## 1. State today

| Range | State | Source |
|---|---|---|
| 001–129 | **Applied on production** (owner's SQL-editor bundle, 2026-09-29, verify table all `applied`). 096–099 and 117/118 are two-file pairs; both sides are legitimate | `MIGRATIONS.md` "Applied status" |
| 130–135 | **Pending.** Artist workspace phase 3 (130–132), linked material (133), contact roles (134), label pitch notes (135). `supabase/apply/pending.sql` carries exactly these (plus 112–129 as already-applied, idempotent rows) | `MIGRATIONS.md`, `pending.sql` |
| 136–196 | **Label OS, not applied anywhere** (191 is PORTAL-UP, not Label OS, same rule). Applied "at the final merge, never in the pending bundle" | `MIGRATIONS.md`, doc 23 standing requirements |

Files on disk in 136–196: 59. **Not on disk, never to be bundled:** 177 (released, LABEL-59 needed none), 185 (released, LABEL-68 moved to 194), 188 (released, LABEL-74/75 took 195). The 096/097/098/099 and 117/118 pairs are outside this range.

The execution log (2026-10-19 10:05 entry) says a go-live session on branch `release/label-os-into-main` builds `supabase/apply/labelos-go-live.sql` (130–135, 136–172, 189–190, with a verify table). **That file lives on `main` (go-live branch), not on the phase-2 branch** (`ls supabase/apply` here shows only `editor/`, `pending.sql`, `verify.sql`). Reconcile with that branch's version before anyone pastes anything. Everything merged after 2026-10-19 (173+ except 189/190/192, and 191) is outside any bundle that existed at the time.

## 2. The rule

1. **Strict numeric order is always correct.** It is what `npm run db:migrate` (`scripts/apply-migrations.sh`) does, and every file is idempotent and ends with `NOTIFY pgrst, 'reload schema';`. A bundle is the same files in the same order.
2. A partial apply must be a **prefix of the order**, or a set closed under the dependency column of §4. Skipping a number that a later file redefines (§3) runs the later file against a missing function or constraint.
3. Apply on staging first, then production. Apply **before** deploying the code that uses it; every Label OS route degrades (`schemaReady: false` / 503 naming the migration) when its migration is missing, and `LABEL_OS_ENABLED` stays off until the whole set is in.
4. Wait about 10 s after the last file for PostgREST's schema cache, then run `NOTIFY pgrst, 'reload schema';` again if a column "is not in the schema cache".

## 3. Migrations that redefine something an earlier one made

Replacements must come **after** what they replace, and the *latest* definition is the one that counts (the capability parity test parses the latest `has_org_cap`). Bold = the redefinition listed in the LABEL-78 brief.

| Later | Replaces / extends | What changes |
|---|---|---|
| 138→139→148→**170** | `labelos_accept_invitation` | 139 adds org-contact handling, 148 project invitations, 170 owner-invitation rule + seat cap under lock |
| 136→170→171→187 | `has_org_cap` | 170 module check, 171 new departments/capabilities (data between `labelos:mapping` markers), 187 subtracts `settings.departments_off`. 187's body is a full copy of 171 plus one step: **any later redefinition must start from 187's text** |
| 146→148, 146→167→187 | `labelos_audit_invitation_create`, `labelos_audit_member_update` | 148 adds project invitations; 167 adds `p_expect` compare-and-set; 187 adds the seat cap (`seat_limit`) |
| 154→187 | `labelos_audit_connection_accept` | 187 adds the artist cap (`artist_limit`) |
| 157→187→**194** | `labelos_audit_approval_decide` | 187 latest-row/addressee/live-release/`seen`; 194 adds `'creative'` |
| 157→**194** | `labelos_audit_approval_request`, `approvals_gate_check` | 194 adds `'creative'` (a song still takes `legal` only) |
| 187→**194** | `labelos_audit_release_deliver` | 194 adds `'creative'` to the 187 body |
| 158→167 | `release_items_store_lock` | 167 takes `FOR SHARE` on the release and locks non-draft tracklists |
| 141→144→**193** | `labelos_track_is_finished` | 193 restricts the release arm: draft/cancelled releases no longer finish a song; adds `'withdrawn'` to `releases_state_check` and tightens 144's `store_listed` CHECK |
| 143→172 | `labelos_org_asset_allowed` | 172: "Contracts off" also hides restricted contract/split files |
| 170→**195** | `labelos_platform_create_licensee` | 195: `org.created` insert becomes audit-class |
| 172→**192**→**196** | `labelos_validate_org_settings_patch`, `labelos_audit_org_settings` | 192 introduces the validator (rules moved out of 172) and re-points 172's function at it; 196 adds `artwork_min_px` (600–10000) to the validator |
| 189→**192** | `labelos_setup_org` | 192 drops 189's 3-argument function and creates the 4-argument one with `p_settings`. 189 must run first (192 `DROP`s it) |
| 176→178 | `contracts_guard` | 178 freezes `sent_document_sha256`, `sent_document_ref`, `sent_snapshot` |
| 179→**180**, 179→**181**→**182** | `earnings_lines_guard`; `labelos_finance_frozen`; `finance_periods_guard`; statement issue/void and earnings-import-void functions | 180 lets `song_track_id`/`income_class`/`review_reason`/`track_id` change; 181 extends the freeze to statements; 182 adds period close and replaces three 181 functions |
| 159→168 | six generated `search_tsv` columns | 168 drops and re-adds them with `translate(…)`; nothing else reads `search_tsv` |
| 136→164 | `org_members_member_read`, `user_profiles_self_or_co_member_read` | 164 re-reads through `labelos_visible_members()` |
| 147→195 | `activity_events_member_read` | 195 removes the per-row `has_org_cap` |
| 155→162, 155→195 | `split_sheets` and `split_lines` grants | 162 column-level SELECT on `split_sheets`; 195 hides `signature_asset_id` / `signed_by` on `split_lines` |
| 130/132/133/141→145, 142 | `*_same_owner` triggers (`artist_messages`, `artist_portals`, `contact_track_states`, `project_contacts`, `song_beats`, `track_links`, `project_assets`) | 141 teaches them same-org rows, 145 drops NOT NULL on `user_id`, 142 on `track_links` |
| 111 (applied) | amended file only | skips rows with `org_id`; no re-apply needed |

## 4. Order and dependencies

Dependencies were derived by scanning each file for tables and functions created by an earlier **Label OS or pending** migration, then checked against the ledger. They name object-level dependencies; a migration that adds columns to `tracks` / `contacts` / `projects` / `releases` implicitly needs 140/141/139/144 and the earlier columns it reads. Treat the numeric order as the contract and this table as the explanation.

| # | Task | Needs | Note |
|---|---|---|---|
| 130–132 | Artist workspace phase 3 | applied ≤129 | in `pending.sql` |
| 133–135 | Linked material, contact roles, pitch notes | ≤132 | in `pending.sql`; 140 needs 133 |
| 136 | LABEL-03 org core | — | root of Label OS: `organizations`, `org_members`, `activity_events`, `has_org_cap` |
| 137 | LABEL-07 producer org | 136 | data migration: one `producer` org per creator profile |
| 138 | LABEL-08 invitation accept | 136 | |
| 139 | LABEL-10 org contacts | 136, 138 | amends 111 in file only |
| 140 | LABEL-11 song fields | 133 | `tracks.song_stage`, `iswc` |
| 141 | LABEL-12 org catalogue | 130, 132, 133, 136, 139 | `tracks.org_id`, `projects.org_id`, RLS + restrictive guards |
| 142 | LABEL-14 ownerless rows | 133, 141 | org rows have no `user_id` |
| 143 | LABEL-15 org assets | 136, 141 | |
| 144 | LABEL-16 releases | 132, 133, 136, 141 | |
| 145 | LABEL-17 ownerless workspace rows | 130, 132, 141 | |
| 146 | LABEL-19 audit RPC | 136, 139 | |
| 147 | LABEL-20 activity feeds | 136, 139 | |
| 148 | LABEL-21 project members | 136, 138, 139, 141, 146 | |
| 149 | LABEL-25 song reviews | 136, 141, 147 | |
| 150 | LABEL-22 org comments | 136, 139, 141 | |
| 151 | LABEL-23 tasks | 136, 139, 141, 144, 147, 149 | |
| 152 | LABEL-26 creative direction | 136, 139, 141 | |
| 153 | LABEL-27 parties + credits | 136, 141, 149 | extends `track_collaborators` (115, applied) |
| 154 | LABEL-41 artist ↔ label connection | 136, 139, 146 | |
| 155 | LABEL-28 split sheets | 136, 141, 149, 153 | |
| 156 | LABEL-29 samples declared | 141 | three columns on `tracks` |
| 157 | LABEL-30 approvals | 136, 141, 144, 149, 151 | |
| 158 | LABEL-42 store playback | 136, 144 | |
| 159 | LABEL-36 org search | 144, 153 | |
| 160 | LABEL-38 weekly digest | 136 | |
| 161 | LABEL-37 saved views | 136, 141, 144 | |
| 162 | LABEL-43 split_sheets grants | 155 | |
| 163 | LABEL-43 audit immutable | 136 | |
| 164 | LABEL-43 member read scope | 136, 139 | |
| 165 | LABEL-44 playlist same-owner | 141 | |
| 166 | LABEL-44 one artist per artist org | 136, 139 | |
| 167 | LABEL-44 release items lock + member CAS | 136, 139, 144, 146, 158 | replaces 158's and 146's functions |
| 168 | LABEL-45 search tokenization | 159 | |
| 169 | LABEL-46 overview seen per org | 136 | backfills from `user_profiles` |
| 170 | LABEL-47 entitlements + platform | 136, 138, 139, 146, 148, 151 | the owner then adds themself to `platform_admins` **by SQL** |
| 171 | LABEL-49 departments | 170 | |
| 172 | LABEL-51 org settings | 136, 143, 146 | |
| 173 | LABEL-53 recording metadata | 141 | columns on `tracks` |
| 174 | LABEL-54 parties payee | 153, 155 | |
| 175 | LABEL-55 release metadata | 144 | |
| 176 | LABEL-57 contracts | 139, 141, 144, 153, 170, 175 | |
| 178 | LABEL-60 signing | 176 | (177 does not exist) |
| 179 | LABEL-61 finance | 141, 153, 166, 170, 174, 176 | its header says "after 176 and 186" and uses 174's `labelos_looks_like_bank_number` and 166's `contacts.org_self_artist`; the file references nothing from 186 (scan), so 186 is a stale precaution, but the pastes in §7 apply 186 first anyway |
| 180 | LABEL-62 earnings | 153, 155, 176, 179 | **apply 179 and 180 together** (the org export assumes both) |
| 181 | LABEL-63 statements | 179, 180 | |
| 182 | LABEL-64 advances + close | 179, 180, 181 | |
| 183 | LABEL-65 marketing plans | 141, 144, 146 | |
| 184 | LABEL-66 press | 141, 144 | |
| 186 | LABEL-71 listing consent | 141, 144, 154 | (185 does not exist) |
| 187 | LABEL-73 atomic audit functions | 186 and the 136–176 set listed in §3 | **after 186**; most of the redefinitions in §3 |
| 189 | LABEL-48 first slice, `labelos_setup_org` | 136, 137 | |
| 190 | team accounts (doc 25) | 136, 139, 146, 148, 170 | `postgres` must be able to DELETE from `auth.sessions` (see §6) |
| 191 | PORTAL-UP contact uploads | applied ≤129 (`project_contacts`, `project_assets`, `contacts`) | not Label OS; independent of the rest |
| 192 | LABEL-48 setup wizard | 172, 189 | replaces 189's function and 172's |
| 193 | LABEL-56 release lifecycle | 144 (and 141's `labelos_track_is_finished`) | |
| 194 | LABEL-68 creative gate | 144, 146, 157, 171, 187 | sorts after 187 on purpose |
| 195 | LABEL-74/75 lifecycle guards | 147, 155, 170 | refuses `DELETE organizations` until `deleted_at` is 30 days old, see §5 |
| 196 | LABEL-76 `artwork_min_px` | 192 | |

## 5. Things that change behaviour when a migration lands

| Migration | Effect on existing data or tooling |
|---|---|
| 163 | Audit `activity_events` rows can never be UPDATEd or DELETEd, even by the service role. Only the org-row cascade and the actor's account deletion pass |
| 171 | Any member row that already lists the `finance` function gains `catalog.read`, `business.read.internal`, `finance.write` and `tasks.write` (the preset was empty before) |
| 170 | No `org_entitlements` row = everything the face allows, so nothing is narrowed. `platform_admins` has **no write path**; the owner inserts their own row by SQL |
| 195 | `DELETE FROM organizations` is refused until `deleted_at` is older than 30 days; 21 local checks and 137's rollback were changed to backdate first. Any ad hoc cleanup SQL must do the same. Also: the only owner of an org cannot delete their auth user; `activity_events` cannot be TRUNCATEd |
| 193 | The database keeps the old release arm until applied (a draft finishes its songs) while the routes already apply the stricter rule |
| 187 | Routes keep their previous path when a function is missing (PGRST202 / 42883). The members route's six-argument fallback is intentionally **kept**, so 167 may be missing |
| 192 | Drops `labelos_setup_org(uuid, text, text)` before creating the 4-argument form; a code version that still calls three arguments breaks. Deploy code that always sends `p_settings` |

## 6. Pre-flight for whoever applies

- Confirm `postgres` may `DELETE FROM auth.sessions` on production (190's `labelos_revoke_auth_sessions` answers false with a warning where it may not; the forced-reset flow then cannot end sessions).
- Do not apply 186 before 154, or 187 before 186. Do not apply 192 before 172 and 189, 194 before 187, 196 before 192.
- 187 replaces functions without changing their signatures. After it, `has_org_cap` is 187's text.
- None of 136–196 uses `CREATE TEMP`, `CONCURRENTLY` or `ALTER TYPE … ADD VALUE`, so the bundle's single `BEGIN; … COMMIT;` is valid, and no SQL-editor-form file under `supabase/apply/editor/` is needed for this range (the script refuses a TEMP-table migration without one; there is none here). The set is about 850 KB of SQL: paste in several parts (§7), each a prefix-closed chunk, rather than as one file.
- Run `npm run db:local:check` on the final tree first; it replays every migration twice, runs `supabase/local/checks/*.sql` (59 files), the race scripts under `supabase/local/races/` and the 58 rollbacks in `supabase/rollback/`.

## 7. Suggested pastes (prefix-closed)

| Paste | Numbers | Why a boundary here |
|---|---|---|
| 1 | 130–135 | The existing `pending.sql` |
| 2 | 136–161 | Original Label OS (phase 1) |
| 3 | 162–172 | Review hardening 162–169 and phase-2 accounts 170–172 |
| 4 | 173–176, 178, 186 | Metadata, parties, release fields, contracts, signing, listing consent. 186 is lifted ahead of 179 because 179's header asks for it; it only needs 141, 144, 154, so the early position is valid |
| 5 | 179–184 | Finance, marketing, press |
| 6 | 187 | The atomic audit family; needs 186 and 176 |
| 7 | 189, 190, 192, 193, 194, 195, 196 | Setup, team accounts, lifecycle, creative gate, guards, settings key |
| — | 191 | Independent; apply with the portal-upload code, any time after 129 |

The ledger's own wording (186 "ships in a later paste than 130–173 and 189–192"; 193 "second paste after go-live") fits this split if a first go-live paste ended at 173 plus 189–192. If the go-live branch already did that, continue from paste 4 for what it did not carry, still in numeric order.

## 8. Bundle script: does it need updating?

`scripts/ops/bundle-migrations.sh NNN [NNN …]` takes **migration numbers**, includes every file with that number, and **exits with "no migration numbered N"** for a number with no file. So `scripts/ops/bundle-migrations.sh $(seq 136 196)` fails at 177. Pass an explicit list that skips 177, 185 and 188:

```bash
scripts/ops/bundle-migrations.sh $(seq 136 176) $(seq 178 184) 186 187 $(seq 189 196) > part.sql   # not run
```

The same arguments split by §7 give the pastes. Two things the script does **not** do and a human must:

1. Its closing check is `supabase/apply/verify.sql`, which lists only 112–135 rows. It does not verify 136–196. A verify table for the range (one `to_regclass` / `to_regprocedure` / column probe per migration) does not exist and would be a new file. **Open follow-up for the owner's paste**, listed in `27-phase-2-report.md` §3.5.
2. It wraps everything in one `BEGIN; … COMMIT;`. That is fine for this range (§6) but means one failing file aborts the whole paste; fix the cause and run the whole part again.

`supabase/apply/pending.sql` should stay as it is (130–135). Its generator is the same script, so no change is needed there either.
