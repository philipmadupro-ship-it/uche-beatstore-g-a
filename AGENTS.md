# Antigravity — Product Spec

Single-producer beatstore. The product is two things in one app:

1. A **private dashboard** the producer uses to write, store, organise, and sell music.
2. A **public storefront** buyers visit to discover, preview, and license that music — either one track at a time or as a whole project bundle.

Prod: `uche-beatstore-g.vercel.app`. Internal name: `antigravity`. One human user (the producer); everyone else is a guest visitor who may or may not become a buyer.

Engineering reference (stack, layout, conventions, gotchas, env vars): see **CLAUDE.md**. This document describes *what the product is*, not how it's built.

---

## Who uses it

- **The producer** (single account today). Uploads tracks, organises them into projects + playlists, picks which appear on the public storefront, sets prices and licenses, sends beats to artists, watches sales come in.
- **Guest visitors / buyers.** Browse `/store`, preview tracks, hit Buy. No account required. Email is the only identifier we capture, and only at checkout.
- **Recipients of share links.** When the producer DMs a beat to an artist, they get a `/share/[token]` or `/projects/share/[token]` URL. The page renders one of four "variants" depending on `recipient_kind`: client, producer, rapper, friend.

## The two product surfaces

### Dashboard (`/(dashboard)/*` — auth-gated)

The producer's workspace. Surfaces:

| Surface | Purpose |
|---|---|
| `/library` | Vault. Flat list of every track. List / Grid / Portfolio views. Filter, sort, batch-select, batch-delete. |
| `/library/[id]` | Single-track drawer: metadata, BPM/key analysis, tags, rating, waveform peaks, version history, comments. |
| `/projects` + `/projects/[id]` | Active production. Group tracks into projects, set BPM/key targets, add stems, add to public storefront as a bundle. |
| `/playlists` + `/playlists/[id]` | Curated sets for outreach — drag tracks into a playlist, share it, optionally feature on `/store`. |
| `/studio` | Sketchpad: groove loops, jam, record. |
| `/contacts` + `/contacts/[id]` | CRM: artists you send beats to. Status pipeline: sent → opened → interested → negotiating → placed / pass. |
| `/campaigns` | Outreach batches. Bulk-send a beat to a contact list. |
| `/calendar` | Releases, sessions, deadlines, meetings. |
| `/links` | Every share link you've ever generated (track + project). |
| `/store-editor` | Storefront WYSIWYG: hero image, bio, accent color, social links, license tiers, default prices, **featured playlists + projects** (drag to reorder, max 5 each), **beat listing toggle** (which tracks appear on `/store`). Includes a **Needs attention** panel listing beats that are store-listed but missing a cover / price / BPM+key. |
| `/sales` | Completed purchases — track licenses + project bundles merged. Stripe session deep-links, status pipeline. |
| `/analytics` | Plays, sales count, gross USD, 30-day sparkline, top-25 tracks leaderboard, recent activity feed. |
| `/profile` | The producer's identity. |
| `/settings` + `/settings/licenses` | Account + license-tier builder (the "License Builder" — name, price, file types, stems included, exclusivity, streaming/distribution limits, sync/broadcast rights, credit requirement). |
| `/offline` | Tracks cached for offline play. |

### Public storefront (`/store/*` — no auth)

Where buyers actually buy.

| Surface | Purpose |
|---|---|
| `/store` | Catalogue. Grid + List + Hero (`ParticleText` producer name). Cosmos-style scroll fade. Left sidebar with deep faceted search (sort, type, genre, mood, key, scale, BPM range, **price range (lease)**, duration buckets, free-only, **favorites only**, **new this week**). **Applied** chip cluster up top showing every active filter with one-click clear + "Clear all". |
| `/store/[id]` | Track detail. Hero waveform, license card grid (resolved server-side from `licenses` table → falls back to legacy `lease/exclusive_price_usd`), related strip, free-download CTA when enabled, **Share** button (Web Share API → clipboard fallback). |
| `/store/projects/[id]` | Project bundle detail. Cover, description, **Buy bundle** for the project's `price_usd`, track list (clickable through to track detail). |
| `/store/projects/access/[token]` | Post-purchase delivery for project bundles. Resolves a `project_access_links` row; lists all tracks with WAV + MP3 download buttons. |
| `/store/producer/[slug]` | Producer profile (Bandcamp-style). Bio, hero, all store-listed tracks, featured playlists, featured projects. Resolved by `creator_profiles.slug` or by slugifying `display_name` as fallback. |
| `/store/checkout` | Single checkout for both cart-mode (track licenses) and project-mode (`?project_id=…`). Email entry → Stripe embedded form. Promo code input (`?promo=CODE` deep-links). Sticky mobile total bar. Accepted-cards row + trust signals on the right. |
| `/store/download` | Post-purchase delivery for track licenses. Resolves a `license_purchases` row; signed R2 URLs for the bought files. |

