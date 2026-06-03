# product-context

## Product summary

Antigravity is a single-producer beatstore. Producer: Uche (U2C Beatstore).
Two surfaces:
1. Private dashboard — manage tracks, projects, playlists, contacts, campaigns, calendar, store, sales, analytics, profile, settings, offline.
2. Public storefront — browse, preview, and buy track licenses or project bundles.

Prod: `uche-beatstore-g.vercel.app`. 500–600+ contacts. Library of 100+ tracks.

## User model

- **Producer** — single authenticated operator.
- **Buyer/guest** — no account. Email captured at checkout only.
- **Share recipient** — tokenized public page, variant driven by `recipient_kind` (client, producer, rapper, friend).

## Core entities and their state (June 2026)

| Entity | Key fields added recently |
|--------|--------------------------|
| Tracks | `track_tags`, `stems`, `stems_status`, `store_listed`, `store_sort_order`, `wav_url` |
| Projects | `template`, `checklist` (jsonb), `pinned`, `project_tags`, `project_folders`, `project_folder_items` |
| Playlists | `pinned`, `playlist_tags`, `playlist_folders`, `playlist_folder_items` |
| Contacts | `crm_status` (prospect/active/engaged/cold/archived), `contact_tags`, `contact_segments`, `buyer_pipeline_status` |
| Beat sends | `email_resend_id`, `opened_at`, `link_clicked_at` (Resend open tracking) |
| Creator profile | `accent_color`, `font_style`, `dither_mode/color_mode/texture` (reverted — no dither now) |
| Licenses | full tier builder |
| Purchases | `license_purchases`, `project_access_links`, `promo_codes` |

## Dashboard surfaces (current)

- **Library** — list/grid/portfolio. Tags column, stems badge, bulk tag edit, smart playlists.
- **Projects** — tags, folders (multi-membership), checklist, templates, delivery pack, analytics, pin, recently-opened, drag-to-reorder tracks, copy share link.
- **Playlists** — tags, folders, pin, recently-opened, tag filter on track list, similar-tracks suggestion panel.
- **Contacts** — production-grade CRM table: paginated, sortable, inline stage editing, batch tag/stage, CSV export, tag filter chips, saved segments. Contact detail: stage, stats strip, track titles in timeline, nudge button.
- **Send modal** — rich track picker (rating, energy bar, "Sent before" badge), subject line, message templates (localStorage), personalised multi-recipient preview, unified email template.
- **Store editor** — cover art style selector (currently inactive/reverted), accent color, fonts, SEO, license prices, featured playlists/projects.

## Storefront

- `/store` — grid/list, sidebar facets, wishlist, cart.
- `/store/[id]` — track detail with license tiers.
- `/store/projects/[id]` — project bundle.
- `/store/checkout` — cart-mode and project-mode, promo codes.
- `/store/download` and `/store/projects/access/[token]` — post-purchase delivery.

## Current migration ceiling: 092

Latest applied migration: `092_contact_crm_status.sql`.
Next to be applied: any future migrations (093 was reverted with the dither work).
