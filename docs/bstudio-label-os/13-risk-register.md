# 13 — Risk Register

**Discovery 01 · 2026-09-30**

- **Likelihood / Impact:** L / M / H.
- **Owner** is a capability area, not a person, since staffing isn't known.
- Status is "Open" unless noted.

| ID | Risk | Category | L | I | Mitigation | Trigger / signal | Linked tasks |
|---|---|---|:-:|:-:|---|---|---|
| R-01 | **Masters readable by any privileged user.** `/api/audio` checks *who*, not *which*; its own comment says a second producer breaks it | Security | H (if ignored) | H | Per-object org audio route; no member streams until it ships; the producer route gets the same check before any second *producer* exists | A second non-buyer account exists in prod | LABEL-13 |
| R-02 | **Cross-org leak via service-role routes**: 147 route files bypass RLS; a missing `org_id` filter leaks | Security | M | H | `/api/org/*` namespace; `org-access` helpers; source-guard test (no `user_id` filters, helper required); two-org tests per route | A route test without a second org; a code review finding | LABEL-05, all route tasks |
| R-03 | **API gate widening** lets members reach producer routes | Security | M | H | Gate change limited to `/api/org/*`; a test enumerating existing producer prefixes | Any edit to `api-gate.ts` | LABEL-06 |
| R-04 | **Additive RLS policy on `tracks`/`projects` widens producer data** (OR-combined policies) | Security | L | H | Predicate requires `org_id IS NOT NULL`; replay test asserts it; producer rows stay NULL until M7 | Policy text change | LABEL-12 |
| R-05 | **Unreleased label music exposed via public-bucket previews** | Security | M | H | D8: private previews + HMAC grants for org recordings | Preview key under the public bucket for an `org_id` row | LABEL-14 |
| R-06 | **Invitation takeover / replay** | Security | L | H | 32-byte tokens, hashed; email binding; single use; expiry; rate limit; audit | Accept attempts with mismatched email | LABEL-08 |
| R-07 | **Buyer ↔ member confusion**: a buyer account treated as staff, or vice versa | Security | M | M | Membership is the only grant; buyer probes in tests; `requireProducer` unchanged | — | LABEL-05, LABEL-06 |
| R-08 | **RLS helper performance/recursion** on large tables | Performance | M | M | Security-definer STABLE helpers; `(select fn())` wrapping; indexes on membership; explain-plan check at 10k songs | Slow org list queries | LABEL-03 |
| R-09 | **Split arithmetic errors** (floats, rounding: 33.33×3) | Correctness / legal | M | H | `numeric(7,4)`; exact sum = 100.0000; the UI suggests the remainder line; never auto-rounds | Sum ≠ 100 | LABEL-28 |
| R-10 | **Approved, then changed.** Legal approves, then splits/credits/artwork change silently | Legal | M | H | Approval `subject_snapshot` → derived `stale` | Edits after approval | LABEL-30, LABEL-32 |
| R-11 | **Overstating readiness** ("82%" read as "mostly legal") | Product / legal | M | M | Gates key on blockers only; the % is display-only with named gaps; copy review | User feedback | LABEL-29 |
| R-12 | **Scope creep into workflow builder / chat / royalties / DDEX delivery** | Scope | H | H | Dangerous-scope list (`02` §4); every backlog item has "Out of scope"; any addition needs a new discovery | Requests for "custom stages", "channels" | All |
| R-13 | **Long-lived branch drift** from a very active `main` | Delivery | H | M | Weekly merge of `main`; Label OS in new directories; shared-file edits kept minimal | Merge conflicts in `proxy.ts`, `nav/model.ts`, `api-gate.ts` | All |
| R-14 | **Migration numbering collision** (has happened: 096–099, 117/118) | Delivery | M | M | Allocate at implementation; `git log --all -- supabase/migrations/`; register in `MIGRATIONS.md` | Two branches with the same number | All schema tasks |
| R-15 | **Migrations unapplied on prod** when code merges (repo rule: apply first; 112/115/116 currently not applied) | Ops | M | H | Each task lists its migration; the flag stays off until applied; routes return a clear 409/503 naming the migration (the `121_share_full_playback` precedent) | "Could not find column" | All schema tasks |
| R-16 | **Duplicate entities** with `main`'s Artist Workspace (#44): songs, artists, files, comments, credits | Product / engineering | H (materialised 2026-10-01) | H | `17-reconciliation` R1–R12; child-session prompt forbids those tables; backlog rewritten | A new table named like a #44 concept | LABEL-10–17, 22, 27 |
| R-17 | **Cross-org beat reuse** (D6) creates ambiguous ownership | Legal / product | M | M | MVP: copy-on-accept with provenance; no live cross-org references | — | LABEL-11 (flag), D6 |
| R-18 | **Contributor departure** (D3): who keeps uploads? | Legal / product | M | M | Default: the project's org keeps content; the contributor keeps attribution; product-owner decision | Producer disputes | LABEL-21, D3 |
| R-19 | **Notification fatigue** returns via "just one more" notification kind | UX | M | M | Direct-ask rule (`08` §B6) encoded in a closed union; tests forbid broadcast kinds | New notification kinds | LABEL-23 |
| R-20 | **Stale agent docs** (`.claude/skills/*` say ceiling 092) mislead future agents | Delivery | H | L | Update the skills in a separate housekeeping PR (OUT OF SCOPE here) | Agent picks migration 093 | — |
| R-21 | **Competitive claims second-hand** (egress blocked page fetches) | Research | M | L | Re-verify before external use; claims marked with sources | — | — |
| R-22 | **Invite email accessibility bug** (white text on a white button in `src/app/api/invite/route.ts`) | UX (existing) | H | L | Moot once `/join` replaces it; noted OUT OF SCOPE | — | LABEL-40 |
| R-23 | **GDPR-style erasure** across org data and audit logs | Compliance | M | M | Org deletion path; audit logs kept for org life, deleted with org; person erasure pseudonymises `actor_id` display | Erasure request | LABEL-39 |
| R-24 | **Local-store fallback divergence** | Engineering | L | M | Label OS requires Supabase (503 otherwise) | — | LABEL-06 |

## Highest-risk decisions (for the final report)

1. **Tenancy boundary = organization, pooled, with producer rows left user-scoped (`org_id IS NULL`) through the MVP.** Right for risk, but it defers M7, so for a while the producer's library and a label's catalogue are two worlds bridged only by copy (D6).
2. **Recordings are `tracks`.** It avoids duplicating the pipeline, but it couples Label OS to the most-read producer table (R-04).
3. **No workflow engine.** It will be challenged by the first label with an unusual process (R-12).
4. **Tokens never contribute.** A stricter rule than today's `editor` token role, and some producers may find account sign-up friction unwelcome (magic link mitigates).
