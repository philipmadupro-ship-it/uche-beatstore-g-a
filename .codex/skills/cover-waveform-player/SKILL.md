---
name: cover-waveform-player
description: Use for Beatstor's real audio-reactive cover player, including waveform peaks, frequency-colour rendering, cover-art safety, one central audio engine, seeking, player states, performance, accessibility, reduced motion, and mobile expanded playback.
---

# Cover Waveform Player

## Activation

Use for player architecture, waveform rendering, cover overlays, visual playback states, Media Session behavior, seeking, audio analysis, and player performance.

## Workflow

1. Inspect `src/hooks/usePlayer.ts`, `src/components/player`, `src/lib/audio/peaks.ts`, and upload analysis paths.
2. Keep one central audio engine; visual components must observe state, not create competing playback.
3. Use real peaks or analysis data. Never fake waveform data in production paths.
4. Render expensive visuals only for the active track and reduce detail on mobile or reduced motion.
5. Preserve artwork readability and provide standard controls independent of the cover.

## Checklist

- States exist for idle, loading, playing, paused, buffering, error, and purchased access.
- Seek slider/button controls remain accessible.
- Cover treatment never overwrites original artwork and can be disabled.
- Waveform contrast adapts to artwork.
- Visual rendering avoids thousands of DOM bars and per-frame heavy filters.

## Expected Output

Player change with state, data source, accessibility, performance, and artwork-safety notes.
