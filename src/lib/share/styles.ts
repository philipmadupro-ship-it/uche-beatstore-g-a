/**
 * Style catalogue for the 1080×1920 IG share card and the 9:16
 * vertical preview page. Each style is hand-tuned to look like a
 * deliberate designer choice rather than a default OG template.
 *
 * The card renderer (src/app/api/store/share-card/route.tsx) picks
 * a layout by id; the vertical-preview page (/store/[id]/share)
 * does the same for its in-browser stage. Single source of truth so
 * the store-editor's picker stays in sync with both renderers.
 */

export const CARD_STYLES = ['minimal', 'magazine', 'mono', 'glow'] as const;
export type CardStyle = typeof CARD_STYLES[number];

export const VIDEO_STYLES = ['vinyl', 'minimal', 'mono'] as const;
export type VideoStyle = typeof VIDEO_STYLES[number];

interface CardStyleMeta {
  id: CardStyle;
  label: string;
  description: string;
}

interface VideoStyleMeta {
  id: VideoStyle;
  label: string;
  description: string;
}

export const CARD_STYLE_META: CardStyleMeta[] = [
  { id: 'minimal',  label: 'Minimal',  description: 'Centered cover + huge title. Soft accent gradient.' },
  { id: 'magazine', label: 'Magazine', description: 'Asymmetric — cover bleeds right, title stacks left.' },
  { id: 'mono',     label: 'Mono',     description: 'Brutalist black/white with a single accent bar.' },
  { id: 'glow',     label: 'Glow',     description: 'Cover blurred behind a glowing title block.' },
];

export const VIDEO_STYLE_META: VideoStyleMeta[] = [
  { id: 'vinyl',   label: 'Vinyl',   description: 'Spinning cover, accent waveform underneath.' },
  { id: 'minimal', label: 'Minimal', description: 'Static cover, big title, low-noise waveform.' },
  { id: 'mono',    label: 'Mono',    description: 'Monochrome stage with an accent strip.' },
];

export function asCardStyle(input: string | null | undefined): CardStyle {
  if (input && (CARD_STYLES as readonly string[]).includes(input)) return input as CardStyle;
  return 'minimal';
}

export function asVideoStyle(input: string | null | undefined): VideoStyle {
  if (input && (VIDEO_STYLES as readonly string[]).includes(input)) return input as VideoStyle;
  return 'vinyl';
}
