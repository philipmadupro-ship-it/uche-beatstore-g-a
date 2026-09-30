# 10 — Technical Architecture

**Discovery 01 · 2026-09-30**

## 0. Constraint check (brief §31 — no speculative architecture)

| Considered | Adopted? | Evidence |
|---|---|---|
| Microservices | **No** | One Next.js app on Vercel with Supabase already serves 171 routes. Nothing in Label OS needs independent deployment |
| Event bus / queue | **No** | Activity events are written inline in the mutating route (08 §B3). Background work uses the existing cron + `after()` pattern (`CLAUDE.md` Cron) |
| AI infrastructure / vector DB | **No** | All example searches are relational (08 §A2) |
| Workflow engine | **No** | Code-defined gates + per-org switches (09 §5) |
| New database | **No** | Postgres/Supabase with RLS supports pooled multi-tenancy ([Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)) |
| New auth system | **No** | Supabase Auth sessions reused; membership is data |
| New storage provider | **No** | R2 private/public buckets reused; new keys are org-prefixed |
| New framework / UI library | **No** | Hand-rolled primitives per `CLAUDE.md` |
| New npm dependencies | **None required for Phases 1–6** | See §7 |

---

## 1. Domain model

See `05-domain-model.md` and `domain-model.mermaid`.

## 2. Organization model

