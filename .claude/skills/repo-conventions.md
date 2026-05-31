# repo-conventions

## Stack

- Next.js 16 App Router
- TypeScript strict
- Tailwind
- Supabase Auth/Postgres/RLS
- Cloudflare R2
- Resend
- Stripe embedded checkout
- Wavesurfer
- Essentia
- React Query
- Zustand
- Zod
- Vitest
- Playwright

## Architecture

- Route code lives in `src/app/**`.
- Components are grouped by domain under `src/components/**`.
- Hooks live in `src/hooks/**`.
- Shared logic lives in `src/lib/**`.
- Middleware/proxy behavior lives in `src/proxy.ts`.
- Migrations live in `supabase/migrations/**`.

## API conventions

- One folder per resource under `src/app/api/**`.
- `route.ts` exports `GET`, `POST`, `PATCH`, or `DELETE`.
- Mutations are Zod-validated via `lib/contracts/`.
- Ownership checks use shared auth/ownership helpers.
- Errors return `{ error: string }` via normalized error handling.
- Use project logging helpers for server-side logs.

## UI conventions

- Warm dark theme.
- Hand-rolled primitives, no UI library.
- `Dropdown` over native `<select>` in project-standard places.
- Toasts via existing toast utilities.
- Reuse existing state and hooks before creating new patterns.

## Engineering style

- Make small, composable changes.
- Preserve naming consistency.
- Prefer extending existing systems over adding parallel ones.
