---
name: qa-and-regression-testing
description: Use for Beatstor workflow testing, type checking, linting, unit/integration tests, Playwright/browser verification, console-error inspection, bugs found/fixed, remaining limitations, and regression coverage gaps.
---

# QA And Regression Testing

## Activation

Use after implementation, before commits/PRs, when fixing CI failures, or when touching auth, checkout, playback, upload, downloads, responsive navigation, or public APIs.

## Workflow

1. Identify critical workflows touched by the change.
2. Run focused tests first, then wider checks based on risk.
3. Use browser verification for UI, responsive, player, and checkout prep changes.
4. Inspect console errors when browser verification runs.
5. Record bugs found, bugs fixed, remaining limitations, and coverage gaps.

## Checklist

- Type check considered.
- Lint considered.
- Unit/integration tests run where relevant.
- Build run for App Router, import, or deployment-risk changes.
- Browser verification run for visual/interactive changes.
- Error recovery and protected/unauthorized paths checked for high-risk flows.

## Expected Output

Commands run, pass/fail status, bugs fixed, gaps, and residual risk.
