# Antigravity Launch-Readiness Audit

Date: 2026-06-16
Scope: launch/security readiness for uploading 500-600 real beats, with store, library, projects, playlists, checkout, storage, RLS, and competitor workflow review.

## Implementation Update — 2026-06-23

The UI/UX master plan and most application-layer security/commerce work are now implemented. The app builds successfully and all automated tests pass. This does **not** yet remove the inventory freeze for 500-600 valuable masters because the remaining blockers are storage and scale infrastructure, not page UI.

### Verification snapshot

- Production build: passed (`next build`, 53 static pages plus dynamic routes).
- TypeScript: passed.
- Tests: 286/286 passed across 45 files.
- Live checks:
  - `/store`: 200
  - `/store/orders`: 200
  - `/api/store`: 200
  - `/api/links` without producer auth: 401
  - `/api/audio` without producer auth: 401
  - `/api/upload/init` without producer auth: 401
  - `/api/events` without producer auth: 401
  - `/store-editor` without producer auth: redirects to `/login`
- Recursive `/api/store` inspection: zero raw audio URLs and zero WAV/stem URLs, including featured playlist/project tracks.

### Completed phases

**Phase 1 application boundary**

- Public catalogue, track, playlist, project, and producer APIs return scoped preview URLs rather than raw media URLs.
- Featured collection tracks are redacted recursively.
- Generic `/api/audio` proxy requires producer authentication.
- Share creation and upload routes require authenticated ownership.
- Share playback uses short-lived signed token/track grants, including private unlisted shares.
- Share downloads verify token membership, expiry/revocation, download permission, and share password.
- Paid delivery and project access stream through entitlement-checked endpoints.
- Dashboard routes and sensitive event/link APIs are auth-gated.
- Migrations 096 and 097 lock share enumeration and legacy null-owner mutation down once applied.

**Phase 2 commerce correctness**

- Stripe durable purchase/access writes happen before an event is marked processed.
- Critical fulfillment is awaited.
- Project checkout rejects unlisted projects.
- Exclusive purchases can enter a persisted stems-pending state.
- Promo use is consumed on paid fulfillment, not abandoned checkout creation.
- Order recovery requires authenticated/tokenized access.
- Custom license UUIDs, inherited tier prices, file types, stems rights, and exclusivity persist from product page through checkout, webhook, delivery, and download.
- Delivery no longer grants WAV/stems merely because a purchase headline says “exclusive.”

**Phase 4 conversion UX**

- Dynamic daily sales spotlight, Producer's Picks, commerce-native project bundle card, trust rail, license chooser, and secure order/account entry points are implemented.
- Producer's Picks and Daily Pick were reduced to supporting content rather than dominating the catalogue.
- Store/profile identity fonts are preserved; small utility typography uses locally hosted Inter.
- Track comments post correctly and timestamp buttons seek playback.
- Store filtering includes search/type in the applied-state contract.

**Phase 5 dashboard workflow**

- Library is mobile list-first with lightweight rows and sheet filters.
- Projects and Playlists remain visual cover-art grids with automatic folder mosaics.
- Project checklist is collapsed and secondary; storefront controls are lower in the page.
- Playlist detail is more compact on mobile.
- Store Editor starts collapsed, has touch-accessible ordering, and price readiness respects license tiers/defaults.
- Campaigns is a real index/detail workflow; project sends are campaign-tracked and funnel status derives from actual sends.
- Links combines track and project shares with correct public paths and owner scoping.
- Studio, Sales, project/playlist filters, folders, and creation/upload flows received the planned mobile/productization pass.

### Remaining launch blockers

1. **Private storage and derivative previews**
   - Implemented for new uploads in migration/code 098: masters/WAV/stems use opaque private `r2://` references; upload generates a 96 kbps public MP3 derivative; storefront playback prefers only `preview_url`.
   - Production upload fails closed unless `R2_PRIVATE_BUCKET_NAME` is configured.
   - Still required before inventory launch: apply migration 098, create the private bucket, provide ffmpeg in the production runtime or move derivative generation to a worker, and migrate/re-upload legacy public masters. Legacy public rows remain supported temporarily and are not made private by this code change alone.