### Public share (`/share/[token]`, `/projects/share/[token]`)

Tokenized link the producer DMs to an artist. The page renders one of four **variants** based on `share.recipient_kind`:

- **Client** — full audio + license card + buy button (gated on `share.sales_enabled`).
- **Producer** — collab vibe; surfaces stems + loops, less commerce.
- **Rapper** — emphasises lyrics + heatmap + sectional region comments. Region-pinned feedback (`region_start/end`) is the killer feature here.
- **Friend** — laid back, just listen.

Each variant lives in `src/components/share/variants/*` and consumes the same `/api/projects/share/[token]` shape.

---

## Core flows

### Producer: upload a track
Drag/drop file in `/library` → R2 multipart upload (`/api/upload/{init,part,complete,abort}`) → Essentia.js BPM + key extraction → AudD danceability + energy → row written to `tracks` with `audio_url`, peaks JSON, computed metadata → realtime channel (`useRealtimeTable`) refreshes the library.

### Producer: list a track for sale
`/store-editor` → Beat Listing section → toggle the track on (writes `tracks.store_listed=true`) → optionally set per-track lease / exclusive prices in `/library/[id]`. If no per-track override, the public store falls back to `creator_profiles.license_{lease,exclusive}_price_usd`.

### Producer: sell a whole project as a bundle
Open the project in `/projects/[id]` → Storefront card → set `description` + `price_usd` → in `/store-editor` → Featured Projects → drag to reorder + toggle on. The project then renders on `/store` as a `BandcampRemixCard`-style tile when listed alongside tracks, and on its own detail page at `/store/projects/[id]`.

### Buyer: license a track
`/store` → preview → add to cart → cart drawer (`useCart` Zustand, persisted) → checkout → email + optional promo → Stripe embedded form → webhook writes `license_purchases` (idempotent on `stripe_session_id`) → Resend email with `/store/download?session_id=…` link → buyer downloads MP3 (lease) or WAV + stems (exclusive).

Exclusive purchases delist the track (`store_listed=false`) so it can't be sold twice. The checkout route rejects exclusive purchases of tracks with neither `wav_url` nor a ready `stems_status`.

### Buyer: buy a project bundle
`/store/projects/[id]` → Buy bundle → `/store/checkout?project_id=…` → Stripe → webhook (`purchase_kind: 'project'`) writes a `project_access_links` row with a 24-byte hex token + frozen `amount_usd` from `session.amount_total` → email with `/store/projects/access/<token>` → buyer streams + downloads every track in the bundle.

