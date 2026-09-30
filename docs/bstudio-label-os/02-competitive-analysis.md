# 02 — Competitive Analysis

**Discovery 01 · 2026-09-29**

## Research method and its limits

- **Method.** Web search for each product and category, preferring first-party pages (product sites, help centres, official docs) and established trade press (Music Business Worldwide, Digital Music News).
- **Limitation (material).** This environment's egress proxy **blocked direct page fetches** of `disco.ac`, `vvault.app` and `vevacollect.com`, and other fetches were not attempted after that. Every competitor claim below comes from **search-engine result summaries of the cited pages**, not from reading the pages in full. The claims are sourced, but they are second-hand. **Re-verify pricing and any claim a decision rests on** before quoting it externally. This is one reason the discovery result is `PARTIAL`.
- **Labels.** `FACT (source)` means the cited source states it. `INFERENCE` means drawn from facts. `RECOMMENDATION` means what BStudio should do.
- Pricing is as reported in 2026 sources and changes often.

---

## 1. Category map

| Category | Products researched | What they own |
|---|---|---|
| Producer beat-selling | BeatStars, vvault (the prompt's "VVVault") | Beat catalogue, licensing, sends, engagement tracking |
| Music catalogue / pitching | DISCO, Reprtoir | Catalogue, metadata, sharing, pitching, (Reprtoir) royalties + contracts |
| Music project collaboration | VEVA Collect, Vandall, Pibox | Credits capture, split sheets, versioned audio review |
| Label operations / accounting | Label Engine, LabelGrid, Curve, Reprtoir | Releases, distribution, royalty accounting, statements |
| Distribution | DistroKid, Stem, AWAL | DSP delivery, royalty splits |
| Publishing admin | Songtrust | PRO/society registration, publishing royalty collection |
| Credits graph | Muso.AI | Verified credits across DSPs |
| A&R intelligence | Chartmetric, Sodatone (WMG), Instrumental | Streaming/social data, discovery signals |
| Generic collaboration | Slack, Microsoft Teams, Notion, Airtable, Asana/Monday/ClickUp, Dropbox (Replay), Google Drive, Frame.io | Chat, docs, databases, tasks, file storage, media review |
| Templates on generic tools | ThorneLabs "Record Label OS" (Notion template) | The incumbent "stack" packaged as a template |

---

## 2. Competitor profiles

### BeatStars
- **Target:** beat producers selling leases and exclusives.
- **Core workflow:** upload → storefront/marketplace → license sale → payout.
- **Strongest feature:** marketplace reach plus collaborator revenue splits. It "enables users to add collaborators to their works and automatically split the revenue". FACT (source: [Wikipedia](https://en.wikipedia.org/wiki/BeatStars), [BeatStars Studio](https://www.beatstars.com/studio/sell-beats)).
- **Business model:** annual seller plans, no free seller tier; Professional ~$19.99/mo; a 12% buyer service fee on marketplace purchases. FACT (source: [Soundee comparison](https://soundee.com/compare/soundee-vs-beatstars), [BeatStars pricing](https://www.beatstars.com/studio/pricing)).
- **Weakness:** INFERENCE. No label/organization model; collaboration is financial (splits), not operational.
- **Learn:** splits attached to the sellable object at creation time.
- **Avoid:** marketplace dynamics. BStudio is a private operating system, not a discovery marketplace.

### vvault
- **Target:** producers pitching to labels and artists.
- **Core workflow:** upload → send to A&Rs/artists → track engagement → sell.
- **Strongest feature:** engagement tracking ("opens, clicks, play duration, downloads, saves, and sales in real time") plus a CRM with tagged contacts ("US labels", "Hip-hop A&Rs") and timestamped comments, "with privacy controls made for unreleased music". Free plan: 50 tracks, 0% fees. FACT (source: [vvault.app](https://www.vvault.app/)).
- **INFERENCE:** vvault is the **closest analogue to BStudio's current producer product**, which already ships CRM, sends, open/click tracking (migration 089), share variants and a store.
- **Learn:** privacy-first sharing of unreleased music is a selling point, not a checkbox.
- **Avoid:** competing on producer-side send tooling alone. That market is served, and it is not the Label OS thesis.

### DISCO
- **Target:** labels, publishers, sync/licensing teams, managers, artists.
- **Core workflow:** ingest catalogue → tag/metadata → search → build playlists → share securely → see engagement.
- **Strongest feature:** "powerful metadata features, lyric transcription … AI-powered search to build pitch-perfect playlists and securely share everything buyers need, from tracks to rights info". Team members can comment and give feedback on tracks. FACT (source: [DISCO labels & publishers](https://www.disco.ac/solutions/labels-publishers), [SourceForge](https://sourceforge.net/software/product/DISCO-Music-Management/)).
- **Pricing:** Artist $12/mo, Plus $18.99, Pro $29.99; add-ons for Discovery Suite ($10) and Watermarking ($29). FACT (source: [DISCO pricing](https://www.disco.ac/pricing), [dropcue](https://dropcue.app/disco-pricing)).
- **Weakness:** INFERENCE. DISCO is catalogue-and-pitch centred. It does not run A&R development, release gates or legal readiness.
- **Learn:** search + share + engagement on a *catalogue* is table stakes for a label tool. Watermarking is sold as an add-on.
- **Avoid:** building sync-pitch tooling (music supervisors are a different buyer).

### Reprtoir
- **Target:** record labels and music publishers.
- **Core workflow:** catalogue → contracts → releases → royalty accounting → distributor/CMO exports.
- **Strongest features:**
  - A catalogue "with ISRC, UPC, and ISWC as first-class fields".
  - Contract management that stores "start and end date, exclusivity options … renewal options".
  - Royalty accounting.
  - "60+ integrations including MCPS, PRS for Music, BMI, SACEM…".
  - AI tagging and audio-similarity search.

  FACT (source: [reprtoir.com](https://www.reprtoir.com/), [Reprtoir contract management](https://www.reprtoir.com/contract-management), [EDMSauce ranking](https://www.edmsauce.com/2026/02/18/best-label-management-software-for-record-labels-compared-ranked/)).
- **Weakness:** INFERENCE. It is a back-office system of record. Its entry point is a finished recording, and it is not where songs are made or A&R'd.
- **Learn:** identifiers (ISRC/UPC/ISWC) are first-class fields, and contracts are structured records, not just PDFs.
- **Avoid:** royalty accounting. It is a separate, deep product. Integrate or export instead.

### Label Engine / LabelGrid / Curve
- **Label Engine:** distribution to 100+ stores, promotion, accounting and **demo management**. "Supports a release workspace that ties participants and split allocations to each release record". FACT (source: [label-engine.com](https://label-engine.com/), [EDMSauce](https://www.edmsauce.com/2026/02/18/best-label-management-software-for-record-labels-compared-ranked/)).
- **LabelGrid:** royalty accounting, statements, payments, DDEX feed generation. FACT (source: [LabelGrid accounting](https://labelgrid.com/features/accounting/), [LabelGrid DDEX guide](https://labelgrid.com/blog/guides/ddex-feed-generation-guide/)).
- **Curve:** "CWR-aware royalty engine … statement generation across 180+ providers". FACT (source: [EDMSauce](https://www.edmsauce.com/2026/02/18/best-label-management-software-for-record-labels-compared-ranked/)).
- **Market pattern:** independent labels commonly combine LabelSpark (marketing), Reprtoir (catalogue/royalties) and Curve (accounting). FACT (source: same).
- **INFERENCE:** the back office is fragmented but well served. The **front office** (A&R → development → release readiness) is served by generic tools.

### VEVA Collect
- **Target:** artists, producers, engineers, studios.
- **Core workflow:** share hi-res audio/session files → capture credits, lyrics, splits and publishing info as the work happens.
- **Strongest feature:** credits "compiled seamlessly meeting DDEX standards"; a Check-In App through which "everyone who works on a project can automatically submit their credits"; tiered permissions of "read only, download only or full admin". FACT (source: [VEVA Collect features](https://vevacollect.com/features), [Buzzsonic](https://buzzsonic.com/resource/veva-collect-music-collaboration-platform/), [Music Business Worldwide](https://www.musicbusinessworldwide.com/how-veva-collect-is-trying-to-solve-a-problem-worth-millions-of-dollars-in-unpaid-royalties/)).
- **Learn:** **capture credits at the session, from the contributor**, not afterwards from memory. MBW frames missing credits as "millions of dollars in unpaid royalties".
- **Avoid:** studio check-in hardware/app flows in the MVP.

### Vandall
- **Target:** creators, with a "Vandall Business" offering for labels.
- **Features:** split sheets and agreements e-signed in-app; collaborators, credits and splits "attached to the actual project files"; timestamped threaded feedback; an **audit trail** where "every upload, comment, and approval is logged". FACT (source: [vandall.com/features](https://vandall.com/features), [Vandall agreements](https://vandall.com/agreements), [Vandall Business](https://vandall.com/vandall-business)).
- **INFERENCE:** Vandall is the **nearest direct competitor to the Label OS collaboration + credits layer**. BStudio's differentiation must come from *connected label operations* (artists, A&R, releases, readiness) and the producer/beatstore ecosystem, not from split sheets alone.

### Pibox
- **Target:** producers, engineers, labels (Universal and Epidemic Sound are listed as customers).
- **Features:** timestamped comments on the waveform; version chains with one-click comparison; a DAW plugin (Pro Tools, Cubase, Nuendo). FACT (source: [pibox.com](https://pibox.com/), [Pibox × Universal](https://pibox.com/customers/universal), [Pibox plugin](https://pibox.com/plugin/)).
- **Learn:** version *chains* per song and A/B comparison are expected in mix review.
- **Avoid:** DAW plugins (a native plugin is a separate engineering discipline).

### DistroKid / Stem / AWAL
- **DistroKid Splits** (since 2017) automatically pays collaborators any percentage and supports recoupments. "Teams" was renamed "Splits" because "it is not a team member or user permissions feature". The Label plan is ~$80/yr for unlimited artists. FACT (source: [DistroKid Help — Splits](https://support.distrokid.com/hc/en-us/articles/360013534394-Using-Splits-To-Pay-Your-Collaborators-Automatically), [bestfriendsclub](https://bestfriendsclub.ca/distrokid-teams-royalty-splits/), [Orphiq](https://orphiq.com/resources/music-distribution-independent-labels)).
- **INFERENCE:** distributors own delivery and payout splits. BStudio should **produce distributor-ready metadata**, not deliver to DSPs.

### Songtrust
- Publishing admin: registers songs with "45+ collection societies", $100 per-writer setup, and 15% / 20% commission. FACT (source: [Songtrust pricing](https://www.songtrust.com/pricing), [Songtrust FAQ](https://www.songtrust.com/frequently-asked-questions)).
- **INFERENCE:** PRO/society registration is an **integration/export target**. BStudio's job is to have complete writer/IPI/split data *ready* for it.

### Muso.AI
- "The world's first verified Music Credits Platform": 50M verified tracks and 4M creator profiles; free, with Pro at $9.99/mo. FACT (source: [muso.ai/credits](https://www.muso.ai/credits), [Digital Music News](https://www.digitalmusicnews.com/2024/11/25/muso-ai-credit-platform/)).
- **INFERENCE:** a public credits graph exists. BStudio's credits are **private, pre-release, and legal-grade**, which is complementary.

### Chartmetric / Sodatone / Instrumental (A&R intelligence)
- Chartmetric aggregates DSP/social data per artist and claims its Predict feature flags artists "30 to 60 days before viral inflection"; it names Universal, Warner, Sony, Concord and Beggars as users. Sodatone (WMG) covers "8 million artists". FACT (source: [Chartlex](https://www.chartlex.com/blog/marketing/ai-ar-tools-music-discovery-2026), [Chartmetric A&R tools](https://chartmetric.com/features/ar-tools), [LinkedIn advice](https://www.linkedin.com/advice/1/what-best-ar-tools-platforms-finding-new-talent)).
- **INFERENCE:** external discovery analytics is a data business. BStudio's A&R is **internal**: demos, reviews, development. **Do not build prediction.**

### Slack
- Guest accounts are internal-only. External organizations collaborate through **Slack Connect**, "each organization joining from their own Slack workspace", with per-invite permission levels ("post only" vs "post, invite and more"). FACT (source: [Slack — guests vs Slack Connect](https://slack.com/resources/slack-for-admins/guests-vs-channels-in-slack-connect), [Slack Connect permissions](https://slack.com/help/articles/1500012572621-Manage-Slack-Connect-channel-invitation-settings-and-permissions)).
- **Learn:** external people should **keep their own identity and home organization** and be admitted to one shared space.
- **Avoid:** chat. BStudio will not beat Slack at messaging.

### Microsoft Teams
- Distinguishes **guest access** (a guest identity in your directory), **external access** (federated chat) and **shared channels** via B2B direct connect, where external users "stay signed in to their own tenant … and see only that one channel". Microsoft "now recommends shared channels as the first thing to consider". FACT (source: [Microsoft Learn — shared channels](https://learn.microsoft.com/en-us/microsoftteams/shared-channels), [Microsoft Learn — B2B direct connect](https://learn.microsoft.com/en-us/entra/external-id/b2b-direct-connect-overview)).
- **Learn:** this is the right model for cross-organization producer collaboration: **one account, many organizations, scoped access to a single project**.

### Notion
- Roles run Workspace Owner > (Membership Admin, Enterprise) > Member > Guest. Guests are free, are invited to specific pages, "can't be given workspace-wide access", and can't be added to groups. FACT (source: [Notion Help — who's who](https://www.notion.com/help/whos-who-in-a-workspace), [Notion Help — members/guests](https://www.notion.com/help/add-members-admins-guests-and-groups), [Notion pricing](https://www.notion.com/pricing)).
- **Notion is already the incumbent "label OS":** ThorneLabs sells a "Record Label OS" Notion template (plus "Music Manager OS" and "Releases") claiming 500+ users. FACT (source: [Notion Marketplace — Record Label OS](https://www.notion.com/templates/record-label-os), [thornelabs.io](https://thornelabs.io/record-label-os)).
- **INFERENCE:** the demand is real, and the current answer is a **template on a generic database**. That answer cannot play audio in context, derive readiness, or enforce rights data.

### Airtable, Asana, Monday, ClickUp
- ClickUp publishes music-release, album-release, single-release and independent-label marketing templates. FACT (source: [ClickUp music release template](https://clickup.com/templates/marketing-plan/music-release), [ClickUp label template](https://clickup.com/templates/marketing-plan/independent-record-label)). Airtable has no dedicated label template in its gallery; the search surfaced only generic templates. FACT (source: [Airtable templates](https://www.airtable.com/templates)).
- **INFERENCE:** release rollouts run as **generic task templates**. Their strength is configurability; their weakness is that the task "Artwork approved" has no connection to the artwork file, the song or the release date.
- **Learn:** templates for release rollouts. **Avoid:** a general-purpose, user-configurable workflow builder (see §4).

### Dropbox (Replay) / Google Drive
- Dropbox Replay supports audio review with comments on "a specific time stamp or time range", version history that "retains unresolved comments from previous versions", and "Can edit / Can comment" permissions. FACT (source: [Dropbox Help — Replay](https://help.dropbox.com/installs/dropbox-replay), [Dropbox — time-based commenting](https://blog.dropbox.com/topics/product-tips/time-based-commenting-audio-video)).
- **Learn:** carrying unresolved comments forward across versions is a concrete, low-cost feature.

### Frame.io
- Custom approval stages with "Approved / Needs Work / No response"; automatic **version stacks**; role-based permissions down to project and user level; watermarks, audit logs and expiring permissions. FACT (source: [Frame.io docs — version stacks](https://docs.frame.io/docs/managing-version-stacks), [Digital Project Manager review](https://thedigitalprojectmanager.com/tools/frame-io-review/), [Capterra](https://www.capterra.com/p/148214/Frame-io/)).
- **Learn:** the **approval vocabulary** (approved / changes requested) and **version stacks** are the right primitives for masters and artwork.

---

## 3. Industry-standard facts that constrain the design

| Topic | Fact | Source |
|---|---|---|
| Release identifiers | UPC per release, ISRC per recording; one release holds many ISRCs | [BeatsToRapOn](https://beatstorapon.com/blog/music-metadata-isrc-iswc-upc-ddex/), [LabelGrid DDEX guide](https://labelgrid.com/blog/guides/ddex-feed-generation-guide/) |
| Release metadata | Title, version, primary/featured artist, label, copyright notices, release date, genre, language, explicit flag, composers, contributors, identifiers, territories | [rightsHUB](https://rightshub.net/news/music-metadata-requirements-2026), [edukatesg](https://edukatesg.com/2026/09/17/how-music-works-music-distribution-dsp-ddex-isrc-metadata-territories-takedowns-royalty-data/) |
| Contributor roles | Credits should use DDEX RIN roles. Producers are routinely under-credited because intake forms do not map to DDEX Contributor roles | [LabelGrid DDEX guide](https://labelgrid.com/blog/guides/ddex-feed-generation-guide/) |
| Current standard | ERN 4.3.x | [DDEX Knowledge Base](https://kb.ddex.net/implementing-each-standard/electronic-release-notification-message-suite-(ern)/ern-implementation-guidance-and-best-practice/) |
| Split sheets | Legal names, contact, PRO + IPI per writer, role/contribution, publisher share, percentages **totalling exactly 100%** (99.9% flags the registration), signatures with dates, samples used | [Songtrust split sheet](https://www.songtrust.com/en/the-ultimate-split-sheet-for-songwriters), [Pibox guide](https://pibox.com/resources/music-split-sheet-guide/), [Soundplate](https://soundplate.com/how-to-read-music-split-sheet/) |
| A&R work | Scouts via demos, streaming data and shows; pitches signings internally; post-signing chooses songs, producers and writers, books sessions, and plans release timing with marketing/PR. Relationships outweigh unsolicited demos | [Soundcharts](https://soundcharts.com/en/blog/what-does-ar-mean-in-music), [Orphiq](https://orphiq.com/resources/what-is-a-and-r), [Careers in Music](https://www.careersinmusic.com/what-is-a-r/) |

---

## 4. Gap analysis

### TABLE STAKES (BStudio must eventually have these to be credible)
1. Organization with members, roles and guest/external access (Notion, Slack, Frame.io all have it).
2. Artist roster with per-artist workspace.
3. Secure sharing with expiry, password, revocation and download control. **BStudio already has this.**
4. Timestamped/region comments on audio. **Already has it.** Carrying comments across versions is missing.
5. Version stacks per song with A/B comparison.
6. Credits with DDEX-aligned roles; ISRC/ISWC/UPC as first-class fields.
7. Split sheets that validate to 100%, with signature status.
8. Approvals (approved / changes requested) with an audit trail.
9. Search and filtering across catalogue, people and state.
10. Activity history per artist/project.

### DIFFERENTIATORS (what could make BStudio meaningfully different)
1. **One song record from demo to catalogue.** Demos, mixes, masters, credits, splits, artwork, approvals and release placement accumulate on one Song. Generic stacks split this across four tools linked by filename.
2. **Derived readiness, not reported status.** Legal readiness and release readiness are computed from the data (the repo's `triage.ts` / `store/readiness.ts` pattern), so the owner's overview is true without anyone updating a status field. Notion/ClickUp templates depend on manual status upkeep.
3. **Credits captured at the source.** The filename parser (`src/lib/upload/title-metadata.ts`) already extracts credits at upload. Contributors invited to a project confirm their own credit (the VEVA insight), and the same record feeds split sheets, legal handoff and distributor metadata.
4. **The producer ecosystem feeds the label pipeline.** A beat from a producer's library can become the source of a label Song with provenance intact. Label tools start at the master; BStudio starts at the beat.
5. **Music-native sharing rules.** Preview vs full playback, downloads off, masters restricted and HMAC-signed media are already built and proven on the share pages.

### DEFENSIBILITY (value that compounds as data accumulates)
- **The credits/party graph:** every confirmed credit makes the next split sheet, legal pack and "everything with Producer X" query cheaper.
- **Version and review history per song:** why a mix was chosen, and who approved it.
- **Creative direction memory per artist:** references and A&R notes that survive staff turnover.
- **Release history as structured data,** from which a label's own benchmarks (time from demo to release, which stage stalls) become derivable.

### DANGEROUS SCOPE (attractive, disproportionately complex)
| Feature | Why it is dangerous | Instead |
|---|---|---|
| Real-time chat/channels | Competes with Slack/Teams on their core product; adds a moderation and retention burden | Contextual comments on objects; optional outbound Slack digest (Phase 7) |
| Royalty accounting / statements | A deep domain (Curve, Reprtoir, LabelGrid); requires DSP/CMO file ingestion | Out of scope; export splits |
| DSP delivery (DDEX ERN feeds) | Requires distributor agreements, certification and takedown handling | Distributor-ready metadata export |
| Configurable workflow builder | Becomes ClickUp; every label's config becomes support debt | Code-defined gates with a small set of per-org switches |
| Contract generation / e-signature engine | Legal liability, jurisdiction variance | Store signed documents; record signature status; integrate e-sign later |
| AI A&R prediction | A data business (Chartmetric, Sodatone) | Link out to artist analytics URLs |
| Real-time co-editing (CRDT) | Heavy infrastructure for metadata forms that rarely conflict | Optimistic concurrency with a version check |
| General docs/wiki | Notion's core | Structured notes on artist/song/release |
| Video review, full DAM | Frame.io's core | Store video files as assets; no frame review |
| Finance (advances, recoupment, budgets) | Accounting domain, high sensitivity | Out of scope beyond a `finance` capability placeholder |

### INTEGRATIONS (integrate rather than rebuild)
| Need | Integrate with | Phase |
|---|---|---|
| Distribution | Export to any distributor (CSV/sheet aligned to ERN fields) | 6 |
| Publishing registration | Export for Songtrust / PRO registration | 5 |
| E-signature | DocuSign / Dropbox Sign (evaluate) | 5+ (optional) |
| Team chat | Slack / Teams incoming webhook for digests | 7 |
| Artist analytics | Chartmetric/Spotify for Artists URLs on the artist record | 2 (link fields only) |
| Royalty accounting | Export splits to Curve / Reprtoir / LabelGrid formats | 7+ |
| Calendar | ICS export of release dates (existing `calendar_events`) | 6 |
| Payments | Stripe (exists) | — |
| Email | Resend (exists) | — |

---

## 5. The core product question

> *Why would a label use BStudio instead of combining Slack + Notion + Drive + spreadsheets + music-specific tools?*

**Answer.** In the generic stack, **the relationships between things live in people's heads**, and BStudio stores them.

Concretely, when an artwork file is uploaded:

| Generic stack | BStudio |
|---|---|
| A Drive file named `T04_art_v3_FINAL.png`, a Slack message "artwork uploaded", and a Notion row whose Status someone may or may not change | The file is an asset attached to **Release "EP 2027"** (artist A, target date 2027-03-06). Uploading satisfies the release's *artwork present* requirement. The release now shows *Artwork: awaiting approval*, and the artwork approval request lands with whoever holds `release.approve.artwork`. The owner's overview moves EP 2027 from "blocked on artwork" to "blocked on legal" **without anyone typing a status**. The activity feed says *"Maya uploaded artwork to EP 2027 (Artist A)"* under Artist A, not in a firehose |

Four capabilities make this work, and the generic stack has none of them together:

1. **Audio in context.** A comment is pinned to 1:12–1:20 of *mix v3* of *Track 04*, not to a filename.
2. **Identity across the lifecycle.** Demo → mix → master → release is one Song. Credits entered at the demo are still there at the legal handoff.
3. **Computed state.** Readiness is derived from data, so it is never stale and never depends on who remembered to update it.
4. **Rights-aware sharing.** An external producer sees one project; legal sees contracts; marketing sees artwork but not splits; a pitch link streams a 75-second preview with downloads off.

**What BStudio will not do better:** chat (Slack), freeform documents (Notion), general task configurability (ClickUp), and royalty accounting (Curve). The product must not try.
