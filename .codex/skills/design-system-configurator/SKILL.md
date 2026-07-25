---
name: design-system-configurator
description: Use for keeping Beatstor's modular design system editable through central tokens, theme switching, component variants, player presets, cover presets, development preview panels, configuration export, documentation, and removal of scattered magic values.
---

# Design System Configurator

## Activation

Use for design-token files, theme configuration, component variant APIs, `/dev/design-system`, player/cover presets, documentation, and configuration export.

## Workflow

1. Add or edit central tokens before component-level styling.
2. Keep foundations, themes, presets, and component variants separate.
3. Prefer typed configuration objects over scattered constants.
4. Keep development preview routes protected and absent from public production navigation.
5. Document safe settings, accessibility-sensitive settings, and performance-sensitive settings.

## Checklist

- Colours, typography, spacing, radius, borders, shadows, motion, and breakpoints have central homes.
- Theme switching uses the same component hierarchy.
- Variant APIs avoid many unrelated booleans.
- Presets exist for player, waveform, artwork, and cover generator.
- Configuration export path is planned or implemented.

## Expected Output

Centralized config changes, preview/documentation updates, and a list of components still needing token migration.
