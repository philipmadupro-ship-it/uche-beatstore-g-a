---
name: accessibility-and-keyboard-navigation
description: Use for Beatstor accessibility, semantic elements, labels, form descriptions, error announcements, focus visibility, focus traps, Escape behavior, keyboard player controls, menus, contrast, reduced motion, sliders, progress controls, and heading hierarchy.
---

# Accessibility And Keyboard Navigation

## Activation

Use for forms, modals, drawers, menus, filters, player controls, checkout, upload, dashboard tables, interactive cards, and visual polish passes.

## Workflow

1. Identify all interactive elements and ensure they are buttons, links, inputs, or accessible custom controls.
2. Verify labels, descriptions, error messaging, focus order, and keyboard operation.
3. Check modal focus trap, Escape behavior, and focus restoration.
4. Confirm reduced-motion support and contrast.
5. Browser-test keyboard flow for high-risk UI.

## Checklist

- No clickable divs where a button or link is appropriate.
- Icon buttons have accessible names.
- Sliders/progress controls expose usable semantics.
- Focus is visible and not trapped accidentally.
- Errors are understandable and not raw API dumps.
- Heading hierarchy is coherent.

## Expected Output

Accessibility fixes, keyboard path verified, and any remaining limitations documented.
