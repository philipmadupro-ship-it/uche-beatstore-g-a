# testing-release

## Testing priorities

Focus on product-critical flows first:

1. Auth and protected dashboard access.
2. Public storefront browse and filter behavior.
3. Track detail and project bundle detail behavior.
4. Checkout initiation and success/failure handling.
5. Post-purchase download and access flows.
6. Share links and variant rendering.
7. Library/project/store-editor regressions for producer workflows.

## Automated testing guidance

- Use Vitest for unit and integration logic.
- Use Playwright for user journeys and regressions.
- Prefer deterministic data/setup.
- Use stable selectors and avoid brittle UI coupling.

## Release checklist

- Verify affected happy paths.
- Verify at least one edge case.
- Verify auth boundaries for public vs protected routes.
- Verify mobile behavior for storefront-impacting changes.
- Verify no schema/code mismatch when data changed.
- Verify no regressions in checkout, share, or playback.
