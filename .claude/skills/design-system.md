# design-system

## Visual identity

Dark warm premium studio aesthetic. Inspired by Soutter / aubergine / ink-on-bone.

| Token | Hex | Use |
|-------|-----|-----|
| `--bg-page` | `#0a0907` | Page background |
| `--bg-card` | `#14110d` | Card background |
| `--bg-hover` | `#16130e` | Hover state |
| `--accent` | `#D4BFA0` | Burnt amber — primary CTA, active states, brand |
| Text primary | `#E8DCC8` | Body |
| Text secondary | `#a08a6a` | Sub / hint |
| Text tertiary | `#6a5d4a` / `#3a3328` | Faded labels |
| Border | `#1f1a13` | Default |
| Border hover | `#2d2620` | Hover |
| Star / wishlist | `#c8a84b` | Gold |
| Free badge | `#6DC6A4` | Mint |

## Typography

- Body: Akira Expanded (`/public/fonts` — no CDN).
- Heading: Synkopy → `.font-heading` (page titles, H1).
- Mono labels: Panchang → `.font-mono` (metadata, 10px uppercase tracking-[0.2em]).
- **Never import from CDN — all three faces ship from `/public/fonts`.**

## Component philosophy

- No Radix, no Headless UI, no shadcn. Primitives are hand-rolled.
- `Dropdown` over `<select>`.
- `BatchActionBar` + `Set<string>` for bulk selection.
- `toast.*` / `confirmToast` from `useToast` for feedback.
- `Popover` (src/components/ui/Popover.tsx) for filter/action dropdowns with custom trigger + badge.

## Spacing and sizing

- Action buttons: 32px compact, 36px primary.
- Labels: 9-10px mono uppercase tracking-[0.2em].
- Cards: `rounded-2xl` with `border border-[#1f1a13]` and `bg-[#14110d]`.

## Motion

- `prefers-reduced-motion` MUST disable all non-trivial animation.
- Use `transition-colors` and `transition-opacity`; avoid layout-shift animations.

## Skill integrations

- `/high-end-visual-design` — when designing new UI from scratch; apply the "expensive agency" patterns from that skill (shadows, hover states, typography hierarchy) while keeping the warm dark palette.
- `/web-design-guidelines` — use for accessibility and best-practices audit before shipping new pages.
- `/ui-ux-pro-max` — use for research when choosing between layout approaches (table vs cards, drawer vs modal, etc.).
