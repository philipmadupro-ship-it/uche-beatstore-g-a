---
name: authentication-and-permissions
description: Use for Beatstor auth, protected routes, public routes, buyer access links, producer/admin role checks, sign-in, sign-out, password reset, session recovery, role-aware navigation, server-side authorization, and permission bugs.
---

# Authentication And Permissions

## Activation

Use for `src/proxy.ts`, `(auth)`, `(dashboard)`, store account pages, download access, share tokens, team/admin APIs, and any route where visibility or ownership matters.

## Workflow

1. Identify whether the route is public, tokenized public, buyer-access, producer-only, or admin-only.
2. Verify permissions server-side, not only by hiding UI.
3. Use `requireUser()` or `requireRowOwnership()` for owned producer data.
4. Keep buyer account/access-token behavior separate from producer auth.
5. Test unauthorized, wrong-owner, expired-token, and happy paths.

## Checklist

- Dashboard routes stay auth-gated.
- Store and share public routes remain intentionally public.
- Sensitive mutations verify user/owner/role on the server.
- Session expiry and access denied states are user-friendly.
- Logout does not leave inappropriate private playback or state active.

## Expected Output

Permission-safe route/UI change with explicit auth boundary and test coverage where risk warrants.
