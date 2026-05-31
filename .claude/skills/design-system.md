# design-system

## Visual identity

Antigravity uses a dark, warm, premium studio aesthetic.

- Page background: near-black warm tone.
- Card background: deeper warm brown/black.
- Accent: burnt amber.
- Text hierarchy: warm cream primary, muted tan secondary, deeper brown tertiary.
- Borders: subtle warm dark separators.

## Typography

- Body font: Akira Expanded.
- Heading font: Synkopy via `.font-heading`.
- Mono labels: Panchang via `.font-mono`.
- Labels are often 10px mono uppercase with strong tracking.

## Component rules

- No external UI kits.
- Prefer dense but breathable spacing.
- Prioritize musician workflow clarity over generic SaaS patterns.
- Use `Dropdown` rather than plain `<select>` where consistent with current UI.
- Use `BatchActionBar` + `Set<string>` pattern for bulk selection.
- Use project toast utilities for feedback and confirmation.

## Interaction rules

- Playback and metadata should feel immediate.
- Storefront UI should remain cinematic but practical.
- Dashboard UI should feel like a control room, not a marketing site.
- Empty and error states should still feel premium and intentional.
