---
name: database-and-api-architecture
description: Use for Beatstor data modeling, Supabase migrations, API contracts, Zod validation, relationships, indexes, unique constraints, RLS, ownership, timestamps, status fields, audit fields, soft deletion, and privileged server operations.
---

# Database And API Architecture

## Activation

Use for schema changes, API routes, contracts, queries, indexes, ownership, local-store support, analytics events, and any sensitive server interface.

## Workflow

1. Use `repository-audit` for unfamiliar areas and `antigravity-supabase-safety` for migrations/RLS.
2. Define relationships, constraints, ownership, timestamps, and status fields before UI.
3. Add Zod contracts in `src/lib/contracts` for mutation input.
4. Validate and calculate sensitive values server-side.
5. Add indexes for list/filter/order queries and RLS lookup paths.

## Checklist

- Input schemas are strict.
- Client cannot set trusted price, ownership, role, purchase status, or download grants.
- API errors use safe messages.
- Owned tables are reflected in `src/lib/db.ts` and `src/lib/local-store.ts` when needed.
- Tests cover high-risk route or helper behavior.

## Expected Output

Schema/API design, migration notes, contract changes, route behavior, and validation/test results.
