---
name: quiet-luxury-ui
description: Use for any visual restyling of Antigravity/Beatstor surfaces. The product owner's standing brief is that the UI is too busy and must become simpler, calmer, and more luxurious - Apple and Untitled UI restraint. Use when a request mentions the UI feeling cluttered, busy, cheap, "too much", or asks for a simpler, cleaner, more premium, more Apple-like look.
---

# Quiet Luxury UI

## Purpose

Restyle existing Antigravity surfaces toward Apple / Untitled UI restraint without changing
behavior. The master brief lives in `docs/design-direction.md` - read it before every pass and
treat it as the acceptance criteria.

## Required Context

- `docs/design-direction.md` - the seven principles, hard constraints, surface order, and the
  per-surface definition of done. This is the source of truth.
- `AGENTS.md` design-system section - existing tokens, fonts, and the motion rule.
- `.codex/skills/beatstor-design-system` - token vocabulary.
- `.codex/skills/responsive-ui-engineering` - breakpoint and tap-target rules.
- `.codex/skills/accessibility-and-keyboard-navigation` - what must survive a restyle.

## Workflow

1. Pick ONE surface from the ordered list in `docs/design-direction.md`. Never restyle two
   unrelated surfaces in a single pass - the log entry must be reviewable.
2. Count the current visual noise before editing: distinct text sizes, border colors, accent
   colors, radii, and shadow treatments visible at once. Record the numbers.
3. Apply the principles in order (reduction, typography, one accent, flatter surfaces,
   density, calm motion, one anatomy). Reduction first - deleting an element beats restyling it.
4. Re-count the same metrics. If a number did not go down, the pass did not reduce noise and
   needs another look.
5. Verify behavior is untouched: `npx tsc --noEmit`, focused `npx eslint <files>`, `npm test`,
   and `npm run build` before considering the surface done.
6. Append a `docs/codex-execution-log.md` entry with the before/after noise counts.

## Non-Negotiables

- Zero behavior, data, route, prop, or feature changes. This is CSS-class and markup-structure
  work only. If a change requires touching a handler, it belongs in a different pass.
- Every `aria-*` attribute, `role`, focus ring, keyboard handler, and >=40px tap target survives.
- No new colors, fonts, radii, or UI dependencies. Existing tokens only.
- `prefers-reduced-motion` continues to disable non-essential animation.
- Mobile must get calmer too, not just desktop.

## Common Noise Sources In This Codebase

- Stacked treatments: gradient bezel + border + ring + shadow on the same card.
- Decorative multi-accent tints (`#9d95e8`, `#D6BE7A`) used as category colors on cards and tiles.
- Micro-labels in mono-uppercase applied to headings and buttons rather than true metadata.
- Four or more text sizes inside one card.
- Duplicate metadata rendered both as a badge and as inline text.
- Blurred full-bleed cover backdrops competing with foreground content.

## Output

A single-surface diff, the before/after noise counts, the verification commands run, and the
log entry. Name the next surface in the ordered list as the follow-on.
