# Authorization / service-role / IDOR audit

Companion to `RLS-AUDIT.md`. Where that one checks the database policies, this
checks the **application layer**: every `createServiceClient()` (which bypasses
RLS) and every public token/id route, for missing ownership enforcement.

**Method:** enumerate service-role call sites and public `[token]`/`[id]`
routes, then trace how each authorizes.

```bash
grep -rln "createServiceClient" src/app/api        # 87 call sites
# routes lacking a *literal* requireUser/requireRowOwnership:
for f in $(grep -rln createServiceClient src/app/api); do
  grep -q "requireUser\|requireRowOwnership" "$f" || echo "$f"; done
```

## Result: PASS (1 low-severity note)

The grep above is misleading on its own — most "unguarded" routes enforce
ownership **through the `lib/db` facade**, not by calling the helpers directly.
The audit's key finding is that service-role use is **systematically
fail-closed**:

### Dashboard routes — ownership via the facade
`tracks`, `projects`, `playlists`, their `[id]` variants, etc. go through
`getOwned` / `updateOwned` / `deleteOwned` / `scopedList` / `scopedSingle`:

- `getOwned/updateOwned/deleteOwned` call **`requireRowOwnership(table, id)`**
  before any service-role query (`src/lib/db.ts`).
- `scopedList` (`src/lib/db.ts:155`) is the important one:
  ```ts
  const { data: { user } } = await cookieClient.auth.getUser();
  const supabase = user ? createServiceClient() : cookieClient;   // ← key line
  if (user) q = q.or(`user_id.eq.${user.id},user_id.is.null`);
  ```
  Service-role is used **only when authenticated AND explicitly scoped by
  `user_id`**. When unauthenticated it falls back to the **RLS-enforced anon
  client**, which (per migration 010 owner-or-null policies) returns only
  null-owner rows — never another user's data. Fail-closed.

### Public-by-design routes — token / secret scoped
- `store/*` — public catalogue; `safeSellerId()` validates any interpolated id.
- `share/[token]`, `projects/share/[token]`, `store/projects/access/[token]` —
  resolve strictly by an unguessable token; route enforces password/role.
- `cron/*` — `Authorization: Bearer ${CRON_SECRET}`.
- `stripe/webhook` — Stripe signature. `resend/webhook` — Svix/secret.

### Fixed during this audit
- **`contacts/import`** parsed the uploaded file (vulnerable `xlsx`) *before*
  the auth check → unauthenticated parse/DoS surface. Auth moved above the
  parse. (commit `fix(security): auth before xlsx parse …`)
- **PII in logs** — `free-download` logged the raw buyer email; added shared
  `maskEmail()` and applied it there + in `orders`.

## Resolved (follow-up pass)

- **`GET /api/stems/[jobId]`** — FIXED. Added `authorizeStemJob()`: requires an
  authenticated user, then resolves `stems.track_id → tracks.user_id` and 403s
  on owner mismatch (null-owner legacy rows stay readable; jobs with no
  persisted row yet just require auth). Verified the authenticated producer
  still polls (404 for an unknown job, not 401).

## Dependency posture
`npm audit`: 14 advisories, all transitive to **`xlsx`** (prototype pollution +
ReDoS, no upstream fix on npm). Used only in producer contact import, now
strictly behind auth. CI gate is `--audit-level=critical` (passes). Revisit:
pin to the SheetJS CDN build or migrate to `exceljs` if untrusted xlsx upload
is ever introduced.

## Abuse / rate-limit coverage

`Sec-A` rate-limited the core money + telemetry endpoints. This pass added
`rateLimitDurable` to the remaining public **email-sender / Stripe-session /
comment** routes (the real abuse + cost vectors):

| Route | Limit | Why |
|---|---|---|
| `store/account/request` | 5/min/IP | magic-link email → inbox spam / Resend burn |
| `store/orders/resend` | 5/min/IP | re-sends delivery email → inbox spam |
| `store/comments/[trackId]` | 10/min/IP | public comment spam |
| `projects/share/[token]/comments` | 10/min/IP | public comment spam |
| `share/[token]/checkout` | 10/min/IP | mints Stripe Checkout sessions |
| `store/account/portal` | 10/min/IP | mints Stripe portal sessions (token-gated already) |

Verified live: `account/request` returns 200 ×5 then 429.

## Resolved — error-message leakage

FIXED. Public routes used to return `errorMessage(err)` (raw `err.message`,
which for a Supabase/Postgres error can include column/constraint names) on
their 500s. Added `lib/api-error.ts → publicError(err, status=500)`, which logs
the real detail server-side and returns a generic client message, then applied
it to the 500 catch-blocks across **30 store/share/projects-share routes**.
400/422 responses keep their intentional validation messages; dashboard
(owner-authenticated) routes are unaffected.
