import { publicImageUrl } from '@/lib/share/redact';

/**
 * The data a share template is filled from. Plain values only: every field has
 * already been through `buildShareFill`, so a template can trust it.
 */
export type ShareFill = {
  title: string;
  artist: string;
  /** https or site-relative; null = no cover. Never an r2:// reference. */
  coverUrl: string | null;
  /** 0..1 magnitudes, from the PUBLIC peaks sidecar. May be empty. */
  peaks: number[];
  bpm: number | null;
  key: string | null;
  accent: string;
  /** Eyebrow line, e.g. "Now playing". */
  eyebrow: string;
  /** Shown as plain text only — there is no QR in this slice. */
  shareUrl: string | null;
};

export type ShareFillInput = {
  title?: string | null;
  artist?: string | null;
  coverUrl?: string | null;
  peaks?: unknown;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  accent?: string | null;
  eyebrow?: string | null;
  shareUrl?: string | null;
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const PEAK_COUNT = 96;

/** Resample to `count` buckets by bucket PEAK (never an average), 0..1. */
export function normalizePeaks(raw: unknown, count = PEAK_COUNT): number[] {
  if (!Array.isArray(raw)) return [];
  const values = raw.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).map((v) => Math.abs(v));
  if (values.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const from = Math.floor((i * values.length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * values.length) / count));
    let peak = 0;
    for (let j = from; j < to && j < values.length; j += 1) peak = Math.max(peak, values[j]);
    out.push(peak);
  }
  const max = Math.max(...out);
  return max > 0 ? out.map((v) => Math.min(1, Math.max(0.04, v / max))) : [];
}

export function formatKey(key: string | null | undefined, scale: string | null | undefined): string | null {
  const k = (key ?? '').trim();
  if (!k) return null;
  const s = (scale ?? '').trim().toLowerCase();
  return s ? `${k} ${s}` : k;
}

export function buildShareFill(input: ShareFillInput): ShareFill {
  const accent = input.accent && HEX.test(input.accent.trim()) ? input.accent.trim() : '#FFFFFF';
  const bpm = typeof input.bpm === 'number' && Number.isFinite(input.bpm) && input.bpm > 0 ? Math.round(input.bpm) : null;
  return {
    title: (input.title ?? '').trim() || 'Untitled Track',
    artist: (input.artist ?? '').trim() || 'U2C Beatstore',
    coverUrl: publicImageUrl(input.coverUrl),
    peaks: normalizePeaks(input.peaks),
    bpm,
    key: formatKey(input.key, input.scale),
    accent,
    eyebrow: (input.eyebrow ?? '').trim() || 'Now playing',
    shareUrl: publicImageUrl(input.shareUrl),
  };
}

/** Type fitting: no layout engine in SVG, so estimate and wrap ourselves. */
/** Synkopy is a wide display face; uppercase runs wider still. Overestimate rather than clip. */
export const CHAR_WIDTH = 0.9;

export function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = `${last.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
    return kept;
  }
  return lines.map((l) => (l.length > maxChars ? `${l.slice(0, Math.max(1, maxChars - 1))}…` : l));
}

/**
 * Largest size in [min, max] at which `text` fits `width` in at most
 * `maxLines` lines AND `maxHeight` (when given), never breaking a word.
 */
export function fitTitle(text: string, width: number, max: number, min: number, maxLines: number, maxHeight = Infinity) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  for (let size = max; size >= min; size -= 4) {
    const chars = Math.floor(width / (size * CHAR_WIDTH));
    if (chars < 1 || !words.every((w) => w.length <= chars)) continue;
    const lines = wrapLines(text, chars, maxLines + 1);
    if (lines.length <= maxLines && !lines.some((l) => l.endsWith('…')) && lines.length * size * 1.04 <= maxHeight) {
      return { size, lines };
    }
  }
  const chars = Math.max(1, Math.floor(width / (min * CHAR_WIDTH)));
  return { size: min, lines: wrapLines(text, chars, maxLines) };
}