2. **Serverless-safe bulk upload**
   - Implemented in migration/code 099: multipart state persists in owner-scoped Supabase rows and survives serverless invocation changes.
   - Browser chunks upload directly to private R2 through 15-minute signed part URLs; the app receives only ETags and byte counts.
   - Completion reconciles against R2's authoritative part list and exact final-part size is enforced.
   - Implemented in migration/code 100: upload completion now enqueues analysis/peaks/preview generation into `upload_processing_jobs`; `/api/cron/process-uploads` processes queued work outside the upload request.
   - Still required: apply migrations 099/100, expose `ETag` in private-bucket CORS, and migrate/reprocess legacy public masters.

3. **600-beat request scale**
   - Store and dashboard catalogue routes remain whole-catalog-first.
   - Add cursor pagination, server-side filters/facets, lean search endpoints, aggregate play counts, virtualized rows, debounced realtime invalidation, and bulk reorder APIs.

4. **Durable fulfillment outbox**
   - Purchase state is durable, but email delivery still needs a persisted `pending/sent/failed` outbox with retries for both track and project purchases.

5. **Deployment operations**
   - Review and apply migrations 096/097 after assigning any legitimate legacy null-owner rows to the producer.
   - Decide whether persistent buyer accounts are an intentional product change; the current implementation exceeds the original no-buyer-account spec.

### Current release decision

The refactor is ready for continued testing with placeholder or non-sensitive inventory. Do not upload the full valuable 500-600 beat catalogue until the five infrastructure items above are complete, especially private derivative previews and durable direct-to-R2 upload.

## Method

This pass used six parallel read-only workstreams plus local validation:

- Public store/share/download beat protection
- Upload, R2, and storage protection
- Supabase RLS and service-role exposure
- Stripe, checkout, promo, and delivery correctness
- Scale/performance for 500-600 beats
- Store UX and product conversion

The dashboard workflow and competitor-gap workstreams were covered locally because the agent pool was full. Validation is static code-tracing against current source. I did not run destructive checks, live Stripe transactions, or production Supabase probes.

## Verdict

Do not upload 500-600 valuable beats yet.

The app is close as a private creative dashboard, but the public commerce boundary is not ready for real inventory. The biggest issue is not UI. It is that public routes and client state expose raw audio, WAV, and stem URLs, while upload and share paths still allow several unauthenticated or weakly scoped behaviors. If someone inspected the page or API traffic today, they could likely collect protected audio assets.

## P0 Launch Blockers

### 1. Public media URLs leak protected beats

Public catalogue and related store APIs return raw media fields. `/api/store` selects `audio_url` for every listed beat and enriches `wav_url`, then returns both in `safeTracks`.

Evidence:

- `src/app/api/store/route.ts:112` selects public tracks.
- `src/app/api/store/route.ts:116` includes `audio_url`.
- `src/app/api/store/route.ts:391` fetches `wav_url`.
- `src/app/api/store/route.ts:408` builds returned track objects.
- `src/app/api/store/route.ts:412` attaches `wav_url`.
- `src/app/api/audio/route.ts:10` accepts `?src=` or `?key=`.
- `src/app/api/audio/route.ts:39` only checks that the host matches R2.
- `src/app/api/audio/route.ts:81` caches non-download responses publicly.

Attack path:

1. Guest opens `/store`.
2. Browser fetches `/api/store`.
3. Response contains audio/WAV URLs.
4. Guest saves URLs or calls `/api/audio?src=...`.
5. Files remain accessible outside checkout.

Decision: reportable, launch-blocking.

Required fix:

- Make R2 private.
- Split public preview assets from masters.
- Never return `audio_url`, `wav_url`, or stem URLs from public JSON.
- Public playback must use short-lived, scoped preview endpoints.
- Paid downloads must validate purchase/token on each request, then stream or issue short-lived signed URLs.
- Remove public arbitrary `?src=` / `?key=` proxy behavior from `/api/audio`.

### 2. Upload APIs allow unauthenticated or weakly scoped storage writes

Multipart upload init attempts to read the user but continues with `userId: null` when no user is present. Part/status/abort/complete routes then use only a bearer `sessionId`, not the authenticated owner.

