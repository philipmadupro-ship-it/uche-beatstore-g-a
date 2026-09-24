import type { CSSProperties } from 'react';
import type { SectionSettings } from './layout';

/**
 * The visual frame around a storefront section — background colour or image,
 * a darkening overlay, text colour, minimum height, corner radius.
 *
 * ONE function turns settings into styles, and both the Store Editor canvas and
 * the live /store page call it, so the preview cannot drift from what buyers
 * see. It is pure: the tests are what stop a sloppy value (a quote in a URL, a
 * negative height) from reaching a style attribute.
 */
export interface SectionFrame {
  /** Style for the wrapping element; empty when the frame paints nothing. */
  style: CSSProperties;
  /** Overlay opacity 0–0.8 to lay over a background image, or 0 for none. */
  overlay: number;
  /** True when anything is painted — callers skip the wrapper otherwise. */
  active: boolean;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Only plain hex colours: anything else could smuggle CSS into a style value. */
export function safeColor(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return HEX.test(v) ? v : null;
}

/** https URLs or same-origin paths only, with nothing that can break out of url(). */
export function safeImageUrl(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v || /["'()\\\s<>]/.test(v)) return null;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  try {
    return new URL(v).protocol === 'https:' ? v : null;
  } catch {
    return null;
  }
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

export function sectionFrame(settings: Partial<SectionSettings>): SectionFrame {
  const style: CSSProperties = {};
  const background = safeColor(settings.background);
  const image = safeImageUrl(settings.backgroundImage);
  const text = safeColor(settings.textColor);
  const minHeight = clamp(Number(settings.minHeight ?? 0), 0, 1200);
  const radius = clamp(Number(settings.radius ?? 0), 0, 64);

  if (background) style.backgroundColor = background;
  if (image) {
    style.backgroundImage = `url("${image}")`;
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center';
  }
  if (text) style.color = text;
  if (minHeight > 0) style.minHeight = `${Math.round(minHeight)}px`;
  if (radius > 0) {
    style.borderRadius = `${Math.round(radius)}px`;
    style.overflow = 'hidden';
  }
  const overlay = image ? clamp(Number(settings.overlay ?? 0), 0, 80) / 100 : 0;
  const active = Object.keys(style).length > 0;
  if (active) style.position = 'relative';
  return { style, overlay, active };
}
