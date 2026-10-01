# Upload speed, and one player on the share pages

Prompt for an agent session. Rewritten from the producer's voice note; the original is kept at the bottom so nothing in it is lost.

Read first: `CLAUDE.md` (Share variants, Players), the tail of `docs/codex-execution-log.md`, `docs/design-direction.md` for anything visual.

## Goal

Three fixes, each independently shippable. Do them in this order and say which you did not finish.

### 1. Uploading ten WAVs takes about ten minutes

**Observed:** about 10 WAV files, 200–300 MB in total, took roughly 10 minutes to upload through the Uploads tray. Once they were in, the app was fast.

**Measure before changing.** 300 MB in 10 minutes is about 0.5 MB/s. If that matches the producer's uplink, no code change can make the bytes go faster, and the honest answer is to say so. Rule out, in this order: (a) per-chunk round trips (`/api/upload/part` is called to sign each chunk, then again to confirm it, and every call pays a session lookup plus a Supabase auth check); (b) browser CPU and memory competing with the transfer (`DropZone` decodes whole files for BPM/key, up to 6 at once); (c) wasted bytes from retried chunks.

**Wanted:**
- Fewer server round trips per file. Sign all of a file's chunks in one request.
- Client analysis must not starve the upload (lower concurrency). The upload never waits on it; it is collected at `/complete` with a grace period.
- Do not change what ends up in R2, the `/complete` contract, resume behaviour, or the retry policy.

**Not wanted:** a bigger chunk size or more parallel chunks as a guess. Either can make a thin uplink slower by turning one stalled chunk into more re-sent bytes.

**Verify:** Vitest on the batch signing route (one ownership check, rejects a foreign session / out-of-range part / empty list, `direct: false` when R2 is not configured). Say plainly what was and was not measured; do not claim a speed-up that was not timed.

### 2. On a share page the vinyl, the waveform and the sound are not one player

**Observed:** on the producer / rapper / friend share variants the vinyl and the waveform do not stay in sync with the audio.

**Cause to confirm:** `ShareWaveformVinyl` draws the page's waveform only if it is handed `waveRef`. None of the three variants passed it, so it mounted a standalone `WavePlayer`, a second player bound to the global `usePlayer` store, while the sound and the vinyl's spin come from the page's own `useWaveSurfer` and `isPlaying`. The page also mounted a hidden `<div ref={waveRef}>` for the real engine.

**Wanted:**
- One engine. The page's `useWaveSurfer` draws its waveform inside the vinyl; no hidden duplicate container, no second player.
- The cover stays on the disc: track cover, else project cover, else the generated artwork (`ArtworkFallback`).
- Play on the disc, on a row, and on the waveform all drive the same state.

**Verify:** Playwright, `e2e/share-options.spec.ts`: after playing Track Two the disc reports spinning and there is exactly one vinyl waveform on the page. Keep the 28 existing cases passing.

### 3. Download on the beat, and one row format for tracks

**Observed:** the Download buttons were in a block at the bottom of the share page, a scroll away from the beat. Each variant drew its own track list (a bare title in one, a key chip in another), unlike the library.

**Wanted:**
- Download is a button on the track's own row, only when the share allows downloads. The server's download gate still decides.
- One shared row (`components/share/ShareTrackRow`) in all three variants: cover, title, then type · BPM · key · length, the same facts the library row leads with.
- The bottom block stays (it also carries the playback label, the "downloads are off" notice and the collaboration entry).
- The row must not nest a button in a button: Play wraps the content, Download sits beside it.

**Open question, ask if it matters:** "same format as my library" was read as the library row's content and order on the share pages. It was not read as restyling the store (`/store`) cards. If the intent was the store, say so.

## Out of scope

The client variant's own track list, the store, the dashboard library, schema changes, and anything in `supabase/migrations/`.

## Done means

`npx tsc --noEmit`, `npx eslint` on touched files, `npx vitest run` (the guard tests in `src/lib/ui/` and `src/lib/source-hygiene.test.ts` included), `e2e/share-options.spec.ts`. Draft PR with Summary / Why / Test plan; no new migration.

---

## Original wording

> I tried to upload around 10 WAV files and they took so much time, a good 10 minutes, and it's not normal, even though it was only 200 or 300 megabytes. After, the performance was incredible. The other thing: on the players, synchronize the audio of the vinyl player and the wave player, make sure both are linked and that the cover photo is there. Also I would prefer the download button directly on the beats. I would like the tracks and the beats to be the same format as in my library, to keep consistency throughout the whole application.
