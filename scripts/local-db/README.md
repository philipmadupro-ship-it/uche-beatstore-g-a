# Local database stack — verification only

Runs the app against a **real** Postgres with every migration applied and
row-level security on, so a feature can be proven end to end without a
Supabase project. It is not a dev environment for production data and it is
never used by CI.

| Piece | Where | What it stands in for |
|---|---|---|
| `bootstrap.sql` | the database | Supabase's roles (`anon`, `authenticated`, `service_role`), `auth.users`, `auth.uid()` |
| `reset.sh` | the database | recreates it and applies **every migration twice** with `scripts/apply-migrations.sh` (the deploy runner), then `seed.sql` |
| PostgREST 12 (downloaded by `up.sh`) | `:3000` | Supabase's REST API — real SQL, real RLS, real JWT roles |
| `gateway.mjs` | `:54321` | the Supabase URL: `/rest/v1` → PostgREST, `/auth/v1/user` + `/token` from JWTs signed by `jwt.mjs` |
| `gateway.mjs` | `:54400` | Resend: records every email (`GET /emails`) |
| `env.sh` | your shell | points `next dev` at all of the above |
| `check.sh` | a throwaway server | `npm run db:local:check`: starts its own Postgres in a temp dir, runs `reset.sh` on it, then `supabase/local/checks/*.sql`, the `has_org_cap` parity check (`capability-parity.ts`) and every `supabase/rollback/*.down.sql`, and deletes it. Needs no server and no URL — run it before pushing any change under `supabase/` |

```bash
npm run db:local:reset                       # needs a Postgres superuser URL (LOCAL_DB_ADMIN_URL)
npm run db:local:up
source scripts/local-db/env.sh && npm run dev -- -p 3457   # second shell
npm run e2e:real-db
```

Not provided: realtime (the bell falls back to its poll), storage (tracks use
`/uploads/…` files the spec writes), Stripe. The JWT secret in `jwt.mjs` is
public on purpose — nothing but this local PostgREST accepts it.
