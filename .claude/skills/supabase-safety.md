# supabase-safety

## Migration rules

- Migrations are append-only.
- Every migration must be idempotent.
- Use clear, chronological naming.
- End schema changes with `NOTIFY pgrst, 'reload schema';`.

## Security rules

- RLS is required for every owned table.
- Prefer owner-or-null read patterns where already established.
- Ownership must be verified before privileged operations.
- Service-role clients are allowed only after ownership checks succeed.

## Delivery rules

- Apply Supabase migrations before merging dependent code.
- Do not ship UI that assumes schema not yet deployed.
- Keep contracts and APIs aligned with schema changes.

## Agent checklist

- Is a migration required?
- Is it idempotent?
- Is RLS preserved or improved?
- Is ownership enforced in routes/actions?
- Are any service-role calls gated correctly?
