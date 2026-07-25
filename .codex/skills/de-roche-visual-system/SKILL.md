---
name: de-roche-visual-system
description: Use for Beatstor De Roche-inspired visual work: dark earth-and-stone palettes, semantic colour tokens, warm dark surfaces, beige accents, typography compatibility, material hierarchy, theme switching, restraint, contrast, and mobile visual QA.
---

# De Roche Visual System

## Activation

Use before changing Beatstor colours, typography, surfaces, cards, player visuals, cover treatments, or theme behavior.

## Workflow

1. Inspect `src/design-system/foundations`, `src/design-system/themes`, `src/app/globals.css`, and nearby UI before editing.
2. Keep primitive De Roche colours separate from semantic component tokens.
3. Preserve the existing Beatstor accent unless a documented accent study proves a better option.
4. Reserve spectral colours for audio information only.
5. Verify contrast and mobile readability before shipping.

## Checklist

- Warm carbon, charcoal, basalt, stone, beige, and bone dominate the UI.
- Components reference semantic tokens, not raw primitives, where practical.
- The result is darker and more mineral without becoming gothic, neon, or generic SaaS.
- Typography remains built around existing local fonts.
- Archive/light mode remains editorial, not plain inverted software.

## Expected Output

Token-aligned visual changes, any accent-study notes, contrast risks, and remaining components still using legacy hardcoded colours.
