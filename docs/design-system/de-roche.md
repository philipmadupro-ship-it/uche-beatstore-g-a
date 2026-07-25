# De Roche Design System

## Purpose

This is the first implementation layer for the De Roche Beatstor prompt. It keeps the existing Beatstor product requirements active while adding central configuration for the darker earth-and-stone art direction.

## Current Audit

- Existing local fonts: Akira Expanded, Synkopy, Panchang, Inter, LaBruja.
- Current player architecture: one Zustand-backed player state in `src/hooks/usePlayer.ts` with a headless `SimpleAudioEngine`.
- Existing waveform path: `MiniWaveform`, `WavePlayer`, `peaks_url`, and `src/lib/audio/peaks.ts`.
- Existing palette: warm dark surfaces with champagne accent in `src/app/globals.css` and `src/lib/theme/colors.ts`.

## Token Entry Points

- Primitive colours: `src/design-system/foundations/colors.ts`
- Typography tokens: `src/design-system/foundations/typography.ts`
- Themes: `src/design-system/themes/de-roche-night.ts` and `src/design-system/themes/de-roche-archive.ts`
- Player presets: `src/design-system/presets/player-presets.ts`
- Cover-art presets: `src/design-system/presets/cover-art-presets.ts`
- Cover-art SVG renderer: `src/design-system/presets/cover-art-renderer.ts`
- Cover-art raster exporter: `src/design-system/presets/cover-art-raster.ts`
- Cover-art import validation: `src/lib/upload/image-validation.ts` and `src/design-system/presets/cover-art-import.ts`
- Public exports: `src/design-system/index.ts`

## Design System Lab

- Route: `/dev/design-system`
- Source: `src/app/dev/design-system/page.tsx` and `src/components/cover-art/CoverArtStudioClient.tsx`
- Access guard: `src/design-system/dev-access.ts`

The lab previews the De Roche Night and Archive themes, semantic CSS variables, local typography roles, the De Roche waveform palette, and player presets. It returns 404 in production and is not linked from public navigation.

## Cover Art Studio

- Route: `/cover-art`
- Source: `src/app/(dashboard)/cover-art/page.tsx`, reusing `src/components/cover-art/CoverArtStudioClient.tsx` with producer-facing copy.
- Navigation: Store hub and legacy sidebar.

The dashboard studio now exposes the generated-cover pipeline inside an editor shell rather than a configuration document: choose a source, pick a visual direction, edit selectable layers on a central artboard, tune typography/palette/waveform properties, export/download, upload generated art, and attach the uploaded URL to track, project, playlist, or profile hero records.

Current editor capabilities:

- Three-region desktop workspace: left tool rail, contextual controls, central artboard, right inspector, top command bar, and bottom audio strip.
- Source workflow: track/project/playlist/empty design selection using existing authenticated list routes.
- Direction workflow: four original visual directions, each generating a serializable editable document.
- Layer model: text, image, shape, waveform, and texture layers with selection, movement, locking, visibility, z-order, duplicate, delete, opacity, rotation, and dimensions.
- Typography editing: selected text layers can be edited from the panel or directly on the canvas by double-clicking.
- Palette editing: swatches apply to selected text/shape/waveform layers or to the canvas background.
- Waveform editing: waveform layers expose mode, amplitude, stroke, smoothing, and band colour controls. Track sources with `peaks_url` load real peak sidecars into the artwork layer; otherwise the editor labels the layer as a preview grid until analysis/backfill exists.
- Export/upload/attach: SVG and raster export remain available, generated art uploads through `/api/upload/image`, and uploaded URLs can attach to track/project/playlist/profile fields.

## Theme Direction

`de-roche-night` is the default target: carbon, charcoal, basalt, stone, beige, and bone. Depth should come from tonal separation rather than large shadows.

`de-roche-archive` is the light editorial target: printed catalogue paper, warm stone, carbon text, and restrained separators.

## Player Direction

The cover-waveform player must use real waveform or analysis data. The current persistent player and queue should remain the playback authority; cover visuals should observe that state instead of creating another audio engine.

Vivid spectral colours are reserved for audio information: waveform, playhead, cue markers, analysis, stems, and active playback details.

## Safe To Edit

- Theme semantic token values.
- Player preset numeric values.
- Typography token sizes and line heights after readability checks.

## Accessibility/Performance Sensitive

- `brandPrimary` and text/background contrast.
- `waveformOpacity`, `waveformSaturation`, and blend modes.
- `artworkMotionStrength`.
- Any setting that increases animation or per-frame image processing.

## Remaining Work

- Refactor components from legacy hardcoded colours to semantic tokens.
- Implement the real cover-waveform rendering surface.
- Add adaptive artwork contrast and view-original safety controls.
- Add true resize/rotate handles, persisted autosave/reopen, saved templates, preview gallery contexts, mobile bottom-sheet workflow, and deeper waveform/audio analysis controls.
- Run browser screenshot QA against real uploaded covers.
