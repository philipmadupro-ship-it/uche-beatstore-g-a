# Antigravity — Product Spec

Single-producer beatstore. The product is two things in one app:

1. A **private dashboard** the producer uses to write, store, organise, and sell music.
2. A **public storefront** buyers visit to discover, preview, and license that music — either one track at a time or as a whole project bundle.

Prod: `uche-beatstore-g-a.vercel.app`. Internal name: `antigravity`. One human user (the producer); everyone else is a guest visitor who may or may not become a buyer.

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
| `/library` | Vault. Flat list of every track. List / Grid / Portfolio views. Filter, sort, batch-select, batch-delete. **Browse** shows curated rows (WIP, Finished, each genre, In your store, Top rated…); a row's **See all →** opens All tracks with that row's filter and ordering applied. The Filters menu governs both views, and the view (Browse/All, filters, sort) lives in the URL, so a refresh or a bookmark keeps it. |
| `/library/[id]` | Single-track drawer: metadata, BPM/key analysis, **chord detection with MIDI download**, tags, rating, waveform peaks, version history, comments. |
| `/projects` + `/projects/[id]` | Active production. Group tracks into projects, set BPM/key targets, add stems, add to public storefront as a bundle. |
| `/playlists` + `/playlists/[id]` | Curated sets for outreach — drag tracks into a playlist, share it, optionally feature on `/store`. |
| `/studio` | Sketchpad: groove loops, jam, record. |
| `/cover-art` | **Cover Art Studio.** Layer-based artwork editor — bring in your own images, generate one with AI, set type, build a collage, then export or attach it straight to a track / project / playlist / profile. See "Making cover art" below. |
| `/contacts` + `/contacts/[id]` | CRM: artists you send beats to. A contact linked to a project (or given a portal) becomes an **artist workspace**: Overview · Projects · Beats · Songs · Files · Activity · Notes, with a relationship stage worked out from activity and one permanent portal. The **Artists** view shows every artist as a card. See "Producer: work with an artist" below. |
| `/campaigns` | Outreach batches. Bulk-send a beat to a contact list. |
| `/calendar` | Releases, sessions, deadlines, meetings. |
| `/links` | Every share link you've ever generated (track + project). |
| `/store-editor` | Two modes. **Design** is the visual storefront builder — a live multi-device canvas (desktop / tablet / mobile) showing the real storefront components with real data, plus a section stack, a per-section inspector with per-breakpoint overrides, a global theme panel, undo/redo and autosave. **Content** is the settings surface: hero image, bio, accent color, social links, license tiers, default prices, **featured playlists + projects** (drag to reorder, max 5 each), **beat listing** (which tracks appear on `/store`), promo codes, voice tags. Each beat row edits its cover, title and lease price in place, keeps the on/off toggle visible, and puts picks / free download / voice tag / license tiers / reorder / scheduling in one ⋯ menu. The **Needs attention** panel (listed beats missing a cover / price / BPM+key) filters the list to the affected beats so they can be fixed there. See "Arranging the storefront" below. |
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
| `/store/projects/access/[token]` | Post-purchase delivery for project bundles. Resolves a `project_access_links` row; lists all tracks with WAV + MP3 download buttons, and plays them (Play all, or any row) in the store's player bar. |
| `/store/producer/[slug]` | Producer profile (Bandcamp-style). Bio, hero, all store-listed tracks, featured playlists, featured projects. Resolved by `creator_profiles.slug` or by slugifying `display_name` as fallback. |
| `/store/checkout` | Single checkout for both cart-mode (track licenses) and project-mode (`?project_id=…`). Email entry → Stripe embedded form. Promo code input (`?promo=CODE` deep-links). Sticky mobile total bar. Accepted-cards row + trust signals on the right. |
| `/store/download` | Post-purchase delivery for track licenses. Resolves a `license_purchases` row; signed R2 URLs for the bought files. |
| `/store/orders` | Order lookup by email — sends a magic-link-style token so a buyer without a persistent account can still find a past purchase. |
| `/store/account` | Buyer sign-in — email magic link (Supabase OTP) or Google OAuth. Already-signed-in buyers redirect straight to `/store/account/me`. |
| `/store/account/[token]` | Legacy 24h signed-token delivery view (pre-dates persistent accounts) — still the link post-purchase emails point at. Looks up purchases by email only, no session. |
| `/store/account/me` | Persistent buyer account dashboard (session-gated). Purchases, listening history, favorites, and custom playlists (shown as **Projects**) that follow the buyer across devices — see "Buyer accounts" below. |

