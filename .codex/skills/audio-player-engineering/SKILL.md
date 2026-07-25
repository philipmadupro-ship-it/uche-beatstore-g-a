---
name: audio-player-engineering
description: Use for Beatstor persistent audio playback, queue, transport controls, seek/progress, volume, shuffle, repeat, Media Session API, route persistence, buffering, stream failures, WaveSurfer, global audio state, and preventing duplicate playback engines.
---

# Audio Player Engineering

## Activation

Use for `src/components/player`, `src/hooks/usePlayer.ts`, audio routes, preview URLs, WaveSurfer, media session, queue behavior, player UI, and playback bugs.

## Workflow

1. Inspect `usePlayer`, `SimpleAudioEngine`, `PlayerBar`, `QueueDrawer`, `MediaSessionBridge`, and preview/audio route behavior.
2. Keep one controlled global audio engine for persistent playback.
3. Separate player state, queue state, route UI state, and server track data.
4. Handle loading, buffering, failure, unsupported format, unavailable track, and navigation recovery.
5. Verify event listeners are cleaned up and progress updates do not cause excessive rerenders.

## Checklist

- Play, pause, seek, previous, next, duration, current time, volume, mute, queue, repeat, and shuffle work where supported.
- No multiple tracks play at once.
- Playback persists between normal route changes.
- Autoplay rules are respected.
- Media Session metadata and actions are safe when available.
- Private media URLs are not exposed publicly.

## Expected Output

Player behavior change, state architecture note, failure states handled, and playback verification performed.