Evidence:

- `src/app/api/upload/init/route.ts:62` initializes `userId` as nullable.
- `src/app/api/upload/init/route.ts:66` only attempts `getUser()`.
- `src/app/api/upload/init/route.ts:86` initializes multipart upload.
- `src/app/api/upload/init/route.ts:89` creates an upload session with nullable owner.
- `src/app/api/upload/part/route.ts:19` trusts `x-session-id`.
- `src/app/api/upload/part/route.ts:29` loads the session without checking caller ownership.
- `src/app/api/upload/part/route.ts:37` accepts arbitrary part bytes.
- `supabase/migrations/010_scope_rls_to_owner.sql:25` allows `user_id IS NULL` track access.

Attack path:

1. Anonymous caller starts a multipart upload with a plausible audio filename.
2. R2 upload is created before hard producer authentication.
3. Caller uploads large/arbitrary chunks.
4. Complete path can leave R2 objects, null-owner rows, or orphaned objects depending on downstream failure.

Decision: reportable, launch-blocking.

Required fix:

- Require authenticated producer for every audio upload route.
- Validate ownership before R2 object creation, especially `replaceTrackId`.
- Bind upload sessions to user id and enforce it on part/status/abort/complete.
- Enforce part number, cumulative size, expected chunk size, and content sniffing.
- Move upload session state out of process memory before large backfills.

### 3. RLS and share policies expose private-token data

`share_links` has a public select policy from the initial migration, and the later owner policy does not drop it. Legacy share creation also writes with service role even when no user is authenticated and does not verify ownership of `track_ids`.

Evidence:

- `supabase/migrations/001_init.sql:202` creates `share_links FOR SELECT USING (true)`.
- `supabase/migrations/010_scope_rls_to_owner.sql:146` adds owner/null-owner access without dropping the public read policy.
- `src/app/api/share/route.ts:87` reads user but does not require one.
- `src/app/api/share/route.ts:91` inserts via service role.
- `src/app/api/share/route.ts:93` writes `user_id: user?.id || null`.
- `src/app/api/share/[token]/download/route.ts:97` grants downloads from share-level `allow_downloads`.
- `src/app/api/share/[token]/download/route.ts:131` then fetches the requested `track_id`, without proving that track belongs to the share for normal share tokens.

Attack path:

1. Guest or low-trust caller creates or discovers a share token.
2. Token can expose track and stem metadata.
3. If downloads are enabled, a caller can request a different guessed `track_id`.

Decision: reportable, launch-blocking.

Required fix:

- Drop public select policies for share tables.
- Use service routes for token lookup, scoped by token only and with redacted fields.
- Require authenticated producer for share creation.
- Verify every shared track belongs to the owner and to the token.
- Check `revoked_at` and `expires_at` consistently for read and download routes.

### 4. Commerce fulfillment has durable-state hazards

The webhook inserts `processed_stripe_events` before durable purchase/access writes. If a later write fails, Stripe retries can be skipped as duplicates. Critical post-payment work is also started with `void runFulfillment(...)`, so serverless freeze can drop state transitions and email work.

Evidence:

- `src/app/api/stripe/webhook/route.ts:587` inserts processed event first.
- `src/app/api/stripe/webhook/route.ts:600` skips duplicates.
- `src/app/api/stripe/webhook/route.ts:685` inserts project access after event marking.
- `src/app/api/stripe/webhook/route.ts:778` upserts track purchase after event marking.
- `src/app/api/stripe/webhook/route.ts:702` starts project fulfillment in the background.
- `src/app/api/stripe/webhook/route.ts:807` documents immediate return.
- `src/app/api/stripe/webhook/route.ts:809` starts track fulfillment in the background.

Decision: reportable, launch-blocking for paid launch.

Required fix:

- Commit idempotency only after durable fulfillment state exists, or use a transaction/RPC.
- Await security-critical state changes before returning 200.
- Move email, contract rendering, CRM events, and notifications to a durable queue/job model.
- Add Stripe retry regression tests.

### 5. Checkout and promo logic contradict current product intent