### Artist portal (`/artist/[token]`)

One permanent private link per artist. A small library of the projects the producer put in it — beats, songs, files, NEW markers since the artist's last visit, play, download where the project allows it, **♥ Interested / ✕ Pass** on each beat, a comment thread per beat and per project (a comment can be pinned to a moment in the beat), and a **Messages** tab: one conversation with the producer, where the artist can also **ask for something** and see when it is done. While it is open, new messages and comments appear by themselves, and new material shows a "New from <producer> · Show" bar. The producer can require **email sign-in**, so a forwarded link opens nothing without the artist's own inbox. No CRM, no editing, no store chrome, no checkout. Branded with the producer's name. Revoking it makes the link stop working; reissuing gives a new link.

### Public share (`/share/[token]`, `/projects/share/[token]`)

Tokenized link the producer DMs to an artist. The page renders one of four **variants** based on `share.recipient_kind`:

- **Client** — full audio + license card + buy button (gated on `share.sales_enabled`).
- **Producer** — collab vibe; surfaces stems + loops, less commerce.
- **Rapper** — emphasises lyrics + heatmap + sectional region comments. Region-pinned feedback (`region_start/end`) is the killer feature here.
- **Friend** — laid back, just listen.

Each variant lives in `src/components/share/variants/*` and consumes the same `/api/projects/share/[token]` shape.

Whatever the variant, the options the producer set are honoured on the page:
- **Playback** — **full track** (the default) or a **1:15 preview**, chosen per share. Rappers write to the whole beat; the 75 s clip is the storefront's, not the share's.
- **Downloads** — when allowed, every track has a Download button that saves the original file; when not, the page says downloads are off.
- **Password / expiry / revocation** — enforced on the page, the stream and the download.
- **Role** — commenters and editors get a "Leave feedback" / "Comment & edit" entry into the collaboration view (region-pinned comments, the editor); viewers do not.
- **For sale** — Buy buttons on the client variant only when `sales_enabled`.

---

## Core flows

### Producer: upload a track
Drag/drop file in `/library` → R2 multipart upload (`/api/upload/{init,part,complete,abort}`) → Essentia.js BPM + key extraction → AudD danceability + energy → row written to `tracks` with `audio_url`, peaks JSON, computed metadata → realtime channel (`useRealtimeTable`) refreshes the library.

The filename is read as metadata, not just a title: `Night Shift 140 Fm.wav` becomes the track *Night Shift* at 140 BPM in F minor. What the producer wrote wins over what the analyser detected, because a detector regularly halves a tempo or names the relative major. A name that says nothing is left alone, and the tray shows what was read so a wrong name is visible immediately. A name that says two things — two tempos, two keys — or whose "key" could just as well be a word (`BB gun`) is not guessed at: nothing from it is applied, the analyser's reading stands, and the tray offers each reading as a one-click choice, marking the one the analyser heard too. When a clear filename and the analyser disagree (140 in the name, 97 heard), the name still wins, but the tray says so and offers the analysed value in one click. Half- or double-time and relative major/minor are not treated as disagreements, since those are the analyser's usual slips. A value the producer sets there is never overwritten by the background analysis that finishes afterwards.

