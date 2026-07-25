---
name: antigravity-design-system
description: Use for Antigravity UI, CSS, layout, interaction, motion, accessibility, and visual polish across dashboard, storefront, share pages, cards, drawers, modals, filters, players, and responsive views.
---

# Antigravity Design System

## Visual Identity

Dark warm premium studio aesthetic: ink-on-bone inverted to warm near-black.

Core tokens:

- Page: `#0a0907`
- Card: `#14110d`
- Hover: `#16130e`
- Accent: `#D4BFA0`
- Primary text: `#E8DCC8`
- Secondary text: `#a08a6a`
- Tertiary text: `#6a5d4a`
- Border: `#1f1a13`
- Hover border: `#2d2620`
- Star/wishlist: `#c8a84b`
- Free badge: `#6DC6A4`

## Typography

- Body: Akira Expanded from `/public/fonts`.
- Page headings: Synkopy through `.font-heading`.
- Metadata labels: Panchang through `.font-mono`.
- Labels are usually 9-10px uppercase mono with `tracking-[0.2em]`.
- Never import fonts from a CDN.

## Components

- No Radix, Headless UI, shadcn, or generic UI library.
- Prefer existing hand-rolled primitives.
- Use `Dropdown` instead of raw `<select>` for styled controls.
- Use `BatchActionBar` plus `Set<string>` for batch selection.
- Use `toast.*` and `confirmToast` from `useToast` for feedback.
- Use lucide icons where an icon button is natural.

## Motion and Accessibility

- `prefers-reduced-motion: reduce` must disable nontrivial animation.
- Keep focus states visible.
- Avoid layout-shift animations.
- Avoid `window.scrollY` for fixed-positioned portal coordinates; viewport rects are already viewport-relative.
- Check mobile text wrapping and fixed bars carefully.

## Storefront Bias

Buyer-facing pages should feel premium and inspectable. Show actual beats, artwork, waveforms, prices, license clarity, and trust signals. Avoid landing-page filler when the user asked for a usable app surface.