The current checkout still rejects exclusive purchases when WAV/stems are not ready, even though webhook metadata supports a stems-pending flow. Promo usage is incremented at session creation and again on webhook completion, so abandoned sessions can burn usage and paid sessions can count twice. Project checkout also accepts any priced project id, even if it is not store-featured.

Evidence:

- `src/app/api/store/checkout/route.ts:230` loads project by id.
- `src/app/api/store/checkout/route.ts:232` selects `store_featured`.
- `src/app/api/store/checkout/route.ts:241` checks only price.
- `src/app/api/store/checkout/route.ts:470` rejects missing exclusive deliverables.
- `src/app/api/store/checkout/route.ts:538` always sends empty `stems_pending_track_ids`.
- `src/app/api/store/checkout/route.ts:543` increments promo use at session creation.

Decision: reportable for commerce integrity and product correctness.

Required fix:

- Reject unfeatured/unlisted project ids in checkout.
- Implement stems-pending checkout metadata and sales status.
- Increment promo usage exactly once on paid webhook completion.
- Auto-validate `?promo=CODE`, including project checkout.

## P1 Security Risks

- `/api/store/orders?email=` returns order recovery credentials by email alone. Use magic link or OTP before showing `stripe_session_id` or project access tokens.
- `/api/events` still returns all calendar events when no user is present because it only scopes the service-role query inside `if (user)`.
- Project bundle access returns raw `audio_url`/`wav_url` behind a bearer token. That is better than public catalogue leakage, but still weak once the token is shared.
- Share APIs return raw stem URLs even when downloads are disabled. Stem metadata should be redacted unless an entitlement explicitly permits it.
- CSP is report-only, which is fine during bake-in but should not be treated as a control for media leakage.

## Scale Findings For 500-600 Beats

The current data model can hold 500-600 beats, but the request patterns need to change before real traffic.

Problems:

- `/api/store` is whole-catalog-first. It fetches all listed tracks, all tag rows for them, and all play rows for local counting.
- Store filters are client-side over the full payload.
- `/api/tracks` returns rich track rows with tags and stems and no pagination.
- Library, projects, playlists, and store-editor refetch entire collections on realtime changes.
- Add-from-library modals fetch the full library.
- Store-editor fetches both `/api/store` and `/api/tracks`, duplicating catalog data.
- Store-editor reorder writes many PATCH requests instead of one bulk order update.

Evidence:

- `src/app/api/store/route.ts:112` starts whole-catalog fetch.
- `src/app/api/store/route.ts:173` fetches play rows per chunk, not aggregates.
- `src/app/store/page.tsx:276` filters/sorts client-side.
- `src/app/api/tracks/route.ts:61` selects rich track data.
- `src/app/(dashboard)/library/page.tsx:285` fetches `/api/tracks`.
- `src/app/(dashboard)/library/page.tsx:340` refetches on any track change.
- `src/app/(dashboard)/projects/page.tsx:129` through `src/app/(dashboard)/projects/page.tsx:134` subscribe to multiple tables and refetch full project lists.
- `src/app/(dashboard)/playlists/page.tsx:73` through `src/app/(dashboard)/playlists/page.tsx:78` do the same for playlists.
- `src/components/projects/AddFromLibraryModal.tsx:42` fetches full `/api/tracks`.
- `src/app/(dashboard)/store-editor/page.tsx:669` bootstraps multiple large endpoints.
- `src/app/(dashboard)/store-editor/page.tsx:885` reorders listed beats with repeated writes.

Required fix:

- Add server-side store filters, sorting, pagination, and cursors.
- Replace play-row enrichment with aggregate views/RPC.
- Add lean list endpoints for dashboard views.
- Add search endpoint for add-from-library.
- Debounce realtime invalidation and use React Query consistently.
- Add bulk reorder endpoints.
- Add indexes for store listing, tags, plays, purchases, and analytics.

## Store UX Findings

The current store is visually improving, but conversion and licensing are still split across too many layers.

Problems:

- Checkout and store toolbar still imply buyer accounts, conflicting with the product spec that buyers do not need accounts.
- Hero is still mostly producer identity, not a dynamic commerce offer.
- Producer's Picks are configured but appear below the catalogue.
- Featured project cards receive `onBuyProject` but do not expose direct buy/preview actions in the strip.
- Catalogue CTAs still lean on legacy Lease/Exclusive buttons even when custom license tiers exist.
- Trust signals appear mostly at checkout, not where the buyer makes the first add-to-cart decision.
- Store editor "Needs attention" can flag price issues even when global license tiers/default prices cover the beat.

Required fix:

- Move Producer's Picks above the catalogue.
- Make the hero rotate between featured beat, featured project, featured playlist, and drop.
- Make project cards commerce-native: play, preview first track, buy bundle, price, track count.
- Replace hard-coded catalogue lease/exclusive CTAs with a tier chooser when custom licenses exist.
- Add compact trust chips near cart and preview CTAs: instant delivery, legal license, Stripe, no subscription.
- Remove or hide buyer-account prompts unless buyer accounts become an explicit product change.

## Dashboard Workflow Findings

Projects and playlists are now closer to the Untitled reference, especially with folder covers, recent rows, and cleaner menus. The remaining issue is not only visuals; it is freshness and scale.

Problems:

- Folder preview covers are derived from already-loaded projects/playlists. If list data is stale, folder images feel broken.
- Realtime refreshes are broad; any track update can refetch project and playlist collections.
- Folder menus and management drawers fetch and mutate one thing at a time.
- Add-from-library is too heavy for a large vault.
- Library is still the canonical rich list for too many dashboard workflows.

Required fix:

- Add server-provided folder preview covers and counts.
- Make folder cover updates automatic via list RPC/view or targeted invalidation.
- Move project/playlist preview cover logic into APIs instead of recomputing from full arrays.
- Use search-first add modals with lean track rows.
- Virtualize large library and store-editor rows.

## Competitor Gap

### Untitled-style private workflow

Primary reference: the screenshots provided in this thread, because the public Untitled site was not reliably accessible to automated fetches.

What Untitled does well:

- Mobile-first private library.
- Folders feel like first-class objects.
- Project detail is simple: large cover, title, owner, track count/duration, add tracks, track list, mini-player.
- Generic covers are acceptable only as placeholders; once a folder or project contains music/art, the visual should update automatically.
- Actions are compact and obvious: back, link/share, search, more.

Antigravity gap:

- Projects/playlists need automatic folder/project cover refresh from contained tracks.
- Track rows inside projects/library must stay visually consistent with the store cards, without importing store gradients into private dashboard contexts.
- Menus should stay fast and non-janky under 500-600 beats.

### BeatStars-style commerce workflow

Public reference: BeatStars is a beat marketplace and licensing platform with custom licenses, marketplace/pro-page concepts, Blaze Player, Beat ID, publishing administration, and collaborator splits. The source used was the indexed BeatStars public summary at https://en.wikipedia.org/wiki/BeatStars and the official public homepage at https://www.beatstars.com/.

What BeatStars does well:

- Commerce is explicit everywhere: preview, license, buy.
- Licenses are the product, not just a checkout detail.
- Marketplace discovery and producer profile pages support browsing by intent.
- Tools around publishing, identification, collaborator splits, and seller identity build trust.

Antigravity gap:

- License tiers need to be visible earlier in the catalogue flow.
- Public previews must protect files the way a marketplace would.
- Store search/filter must become server-backed before the catalogue grows.
- Trust and delivery terms must be present before checkout.
- Publishing/splits can wait; single-producer launch does not need them yet.

## Phased Plan For Approval

### Phase 0: Inventory Freeze

Do not upload valuable beats at scale yet. Use test beats or low-value placeholders until Phase 1 is complete.

Exit criteria:

- Security fixes below are merged.
- A manual API inspection of `/api/store`, `/api/store/[id]`, share routes, project access, and browser localStorage shows no raw master/stem URLs.

### Phase 1: Media And Auth Protection

Fix before real inventory.

Work:

- Make R2 private or move masters/stems to private keys.
- Add preview asset pipeline: low-bitrate and/or tagged preview URLs separate from masters.
- Remove `audio_url`, `wav_url`, and stem URLs from public responses.
- Replace `/api/audio?src=` and `?key=` with scoped endpoints.
- Add entitlement-checked download endpoints for track and project purchases.
- Require auth on all audio upload routes.
- Bind multipart sessions to user ownership.
- Fix share creation, share download membership checks, revocation, expiry, and stem redaction.
- Drop unsafe public RLS policies and stop treating null-owner rows as broadly mutable.
- Protect `/store-editor`, `/sales`, `/analytics`, and `/offline` in `src/proxy.ts` or prove they are gated elsewhere.
- Fix `/api/events` unauthenticated read.

Acceptance tests:

- Guest cannot call upload init/part/complete.
- Guest cannot recover raw R2 keys from store, share, delivery, or localStorage.
- Share token can only read/download tracks attached to that token.
- Expired/revoked project access fails everywhere.

### Phase 2: Commerce Correctness

Fix before paid launch.

Work:

- Rework Stripe event idempotency so duplicate marking happens after durable fulfillment state.
- Await or durably queue critical fulfillment.
- Implement exclusive stems-pending flow end to end.
- Promo usage increments exactly once on paid completion.
- `?promo=CODE` auto-validates for cart and project checkout.
- Project checkout rejects unfeatured/private project ids.
- Order lookup requires magic link or OTP, not email-only access.

Acceptance tests:

- Stripe retry after simulated purchase insert failure still fulfills.
- Project bundle purchase creates one access token and sends one email.
- Abandoned checkout does not consume promo usage.
- `max_uses=1` promo cannot be double-counted.
- Unfeatured project id returns 404/403 from checkout.

### Phase 3: 500-600 Beat Scale

Work:

- Add `/api/store` server-side filters, cursors, and lean payloads.
- Add `/api/store/facets` or equivalent aggregate endpoint.
- Replace play-row loading with aggregate view/RPC.
- Add lean `/api/tracks` list/search endpoints.
- Add `/api/tracks/search` for add-from-library.
- Paginate or virtualize library, store-editor, and large modals.
- Debounce realtime invalidation and centralize with React Query.
- Add bulk reorder endpoints.
- Add missing indexes:
  - `tracks(user_id, store_listed, store_sort_order, created_at)`
  - `track_tags(category, tag, track_id)`
  - `store_plays(track_id, played_at)`
  - `share_plays(link_token, track_id, played_at)`
  - GIN on `license_purchases.track_ids`
  - `(seller_user_id, status, created_at)` for purchase lists/analytics

Acceptance tests:

- `/store` first payload stays lean with 600 generated tracks.
- Search/filter does not download the entire catalogue.
- Library and store-editor remain usable with 600 rows.
- Realtime changes do not trigger repeated full reload storms.

### Phase 4: Store Conversion And License UX

Work:

- Dynamic commerce hero driven by featured beats/projects/playlists/drops.
- Producer's Picks above catalogue.
- Commerce-native project cards with buy/preview.
- Unified license-tier chooser in catalogue and preview drawer.
- Buyer trust chips before checkout.
- Remove buyer-account CTAs from guest checkout.
- Fix store-editor Needs Attention logic to respect global tiers/default prices.

Acceptance tests:

- A buyer can understand price, rights, files, and delivery before Stripe.
- Project bundle checkout shows bundle name and price.
- Guest checkout never implies account creation is required.

### Phase 5: Dashboard Workflow Polish

Work:

- Server-provided folder cover mosaics and counts.
- Automatic folder/project/playlist cover refresh after track changes.
- Search-first add-to-project/add-to-playlist modals.
- Fewer, lighter folder menu operations.
- Keep project/library track rows visually aligned with store quality while preserving private dashboard styling.

Acceptance tests:

- Folder covers update after adding/removing tracks without manual reload.
- Project and playlist menus stay responsive under 600 beats.
- Track rows in projects/library match the store information hierarchy without showing public-store gradients where they do not belong.

### Phase 6: Later Competitive Features

These are not launch blockers for a single-producer store:

- Publishing administration workflows.
- Collaborator split payouts.
- Beat identification/fingerprint monitoring.
- Buyer accounts.
- Multi-producer marketplace.

## Recommended Next Step

Start with Phase 1. It is the foundation. Store UI and licensing polish should continue after the media boundary is safe, because otherwise a nicer store just makes unprotected files easier to find.