Uploads run in the persistent **Uploads tray**, which is mounted globally and survives navigation. Once a file finishes, its row **names and tags the track it just created, in the tray** — the moment the producer still knows what the file is. Without that, a beat lands in the library titled `beat_final_v3_140.wav` and fixing it means finding it again later. A row that finished without a track id (a `/complete` that returned nothing) shows no editor rather than one bound to nothing.

### Producer: get a track's chords as MIDI
Open a track in `/library` → the details drawer's **Asset Intelligence** section → **Detect chords**. Detection runs in the browser (usually well under a minute for a full track), then the drawer shows a compact timeline (`0:00 C · 0:04 Am · …`) and saves it on the track, so reopening the drawer shows it without re-running. **MIDI** downloads `<Title> - chords.mid`: one triad per chord around middle C, at the track's BPM (120 when unknown), so it lines up with the audio when dropped into a DAW at that tempo. Stretches with no confident chord are rests. A track where nothing confident is found says so rather than offering an empty file.

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
A buyer can sign in at `/store/account` (Supabase magic-link OTP or Google OAuth — the same auth system the producer uses) to get a library that follows them across devices: favorited tracks, listening history (last 100 plays), and custom playlists built from anything free/previewable/licensed. All three are keyed on the buyer's **email**, not a producer-scoped `user_id` — there's exactly one producer, so no scoping is needed. Writes only ever happen through `/api/store/me`, which is the sole path into `buyer_favorites` / `buyer_listening_history` / `buyer_playlists` (RLS blocks direct PostgREST access; see migration 060). This coexists with — and is separate from — the older `/store/account/[token]` flow: a 24h signed token, no real session, used by post-purchase delivery emails to resolve "purchases for this email" without requiring sign-in. Both views read the same email-keyed rows, so no merge step is needed: signing in with the email a purchase was made under shows that purchase, plus the same favourites, history and playlists the token page shows. The delivery page says so and links to sign-in, since its link expires and the account doesn't.

