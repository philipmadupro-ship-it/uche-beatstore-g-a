---
name: responsive-ui-engineering
description: Use for Beatstor responsive layouts across mobile, tablet, and desktop, including navigation, player overlap, filter drawers, tables, modals, safe areas, clipped text, horizontal overflow, and breakpoint verification.
---

# Responsive UI Engineering

## Activation

Use when changing layout, navigation, player placement, filters, tables, modals, cards, checkout, dashboards, or any mobile-facing surface.

## Workflow

1. Identify the smallest and largest affected containers.
2. Check breakpoints near 320, 375, 390, 430, 768, 1024, 1280, 1440, and 1728 px when practical.
3. Prefer layout constraints, wrapping, and stable dimensions over viewport-scaled typography.
4. Account for persistent player, mobile nav, sticky bars, and safe-area insets.
5. Use browser verification or screenshots for visual-risk changes.

## Checklist

- No horizontal overflow, clipped text, or overlapping controls.
- Tap targets remain usable.
- Filters are usable on mobile and desktop.
- Tables adapt or collapse intentionally.
- Modals fit the viewport and keyboard overlays do not break forms.
- Player controls remain usable at every size.

## Expected Output

Responsive implementation notes, breakpoints checked, issues fixed, and remaining viewport risks.