**Tenancy:** a pooled model. Every Label OS row carries `org_id`, and RLS plus application checks key on it. This is the standard B2B collaboration boundary, as opposed to user-level tenancy for private B2C data (research: [MakerKit](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices), [DEV — Supabase multi-tenant](https://dev.to/issuecapture/row-level-security-in-supabase-multi-tenant-saas-from-day-one-4lon)).

- **Users ↔ orgs:** many-to-many through `org_members`. One Supabase account can be the owner of a personal producer org, a member of Label L, and an external member of a project in Label M.
- **Artists independent of labels:** an artist *account* (user) is independent; an artist *record* is per org. An artist can have their own `producer`-kind (or future `artist`-kind) org for their own work. Decision **D1** covers whether an `artist` org kind ships in MVP. Recommended: not in MVP; artists use a personal org only if they sell beats.
- **Isolation:** `org_id` on every row, a same-org check on every FK (trigger), and route helpers that never accept an `org_id` from the body without re-authorizing it.
- **Ownership transfer:** the owner promotes another member to `owner`, then may demote themselves. The "≥1 owner" trigger prevents orphaning. Audited.
- **Leaving an org:** a member removes themselves (except the last owner). Their content stays, attributed. Their personal org is unaffected.
- **Deleting an org:** owner-only, soft delete (`deleted_at`) with a 30-day grace period, then a hard-delete cron that removes rows and `orgs/<org_id>/` objects. Decision **D10** covers the grace period.

## 3. Permission model

See `06-permission-model.md`. Implementation modules:

| Module | Kind | Purpose |
|---|---|---|
| `src/lib/labelos/capabilities.ts` | Pure, tested | Role + functions → capability set; the single source |
| `supabase/migrations/NNN_labelos_org_core.sql` | SQL | Tables, `has_org_cap` etc. mirroring the TS table |
| `src/lib/labelos/capabilities.sql.test.ts` | Test | Parses the migration's capability mapping and asserts equality with the TS module |
| `src/lib/auth/org-access.ts` | Server | `requireOrgCapability`, `requireObjectAccess`, `scopedOrgQuery` |
| `src/lib/security/api-gate.ts` | Existing, extended | `/api/org/*` → membership gate; everything else unchanged |
| `src/lib/security/rls-final-state.test.ts` | Existing, extended | Label OS tables: no policy without an `org_id` predicate; `approvals` / `activity_events` have no UPDATE/DELETE |

## 4. Music model

- **Songs above recordings; recordings are `tracks`.** The upload pipeline (`/api/upload/{init,part,complete,abort}`, `upload_sessions`, `upload_processing_jobs`, Essentia, peaks, preview) is reused unchanged except that `/complete` accepts an optional `org_id` + `song_id` + `kind`.
- **Org uploads must set `org_id` and must be authorised by `catalog.write` in scope**, not by `requireProducer`. `/api/upload/*` therefore needs an org-aware entry point. Recommended: a thin `/api/org/[orgId]/upload/*` wrapper that performs the org check and then calls the same `lib/storage` + `lib/upload` functions, so the producer routes are untouched (**ISOLATE**).
- **Private previews for org recordings** (decision D8): the preview derivative for an org recording goes to the **private** bucket and is streamed through an HMAC grant (the `share-media-token` pattern), not the public CDN path. Store previews are unaffected.
- **Versions:** file revisions stay in `track_versions`. Song-level version stacks are `song_recordings` rows of the same `kind` ordered by `added_at`, with `is_current`.

## 5. Collaboration model

| Need | Mechanism |
|---|---|
| Internal collaboration | Org membership + scope |
| External collaboration (contribute) | `project_members` (account-based) |
| External listening/feedback | Existing token shares (unchanged) |
| Comments | `comments` (org), region-pinned; `project_comments` remains for token shares |
| Concurrency | `If-Match: <updated_at>` on PATCH → 409 on mismatch; files append-only |
| Presence / realtime | **Not in MVP.** Optional later: Supabase realtime on `comments` (existing pattern in migration 012) |

## 6. Workflow model

See `09-release-and-legal-workflows.md`:

- Pure `song-stage.ts` (transitions), `legal-readiness.ts`, `release-readiness.ts`.
- Stored `approvals` (append-only, with snapshot) and `tasks`.
- Per-org switches in `organizations.settings` (validated by a Zod schema in `lib/contracts/`).

## 7. Activity model

See `08-search-and-activity.md` Part B:

- `activity_events`, append-only.
- `recordEvent` helper; audit verbs go through an RPC that performs mutation + event atomically.
- Pure `digest.ts` for grouping; notifications only for direct asks.

## 8. Search model

See `08-search-and-activity.md` Part A:

- Structured filters (pure) plus Postgres FTS (`simple` config) and identifier exact-match.
- No semantic search.

## 9. Storage model

| Class | Bucket | Key | Served by |
|---|---|---|---|
| Org recordings (masters, mixes, demos, stems) | Private | legacy `tracks/<nanoid>` via the existing pipeline; **new org uploads `orgs/<org_id>/audio/<uuid>.<ext>`** | Per-object check → stream / presigned (≤5 min) |
| Org previews + peaks | **Private** (D8) | `orgs/<org_id>/previews/…` | HMAC grant, 4h (existing TTL) |
| Artwork, photos, video | Private | `orgs/<org_id>/files/<category>/<uuid>` | Per-object check → presigned GET |
| Contracts, signed split sheets | Private, `sensitivity=restricted` | same | `contracts.read` + audited |
| Producer store assets | Unchanged | unchanged | unchanged |

Upload size limits reuse `multipart.ts` (5 MiB min part, 10,000 parts). Checksums: `sha256` stored on `files` for dedupe and integrity.

## 10. Integration model

Integrations are **exports and links**, not live sync, in MVP (see `02` §4 INTEGRATIONS):

| System | Direction | Mechanism | Phase |
|---|---|---|---|
| Distributors | Out | CSV/JSON metadata export (ERN-aligned field names) | 6 |
| Songtrust / PROs | Out | Writer/split CSV | 5 |
| E-signature | In/Out | Evaluate later; MVP = upload signed PDF | 5+ |
| Slack / Teams | Out | Incoming webhook: weekly owner digest | 7 |
| Chartmetric / DSP profiles | Link | URL fields on artist | 2 |
| Calendar | Out | ICS feed of release dates; reuse `calendar_events` | 6 |
| Accounting (Curve/Reprtoir/LabelGrid) | Out | Split export | 7+ |

**Package policy (brief §32):** no new dependency is needed through Phase 6. CSV is plain string building (as `lib/contacts/export.ts` already does); zip bundles need an evaluation (candidates `fflate` or `archiver`), done as part of LABEL-31 against the §32 checklist (maintenance, licence, runtime, bundle cost, security, existing equivalent). If rejected, the legal pack ships as separate presigned links.

## 11. API surface (namespacing)

```
/api/org                              GET my orgs · POST create
/api/org/[orgId]                      GET/PATCH settings
/api/org/[orgId]/members              GET · PATCH role/scope · DELETE
/api/org/[orgId]/invitations          GET · POST · DELETE (revoke)
/api/org/join                         POST accept (token)
/api/org/[orgId]/artists[/id]         CRUD
/api/org/[orgId]/songs[/id]           CRUD · /stage · /reviews · /recordings
/api/org/[orgId]/projects/[id]/members
/api/org/[orgId]/releases[/id]        CRUD · /items · /approvals · /deliver · /export · /legal-pack
/api/org/[orgId]/parties · /credits · /split-sheets
/api/org/[orgId]/files                POST (presign) · GET (presigned read)
/api/org/[orgId]/tasks · /comments · /activity · /search
/api/org/[orgId]/upload/*             thin wrapper over lib/storage + lib/upload
/api/org/[orgId]/audio/[trackId]      per-object audio (never the producer /api/audio)
```

Every route follows the repo conventions: Zod contract in `lib/contracts/`, `errorMessage(err)`, `createLogger('api.org.x')`, and the capability check before the service role.

## 12. Feature flag

`LABEL_OS_ENABLED` (server env) plus per-user enablement (a membership row). With the flag off, `/o/*` and `/api/org/*` return 404, so nothing is reachable in production until each phase's exit criteria pass. Same kind of switch as `ENABLE_LOCAL_STORE`.

## 13. Local-store fallback

**FACT (repo):** `src/lib/local-store.ts` provides a no-database fallback, and new owned tables must be added there (`.claude/skills/supabase-safety.md`). **RECOMMENDATION:** Label OS requires Supabase. With `isSupabaseConfigured()` false, `/api/org/*` returns 503 "Label OS requires a database". Mirroring multi-tenant RLS semantics in a JSON file store would be a second, untested authorization implementation.