**My beats.** `/store/account/me` opens with the buyer's own library: every beat they own (a license, or a track of a bundle they bought) and every beat they have made an offer on, in one list with a status. It searches, filters (All / Owned / Requested), sorts (Newest, Title, BPM, Key) and plays through the store's player bar. A line under the heading says what their owned beats have in common — tempo range, most common key and type — worked out from what they own, never asked for. Ticking beats and pressing **Create project** makes a buyer playlist from them, which then lives under **Projects** on the same page (the buyer-facing word for a buyer playlist is *project*, including in the storefront's "Add to project" menu). A refunded purchase owns nothing. A beat the producer has delisted (an exclusive that sold) stays in My beats for its owner with an Open link to the delivery page **and Play**: the preview stream lets the signed-in owner hear the same public clip the storefront plays, never the master, and never anyone else. The "requested" rows are offers the buyer made **while signed in as themselves**; an offer sent without an account is still delivered to the producer but is stored as unverified and shows in nobody's My beats, so typing someone's address into the offer form cannot put an offer in their account.

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

### Producer: arrange the storefront

`/store-editor` → **Design**. The storefront is an ordered list of **sections** — hero, next-drop countdown, featured projects, featured playlists, spotlight, producer's picks, catalogue, trust badges — plus text / image / video / links / free-form canvas blocks you can add. Each section can be reordered, renamed, duplicated, locked, and shown or hidden **per device**.

The canvas is the real thing, not a mockup: it renders the same `ArtistBioBlock` and `BeatCard` components buyers see, at real device widths, with your real data. Sections with nothing in them say so rather than inventing placeholder content.

Responsive editing is genuine. Desktop is the base and changes there flow everywhere; switching to tablet or mobile and changing something writes an override for that device only, badged in the inspector with a one-click reset. The default layout ships one already — the hero draws the producer name as an animated particle canvas on desktop and as plain type on a phone, because the canvas is expensive and reads worse at 390px.

Two things are deliberately fixed. The **catalogue** and the **trust rail** are pinned to the bottom: the catalogue owns the sticky filter toolbar directly above it, and separating them produces a broken page. And a control only appears where the live storefront will honour it — the featured strips own their own responsive grids, so no column control is offered for them.

The text, image, video, links and canvas blocks a producer adds appear on the live `/store` exactly as the canvas draws them — the same component renders both. A block with nothing in it is left off the live page rather than showing the editor's "add content" hint. Videos are YouTube or Vimeo links (any of their usual URL shapes); other video hosts are refused in the editor too, because the storefront's security policy would block them. Images need an https address. Image and video sections have a **Size** slider (a share of the section's width, placed left, centre or right by Align), and their link is the first field in the inspector.

Work autosaves. A producer who never opens Design gets exactly the storefront they have today. Theme colours changed in Design apply to `/store` and the producer page. Accent and text left at the stock values use the colours set in Content, so opening Design to reorder sections never changes the colours. A saved change can take up to about a minute and a half to reach the public store, because the catalogue is edge-cached.

### Producer: work with an artist
A contact becomes an artist workspace the moment it is linked to a project: **Start workspace → New project for Artist #1**, add beats as usual, then **Share with Artist #1**. That puts the project in the artist's one permanent portal (created the first time) and sends one invite email. From then on nothing is a new link: a beat added to the project appears in the portal marked NEW on the artist's next visit. Adding material never emails anyone by itself — the **Notify · N new** button sends one digest of what the artist has not been told about yet, pointing at the same link.

In the portal the artist plays beats, downloads where the producer allowed it, and taps **Interested** or **Pass**. The producer gets a notification, and the artist's Beats tab shows it. The producer moves beats on from there — interested → selected → recording → recorded → released (or passed) — per artist, per beat; once the producer has moved a beat past interested, the artist's portal shows that word instead of the buttons. What the artist has *done* with a beat (sent, opened, played, downloaded) is worked out from activity and never typed in, and so is the relationship stage: new → contacted → engaged → interested → working together → released. Marking a contact cold or archived parks them without hiding where they really are.

**Files.** A project holds its own files — references, artwork, lyric sheets, split sheets — next to its tracks: drop them on the project page, rename them in place, and switch each one into or out of the portal. New files are visible to artists by default only when the project is already shared, so a contract dropped on a project never reaches a portal by accident. The artist opens or downloads them from a Files tab; the workspace's Files tab lists them with the WAVs and stems of the artist's tracks and says when the artist downloaded each one. A file put in the portal counts toward Notify like a new beat.

**Conversation.** In the portal the artist comments on a beat (optionally at the moment it is playing) or leaves a note on a project, where the project allows comments. The producer is notified, sees the thread in the workspace's Activity tab and answers there; the answer shows in the portal on the artist's next visit. The thread is between the two of them — other artists and share-link holders never see it.

**Messages and requests.** The workspace's Messages tab is one conversation with the artist, outside any project. What the producer writes appears in the artist's portal and is also emailed — unless the artist is on the portal right now, or already has an email about a message they have not read, so a run of messages is one email. The producer sees when a message was seen. An artist can ask for something ("something darker, around 140"), optionally about a project; open requests show at the top of the workspace and of the Messages tab, and marking one Done or Declined shows in the portal.

**Email sign-in.** In the portal menu, **Require email sign-in** makes the link open a "confirm it's you" screen. The artist asks for a sign-in link, which goes to the address on their contact (never one the visitor types), and opening it keeps that browser signed in for 30 days. Reissuing the link, or changing the artist's email, signs everyone out.

**Daily digest.** Notify stays a button by default. Turning on **Daily digest** for an artist hands that button to a once-a-day email: sent only when something is new, never more than once a day, and never on top of a Notify the producer pressed that day.

**Portals shaped by role.** Each contact still has one portal link, and it is shaped by their main role. An artist's portal is the one described above. A **producer's** portal puts loops first ("Loops & beats") and has **Ask for stems** on every track, which arrives as a request in the producer's Messages. A **label's** portal calls projects **Packs**, puts toplines and songs first, and opens each pack with the pitch the producer wrote for that label on the workspace's Projects tab (one pack can be pitched differently to two labels). What a portal holds, and what can be downloaded or commented on, is the same whatever its shape.

**A tab per role.** /contacts has **Artists · Producers · Labels & A&R · Other contacts**. A contact has a main role and can have one more ("Role: Artist · Also: Producer" on the contact page), and shows in the tab of each, badged with the other. Each tab puts first what that relationship is about: Artists keep the workspace cards (and list artists who have no workspace yet); **Labels & A&R** work the same way — a workspace and portal per label shown as cards, and labels without one listed underneath with the toplines, songs and packs sent and **Send toplines** / **Send a pack**; **Producers** show what loops and beats you have sent each one and the tracks you share credits on, with **Send loops**. Those buttons open the usual send flow already filtered to loops or toplines (one click clears the filter). Buyers, friends and everyone else stay under Other contacts.

**Finding things.** ⌘K search labels a song with its artist, finds project files, and marks which contacts are artists. Projects are found by what is inside them too: /projects and ⌘K match a track in the project, an artist on it, a tag or its description, and say which ("Track · MIDNIGHT", "with Nova"). A track's credits show one entry per person ("Nova · Feature, Collaborator") and fold past three people behind "+N more". A credit on a track can be linked to a contact, which puts the track in that artist's workspace, and a contact can have a photo.

**Linked material.** The pieces of one record are linked in the track drawer's **Linked** panel: a song to its beat, its instrumental and the loops it uses; a beat to its loops and a topline written on it; any track to an alternate version. Loop and topline are track types of their own. The panel sits under Asset Intelligence and lists recent tracks before anything is typed, the kinds that fit first; type part of a name — or a kind, like "loop" or "topline" — and click a result to link it; what it is (Beat, Instrumental, Loop, Topline, Version) is picked from its type and can be set by hand. Every link shows from both sides — a loop lists the beats and songs that use it. **Download all** gives one zip of the track and everything linked (WAV where there is one), with a README saying what each file is; **Share all** makes one share link of the set with downloads on; **Send to…** sends the set to a contact.

A song is a track of type song; its **Built on** list points it at the beats it was made on — the first is the main beat, any other can be made the main — and each beat's drawer lists the songs built on it. The track drawer's **People** section answers "who has this beat?" — each artist with the project it arrived through, their decision and how often they played it — and every row links through. The project page shows its artists in a strip with Share / Notify and a small decision pill per artist on each track row.

### Producer: send a beat to an artist
`/contacts` → pick a contact → Send Beat modal → choose track + license tier + custom message → `/api/share` creates a `share_links` row (nanoid token) + `beat_sends` row (status='sent') → Resend email with `/share/<token>` → recipient opens, share variant renders based on `recipient_kind` → producer sees opens / plays / interest via `share_plays` table + `/analytics`.

### Producer: get told without watching the tab
Settings → Preferences → **Desktop notifications**. Switching it on asks the browser for permission and immediately fires a confirmation alert, so the switch proves itself rather than staying silent until the next sale. From then on, new notifications surface as OS notifications while a dashboard tab is open. Eight things create one today: a completed purchase, a buyer's offer, a fulfilment alert, a comment an artist or client leaves on a shared project, an artist tapping Interested or Pass in their portal, an artist commenting in their portal, an artist's message, and an artist's request. Opened and clicked share links are *not* among them — the Resend webhook records `beat_sends.opened_at` / `link_clicked_at` but writes no notification row, so nothing about an open reaches the bell or the OS. Blocked in browser settings, the row says so instead of failing quietly. The choice is per device, because notification permission is granted per browser.

### Producer: see what's selling
`/sales` lists every completed purchase (track license + project bundle, merged chronologically). `/analytics` aggregates plays per track from `share_plays`, sales count + gross from `license_purchases` + `project_access_links`, plots a 30-day sparkline, and shows the top 25 tracks by gross.

---

## Data model (the tables that matter)

```
tracks(id, user_id, title, type[beat|instrumental|song|remix|loop|topline], audio_url,
       wav_url, peaks_url, cover_url, duration_seconds, bpm, key, scale,
       loudness, danceability, energy, valence, acousticness, rating,
       description, lease_price_usd, exclusive_price_usd, store_listed,
       store_sort_order, free_download_enabled, stems_status, notes,
       beat_track_id,  -- a song's main beat (song_beats holds all of them)
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
                 store_layout,  -- section layout + theme; NULL = default layout
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
project_shares(token, project_id, contact_id, recipient_kind, sales_enabled, …)
project_comments(project_id, track_id, author_name, body, parent_id,
                 region_start, region_end, share_token,
                 contact_id)   -- set = an artist's portal thread

contacts(id, user_id, name, email, role, label, instagram, notes,
         category, secondary_category,   -- main role + one extra (tabs on /contacts)
         buyer_pipeline_status, avatar_url, created_at)
project_assets(id, project_id, user_id, kind[reference|artwork|lyrics|document|audio|other],
               label, file_name, url, mime, size_bytes, position, in_portal,
               portal_at)                                           -- project files
project_contacts(project_id, contact_id, user_id, role, in_portal,
                 allow_downloads, can_comment, last_notified_at)   -- artist ↔ project
contact_track_states(contact_id, track_id, project_id, decision,
                     set_by[producer|artist])                     -- artist ↔ beat decision
artist_portals(contact_id UNIQUE, token, password_hash, revoked_at,
               last_viewed_at, previous_viewed_at, view_count, auto_digest,
               require_sign_in, sign_in_sent_at)
artist_messages(contact_id, project_id, author[producer|artist],
                kind[message|request], body, request_status[open|done|declined],
                read_at, emailed_at)                              -- one thread per artist
song_beats(song_track_id, beat_track_id, position)                 -- a song's beats, main = 0
track_links(from_track_id, to_track_id, relation[instrumental|loop|topline|version],
            position)                                              -- the rest of a record's pieces
beat_sends(id, contact_id, track_ids[], share_token, message,
           status[sent|opened|interested|negotiating|placed|pass], sent_at,
           campaign_id)
campaigns(id, user_id, name, …)

license_purchases(id, seller_user_id, buyer_email, buyer_stripe_customer,
                  share_token, track_ids[], line_items, license_type,
                  amount_usd, stripe_session_id, stripe_payment_intent,
                  status[paid|refunded|disputed|failed], download_unlocked,
                  fulfillment_email_sent, created_at, updated_at)
buyer_offers(id, seller_user_id, track_id, buyer_email, buyer_email_verified,
             offered_price_usd, status)   -- verified = made while signed in as buyer_email
promo_codes(code, seller_user_id, discount_percent, discount_amount,
            active, expires_at, max_uses, uses_count, created_at)
processed_stripe_events(event_id, processed_at)

track_tags(track_id, tag, category[genre|mood|instrument|status])
track_collaborators(track_id, name, role, source, contact_id)
stems(track_id, job_id, status, vocals_url, drums_url, bass_url, other_url)
calendar_events(id, user_id, title, date, end_date, type, track_ids[],
                notes, color)
invites(email, role, token, expires_at, used_at)
team_members(user_id, role[owner|admin|collaborator], email, name)
rating_history(track_id, user_id, rating, rated_at)

buyer_favorites(email, track_id, created_at)
buyer_listening_history(id, email, track_id, played_at)
buyer_playlists(id, email, name, created_at, updated_at)   -- shown to the buyer as "Projects"
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