### Buyer: redeem a promo code
Either type `?promo=CODE` in any `/store/checkout*` URL, or enter it in the cart drawer / checkout page. `/api/store/promo` validates against the `promo_codes` table (active flag, `expires_at`, `max_uses` vs `uses_count`, optional `seller_user_id` scoping). On checkout, the server distributes the discount across line items (percent → uniform per-line reduction; flat → proportional split; minimum unit_amount = $0.01 so Stripe doesn't choke).

### Producer: send a beat to an artist
`/contacts` → pick a contact → Send Beat modal → choose track + license tier + custom message → `/api/share` creates a `share_links` row (nanoid token) + `beat_sends` row (status='sent') → Resend email with `/share/<token>` → recipient opens, share variant renders based on `recipient_kind` → producer sees opens / plays / interest via `share_plays` table + `/analytics`.

### Producer: see what's selling
`/sales` lists every completed purchase (track license + project bundle, merged chronologically). `/analytics` aggregates plays per track from `share_plays`, sales count + gross from `license_purchases` + `project_access_links`, plots a 30-day sparkline, and shows the top 25 tracks by gross.

---

## Data model (the tables that matter)

```
tracks(id, user_id, title, type[beat|instrumental|song|remix], audio_url,
       wav_url, peaks_url, cover_url, duration_seconds, bpm, key, scale,
       loudness, danceability, energy, valence, acousticness, rating,
       description, lease_price_usd, exclusive_price_usd, store_listed,
       store_sort_order, free_download_enabled, stems_status, notes,
       created_at)

projects(id, user_id, name, cover_url, description, price_usd,
         store_featured, store_order, bpm_target, key_target,
         status, created_at)
project_tracks(project_id, track_id, position)
project_access_links(id, project_id, buyer_email, token, stripe_session_id,
                     amount_usd, expires_at, created_at)

playlists(id, user_id, name, cover_url, store_featured, store_order,
          created_at)
playlist_tracks(playlist_id, track_id, position)

creator_profiles(user_id, display_name, slug, bio, hero_image_url, credits,
                 license_lease_price_usd, license_exclusive_price_usd,
                 license_notes, accent_color, font_style, text_color_primary,
                 instagram_handle, twitter_handle, spotify_url,
                 soundcloud_url, website_url, contact_email)

licenses(id, user_id, name, description, price_usd, is_free, is_exclusive,
         file_types[], stems_included, streaming_limit, distribution_limit,
         commercial_rights, sync_rights, broadcast_rights, credit_required,
         sort_order)
track_licenses(track_id, license_id, price_override_usd, enabled)

share_links(token, user_id, track_ids[], recipient_kind, sales_enabled,
            expires_at, password_hash, plays, created_at)
share_plays(link_token, track_id, ip_hash, played_at)
project_shares(token, project_id, recipient_kind, sales_enabled, …)

contacts(id, user_id, name, email, role, label, instagram, notes,
         buyer_pipeline_status, created_at)
beat_sends(id, contact_id, track_ids[], share_token, message,
           status[sent|opened|interested|negotiating|placed|pass], sent_at,
           campaign_id)
campaigns(id, user_id, name, …)

license_purchases(id, seller_user_id, buyer_email, buyer_stripe_customer,
                  share_token, track_ids[], line_items, license_type,
                  amount_usd, stripe_session_id, stripe_payment_intent,
                  status[paid|refunded|disputed|failed], download_unlocked,
                  fulfillment_email_sent, created_at, updated_at)
promo_codes(code, seller_user_id, discount_percent, discount_amount,
            active, expires_at, max_uses, uses_count, created_at)
processed_stripe_events(event_id, processed_at)

track_tags(track_id, tag, category[genre|mood|instrument|status])
stems(track_id, job_id, status, vocals_url, drums_url, bass_url, other_url)
calendar_events(id, user_id, title, date, end_date, type, track_ids[],
                notes, color)
invites(email, role, token, expires_at, used_at)
team_members(user_id, role[owner|admin|collaborator], email, name)
rating_history(track_id, user_id, rating, rated_at)
```

RLS on every owned table. Service-role client (`createServiceClient()`) is only used in routes that have already verified ownership via `requireRowOwnership` / `requireUser`.

## Tag taxonomy

| Category | Examples |
|---|---|
| `genre` | Trap, Drill, Afrobeats, Amapiano, R&B, Hip-hop, Lo-fi |
| `mood` | Dark, Melodic, Aggressive, Chill, Emotional, Hype |
| `instrument` | 808s, Piano, Guitar, Strings, Synth, Vocal sample |
| `status` | Ready to send, Needs mix, Exclusive, Leased |

Both **genre** and **mood** are surfaced as separate facets on `/store`'s left sidebar. Instruments + status are dashboard-only.

## Design system

**Theme:** dark warm. Inspired by Soutter / Bacon / warm aubergine — "ink-on-bone inverted to warm near-black."

| Token | Hex | Use |
|---|---|---|
| `--bg-page` | `#0a0907` | Page background |
| `--bg-card` | `#14110d` | Card background |
| `--bg-hover` | `#16130e` | Card hover |
| `--accent` | `#D4BFA0` | Primary CTA, active state, brand |
| Text primary | `#E8DCC8` | Body |
| Text secondary | `#a08a6a` | Sub / hint |
| Text tertiary | `#6a5d4a` / `#5a5142` / `#3a3328` | Faded labels |
| Border | `#1f1a13` | Default |
| Border hover | `#2d2620` | Hover |
| Star rating | `#c8a84b` | Star gold (also wishlist heart) |
| Free badge | `#6DC6A4` | Mint, for free downloads |

**Type:** Akira Expanded (body, ships in `/public/fonts`), Synkopy (`.font-heading` — page titles), Panchang (`.font-mono` — metadata, labels). No CDN fonts. Labels: 10px mono uppercase `tracking-[0.2em]` text-`#6a5d4a`.

**Components:** no UI library. Primitives are hand-rolled (`Dropdown`, `BatchActionBar`, `useToast`, `confirmToast`, etc.). No Radix, no Headless UI.

**Motion:** `prefers-reduced-motion: reduce` MUST disable any nontrivial animation (vinyl spin, particle text, cosmos card fades, portfolio scramble text, smooth scroll).

## What we explicitly don't do

- No accounts for buyers. Email at checkout is the only identifier.
- No multi-tenant producer model (yet). Single `creator_profiles` row drives the store.
- No subscriptions. Every sale is a one-time payment.
- No Radix / Headless UI / shadcn. Primitives are hand-rolled.
- No CDN font imports. The three faces (Akira, Synkopy, Panchang) ship from `/public/fonts`.
- No nanoid in `useCart`. Item IDs are `${trackId}-${licenseId}-${ts}` strings.
- No JS smooth-scroll library. Cosmos feel comes from CSS `scroll-behavior: smooth` + `animation-timeline: view()` on `.track-masonry > *`.
- No client-rendered server data on `/store` that could be cached at the edge — `/api/store` sends `Cache-Control: public, s-maxage=30, stale-while-revalidate=60`.
