---
name: producer-dashboard
description: Use for Beatstor producer dashboard work: upload, beat catalogue, edit metadata, draft/published/scheduled/private/sold states, artwork/audio/stems, license pricing, tags, public preview, sales, analytics, orders, revenue, and operational decision-making.
---

# Producer Dashboard

## Activation

Use for dashboard routes under `src/app/(dashboard)`, library, projects, playlists, store editor, sales, analytics, settings/licenses, profile, and producer operational workflows.

## Workflow

1. Inspect the existing dashboard route and nearby components before adding UI.
2. Prioritize decisions and actions over decorative charts.
3. Preserve auth gating and owner-scoped data access.
4. Keep metadata editing, license pricing, store listing, and upload status consistent across library and store editor.
5. Add pure helpers/tests for dashboard filtering, scoring, analytics, or derived status.

## Checklist

- Beat states are clear: draft, published, scheduled, private, sold-exclusive.
- Upload, replace, artwork, MP3/WAV/stems, tags, genre/mood, BPM/key, and license pricing are represented consistently.
- Public listing preview reflects buyer-facing data.
- Analytics show useful plays, likes, conversion, revenue, and license performance where data exists.
- UI remains efficient for repeated producer work.

## Expected Output

Dashboard workflow improvement, data ownership preserved, and verification of the main producer action changed.
