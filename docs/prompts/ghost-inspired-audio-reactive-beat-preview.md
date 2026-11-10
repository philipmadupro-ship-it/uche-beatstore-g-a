# Ghost Inspired Audio Reactive Beat Preview

## Refined implementation prompt

Replace the beatstore preview drawer's current waveform treatment with a more expressive, clearly audio-reactive player inspired by the visual responsiveness shown in Adieu Ghost plugin previews. Make the waveform reflect the complete audio signal and visibly respond to playback dynamics, especially bass and transient energy, while keeping playhead movement synchronized to audio and seeking precise. Preserve the existing storefront flow, accessible controls, reduced-motion support, and single shared audio engine. Use the repository's real waveform and spectral analysis data; do not fabricate audio response or copy Ghost's code, interface assets, branding, or artwork. Keep rendering efficient on desktop and mobile.

## Acceptance criteria

- The waveform represents the full precomputed signal for the track, rather than a static or partial decorative fragment.
- While playing, the visualization responds clearly to measured loudness and frequency-band energy, with a fast attack and controlled release.
- Playhead and waveform scrolling stay synchronized to the shared player's position; seeking still works with pointer and keyboard.
- Paused playback settles to a static state; reduced-motion preferences suppress animation.
- The design remains legible and performant in the storefront drawer and does not introduce a second audio engine.
- No Ghost plugin code, proprietary visual assets, or branding are copied.
- Verify with project typecheck, focused player tests, build, and browser playback on desktop and mobile when a local checkout is available.

## Reference material

The attached `adieu-ghost-mac.zip` contains an installer and a short installation Read Me. It does not contain source code or visual assets. The public Ghost plugin description presents it as an audio-reactive visualizer and metering tool; use only that high-level concept as inspiration.
