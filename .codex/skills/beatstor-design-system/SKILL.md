---
name: beatstor-design-system
description: Use for Beatstor visual language, theme tokens, typography, spacing, grids, borders, radii, elevation, motion, icon sizing, focus states, forms, skeletons, empty states, errors, and light/dark theme consistency.
---

# Beatstor Design System

## Activation

Use for new UI, visual refactors, page polish, navigation, cards, drawers, modals, filters, forms, and loading or empty states.

## Workflow

1. Read the existing theme in `src/app/globals.css`, `src/lib/theme/colors.ts`, and nearby components.
2. Reuse existing primitives in `src/components/ui` and store/dashboard components.
3. Define or reuse tokens before adding new hardcoded values.
4. Design for dense music discovery: useful metadata, compact controls, clear hierarchy.
5. Respect reduced motion and accessible contrast.

## Checklist

- Typography scale, spacing, containers, borders, radius, and elevation are consistent.
- Focus, hover, active, disabled, loading, empty, and error states exist.
- No excessive gradients, glassmorphism, random shadows, or giant generic dashboard cards.
- Mobile and desktop rhythm both work.
- No CDN fonts or external UI library added.

## Expected Output

Token-consistent UI changes and a short note on states, responsive behavior, and any new reusable component.
