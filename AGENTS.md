# Antigravity — Product Spec

Single-producer beatstore. The product is two things in one app:

1. A **private dashboard** the producer uses to write, store, organise, and sell music.
2. A **public storefront** buyers visit to discover, preview, and license that music — either one track at a time or as a whole project bundle.

Prod: `uche-beatstore-g.vercel.app`. Internal name: `antigravity`. One human user (the producer); everyone else is a guest visitor who may or may not become a buyer.

Engineering reference (stack, layout, conventions, gotchas, env vars): see **CLAUDE.md**. This document describes *what the product is*, not how it's built.

---

## Who uses it

- **The producer** (single account today). Uploads tracks, organises them into projects + playlists, picks which appear on the public storefront, sets prices and licenses, sends beats to artists, watches sales come in.
- **Guest visitors / buyers.** Browse `/store`, preview tracks, hit Buy. No account required to purchase — email at checkout is still the only identifier a one-time buyer needs to give. Buyers who want a persistent library can optionally sign in (`/store/account`, magic link or Google) to get saved favorites, listening history, and custom playlists that follow them across devices — see "Buyer accounts" below.
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
| `/cover-art` | **Cover Art Studio.** Layer-based artwork editor — bring in your own images, generate one with AI, set type, build a collage, then export or attach it straight to a track / project / playlist / profile. See "Making cover art" below. |
| `/contacts` + `/contacts/[id]` | CRM: artists you send beats to. Status pipeline: sent → opened → interested → negotiating → placed / pass. |
| `/campaigns` | Outreach batches. Bulk-send a beat to a contact list. |
| `/calendar` | Releases, sessions, deadlines, meetings. |
| `/links` | Every share link you've ever generated (track + project). |
| `/store-editor` | Storefront WYSIWYG: hero image, bio, accent color, social links, license tiers, default prices, **featured playlists + projects** (drag to reorder, max 5 each), **beat listing** (which tracks appear on `/store`). Each beat row edits its cover, title and lease price in place, keeps the on/off toggle visible, and puts picks / free download / voice tag / license tiers / reorder / scheduling in one ⋯ menu. The **Needs attention** panel (listed beats missing a cover / price / BPM+key) filters the list to the affected beats so they can be fixed there. |
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
| `/store/orders` | Order lookup by email — sends a magic-link-style token so a buyer without a persistent account can still find a past purchase. |
| `/store/account` | Buyer sign-in — email magic link (Supabase OTP) or Google OAuth. Already-signed-in buyers redirect straight to `/store/account/me`. |
| `/store/account/[token]` | Legacy 24h signed-token delivery view (pre-dates persistent accounts) — still the link post-purchase emails point at. Looks up purchases by email only, no session. |
| `/store/account/me` | Persistent buyer account dashboard (session-gated). Purchases, listening history, favorites, and custom playlists that follow the buyer across devices — see "Buyer accounts" below. |

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

Uploads run in the persistent **Uploads tray**, which is mounted globally and survives navigation. Once a file finishes, its row **names and tags the track it just created, in the tray** — the moment the producer still knows what the file is. Without that, a beat lands in the library titled `beat_final_v3_140.wav` and fixing it means finding it again later. A row that finished without a track id (a `/complete` that returned nothing) shows no editor rather than one bound to nothing.

### Producer: list a track for sale
`/store-editor` → Beat Listing section → toggle the track on (writes `tracks.store_listed=true`) → optionally set per-track lease / exclusive prices in `/library/[id]`. If no per-track override, the public store falls back to `creator_profiles.license_{lease,exclusive}_price_usd`.

### Producer: sell a whole project as a bundle
Open the project in `/projects/[id]` → write the `description` inline in the header (it autosaves, and it is the same copy the bundle page shows) → set `price_usd` in the Storefront card → in `/store-editor` → Featured Projects → drag to reorder + toggle on. The project then renders on `/store` as a `BandcampRemixCard`-style tile when listed alongside tracks, and on its own detail page at `/store/projects/[id]`.

### Buyer: license a track
`/store` → preview → add to cart → cart drawer (`useCart` Zustand, persisted) → checkout → email + optional promo → Stripe embedded form → webhook writes `license_purchases` (idempotent on `stripe_session_id`) → Resend email with `/store/download?session_id=…` link → buyer downloads MP3 (lease) or WAV + stems (exclusive).

Exclusive purchases delist the track (`store_listed=false`) so it can't be sold twice. The checkout route rejects exclusive purchases of tracks with neither `wav_url` nor a ready `stems_status`.

### Buyer: buy a project bundle
`/store/projects/[id]` → Buy bundle → `/store/checkout?project_id=…` → Stripe → webhook (`purchase_kind: 'project'`) writes a `project_access_links` row with a 24-byte hex token + frozen `amount_usd` from `session.amount_total` → email with `/store/projects/access/<token>` → buyer streams + downloads every track in the bundle.

### Buyer: redeem a promo code
Either type `?promo=CODE` in any `/store/checkout*` URL, or enter it in the cart drawer / checkout page. `/api/store/promo` validates against the `promo_codes` table (active flag, `expires_at`, `max_uses` vs `uses_count`, optional `seller_user_id` scoping). On checkout, the server distributes the discount across line items (percent → uniform per-line reduction; flat → proportional split; minimum unit_amount = $0.01 so Stripe doesn't choke).

### Buyer accounts (persistent, opt-in)
A buyer can sign in at `/store/account` (Supabase magic-link OTP or Google OAuth — the same auth system the producer uses) to get a library that follows them across devices: favorited tracks, listening history (last 100 plays), and custom playlists built from anything free/previewable/licensed. All three are keyed on the buyer's **email**, not a producer-scoped `user_id` — there's exactly one producer, so no scoping is needed. Writes only ever happen through `/api/store/me`, which is the sole path into `buyer_favorites` / `buyer_listening_history` / `buyer_playlists` (RLS blocks direct PostgREST access; see migration 060). This coexists with — and is separate from — the older `/store/account/[token]` flow: a 24h signed token, no real session, used by post-purchase delivery emails to resolve "purchases for this email" without requiring sign-in. A buyer who signs in for a persistent account and a buyer using an old delivery-email token are not automatically the same "buyer" from the app's point of view today (no merge step).

### Producer: manage a project without leaving it

`/projects/[id]` is the project's command center, not a read-only view with an edit button. Editable in place, with no navigation and no modal: **title** (click it, Enter saves), **status** (a visible three-way segmented control), **tags** (pills you remove in one click; a popover to add), **target BPM** and **target key** (click the stat chip), **description** (autosaves — it is the storefront copy too, so there is one description, not two), **cover** (click the artwork), and every track's **title** and **rating** straight from its row.

The ⋯ menu holds only what is left, grouped by frequency and keyboard-navigable: the inline editors it can focus, then status, then cover/share, then Pin / Duplicate / Move to folders / Apply template, with Delete separated at the bottom. Duplicating copies the project's shape and its track list but never its `store_featured` flag — a copy should not appear on the public storefront by itself.

The same rules apply to playlists, to the project and playlist grid cards (rename edits the card's own title), and to the track details drawer, where the title and tags are now editable rather than sending the producer to `/library/[id]`.

`/links` follows them as well. A share row's title is its rename field and its ⋯ menu copies, shares, toggles downloads and deletes — copying a URL, the thing done most on that page, no longer starts by opening a detail popup. The popup is where the full URL, the track list, and the expiry/password settings live.

`/store-editor` follows them too. Its Beat Listing rows previously carried seven icon-only buttons and a line of copy telling the producer to open the beat in the Library to set a price — the one screen for deciding what sells could not set a price. Cover, title and lease price are now edited in the row; the on/off toggle stays visible because it is what the section is for; everything else is in the row's ⋯ menu. A blank price still means "inherit the profile default", which is not the same as free.

### Producer: make cover art
`/cover-art` opens the Cover Art Studio on a 3000x3000 artboard. Work is **autosaved** — covers live in IndexedDB (`antigravity-cover-art`), and the Files tab lists them for reopening, duplicating and deleting. There is no server-side storage of the document itself; only the flattened artwork is uploaded when you attach it.

Artwork is a stack of **layers** — `text`, `image`, `shape`, `texture`, `waveform` — each with position, size, rotation, opacity and a blend mode. Ways in:

- **Your own images** — upload, drag files onto the canvas, or paste from the system clipboard. Each image keeps its own aspect ratio, and every image layer has crop controls: fit (cover / contain / stretch), zoom, pan, corner radius, a mask (circle / arch / diamond) and a treatment (duotone / mineral / high-contrast / greyscale / bleach).
- **AI generation** — the AI tab, when an image provider is configured server-side (see CLAUDE.md for the env vars). The prompt always excludes lettering, because the studio composes real text layers on top.
- **Collage** — drop several images at once and a layout places them. Five layouts: grid, mosaic, filmstrip, stack, scatter. `Arrange all` / `Arrange selected` re-runs a layout over images already on the canvas.
- **Directions** — four art directions (Brutalist Archive, De Roche Mineral, Industrial Editorial, Spectral Night) that replace the whole layer stack with a themed template.
- **Waveform layers** — draw the track's real analysed peaks. Six shapes (bars, blocks, line, contour, circular, spectral) with controls for height, bar count, spacing, end caps, centre-or-baseline anchor, smoothing, normalised-vs-true levels, and colour. Hide or remove it outright from the same panel. Picking a track in the Source tab feeds its peaks into every waveform layer, and the source can be auditioned in place so the canvas reacts to the beat while you design. That reaction is preview-only and never baked into an export.

Finish by exporting a raster or SVG at one of the export presets, or **Upload → Set as cover** to attach the artwork to a track, project, playlist, or the producer profile.

### Producer: send a beat to an artist
`/contacts` → pick a contact → Send Beat modal → choose track + license tier + custom message → `/api/share` creates a `share_links` row (nanoid token) + `beat_sends` row (status='sent') → Resend email with `/share/<token>` → recipient opens, share variant renders based on `recipient_kind` → producer sees opens / plays / interest via `share_plays` table + `/analytics`.

### Producer: get told without watching the tab
Settings → Preferences → **Desktop notifications**. Switching it on asks the browser for permission and immediately fires a confirmation alert, so the switch proves itself rather than staying silent until the next sale. From then on, new notifications — sales, opened links — surface as OS notifications while a dashboard tab is open. Blocked in browser settings, the row says so instead of failing quietly. The choice is per device, because notification permission is granted per browser.

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

buyer_favorites(email, track_id, created_at)
buyer_listening_history(id, email, track_id, played_at)
buyer_playlists(id, email, name, created_at, updated_at)
buyer_playlist_tracks(playlist_id, track_id, position, added_at)
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

| Token | Value | Use |
|---|---|---|
| Page background | `#090907` | Behind everything |
| Card / panel | `#0D0D0A` | Raised surfaces |
| Text primary | `text-white/80` | Body |
| Text secondary | `text-white/60` | Sub / hint |
| Text tertiary | `text-white/40` | Labels, metadata |
| Text faint | `text-white/30` | Disabled, watermark |
| Border | `border-white/10` | Default |
| Border hover | `border-white/20` | Hover / emphasis |
| Mint | `#6DC6A4` | Free downloads, success, positive deltas |
| Tan accent | `#c8a47a` | Sparing brand warmth |
| Star gold | `#c8a84b` | Star rating, wishlist heart |

Text and borders are **white at alpha**, never warm hexes — that is what keeps the surface reading as black and silver rather than brown.

**Type:** Akira Expanded (body, ships in `/public/fonts`), Synkopy (`.font-heading` — page titles), Panchang (`.font-mono` — metadata, labels). No CDN fonts. Labels: 10px mono uppercase `tracking-[0.2em]` `text-white/40`.

**Components:** no UI library. Primitives are hand-rolled (`Dropdown`, `BatchActionBar`, `useToast`, `confirmToast`, etc.). No Radix, no Headless UI.

**Motion:** `prefers-reduced-motion: reduce` MUST disable any nontrivial animation (vinyl spin, particle text, cosmos card fades, portfolio scramble text, smooth scroll).

## What we explicitly don't do

- No *required* accounts for buyers — purchasing never demands sign-in, and email at checkout is still the only identifier a one-time buyer has to give. Persistent buyer accounts exist as an *opt-in* (see "Buyer accounts" above) for anyone who wants a saved library across devices, not as a purchase gate.
- No multi-tenant producer model (yet). Single `creator_profiles` row drives the store.
- No subscriptions. Every sale is a one-time payment.
- No Radix / Headless UI / shadcn. Primitives are hand-rolled.
- No CDN font imports. The three faces (Akira, Synkopy, Panchang) ship from `/public/fonts`.
- No nanoid in `useCart`. Item IDs are `${trackId}-${licenseId}-${ts}` strings.
- No JS smooth-scroll library. Cosmos feel comes from CSS `scroll-behavior: smooth` + `animation-timeline: view()` on `.track-masonry > *`.
- No client-rendered server data on `/store` that could be cached at the edge — `/api/store` sends `Cache-Control: public, s-maxage=30, stale-while-revalidate=60`.
