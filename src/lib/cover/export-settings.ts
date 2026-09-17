/**
 * What "export" actually means for a given set of choices.
 *
 * The studio shipped eight fixed presets and nothing else: no format choice, no
 * quality control, no custom size, no transparent background, and a filename
 * derived silently from the document name. That is fine until the moment you
 * need a transparent PNG logo lockup or a smaller JPEG for an email, and then
 * there is simply no way to ask for it.
 *
 * The rules about which options apply to which format are the fiddly part, and
 * they are genuinely error-prone:
 *
 *   - Quality is meaningless for PNG. A quality slider that visibly does
 *     nothing is worse than no slider.
 *   - JPEG has no alpha channel at all. Requesting transparency and getting a
 *     BLACK background — which is what a canvas does when you ask it for a
 *     transparent JPEG — is the kind of surprise that ruins an upload someone
 *     already sent to a distributor.
 *
 * So the resolution lives here as pure functions with tests, rather than as
 * conditionals scattered through a panel component.
 */

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'svg';

export const exportFormats: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'png', label: 'PNG', hint: 'Lossless. Supports transparency.' },
  { id: 'jpeg', label: 'JPG', hint: 'Smallest. No transparency.' },
  { id: 'webp', label: 'WebP', hint: 'Small and lossless-ish. Supports transparency.' },
  { id: 'svg', label: 'SVG', hint: 'Vector. Fonts and images embedded.' },
];

export type ExportSettings = {
  width: number;
  height: number;
  format: ExportFormat;
  /** 0..1. Ignored by formats that are not lossy. */
  quality: number;
  /** Ignored by formats without an alpha channel. */
  transparent: boolean;
  /** Base name, without extension. */
  filename: string;
};

export const EXPORT_MIN = 16;
export const EXPORT_MAX = 8192;

/** Only lossy formats have a meaningful quality dial. */
export function supportsQuality(format: ExportFormat): boolean {
  return format === 'jpeg' || format === 'webp';
}

/** Only formats with an alpha channel can be transparent. */
export function supportsTransparency(format: ExportFormat): boolean {
  return format === 'png' || format === 'webp' || format === 'svg';
}

export function mimeTypeFor(format: ExportFormat): string {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  if (format === 'svg') return 'image/svg+xml';
  return 'image/png';
}

export function extensionFor(format: ExportFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

/**
 * A filesystem-safe base name.
 *
 * Empty input falls back rather than producing a file called ".png", and a
 * name is never allowed to carry a path separator out of the app.
 */
export function safeFilenameBase(name: string, fallback = 'cover-art'): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

export function exportFilename(settings: Pick<ExportSettings, 'filename' | 'format'>): string {
  return `${safeFilenameBase(settings.filename)}.${extensionFor(settings.format)}`;
}

export function clampExportSize(value: number): number {
  if (Number.isNaN(value)) return EXPORT_MIN;
  return Math.round(Math.min(EXPORT_MAX, Math.max(EXPORT_MIN, value)));
}

export type ResolvedExport = {
  width: number;
  height: number;
  format: ExportFormat;
  mimeType: string;
  /** Always a number the canvas will accept, even where it is ignored. */
  quality: number;
  /** What will ACTUALLY happen, after format capability is applied. */
  transparent: boolean;
  filename: string;
  /** Set when a requested option was dropped, so the UI can say why. */
  notes: string[];
};

/**
 * Turn a request into what will really be produced.
 *
 * Never silently does something different from what it reports: if
 * transparency is dropped because the format cannot carry it, that shows up in
 * `notes` for the panel to surface rather than being quietly ignored.
 */
export function resolveExport(settings: ExportSettings): ResolvedExport {
  const format = settings.format;
  const notes: string[] = [];

  let transparent = settings.transparent;
  if (transparent && !supportsTransparency(format)) {
    transparent = false;
    notes.push('JPG has no transparency — the background colour is used instead.');
  }

  let quality = settings.quality;
  if (!supportsQuality(format)) {
    // Canvas ignores the argument for PNG, but pinning it to 1 keeps the
    // reported value honest rather than showing a stale 0.8 that does nothing.
    quality = 1;
  }
  quality = Math.min(1, Math.max(0.1, quality));

  return {
    width: clampExportSize(settings.width),
    height: clampExportSize(settings.height),
    format,
    mimeType: mimeTypeFor(format),
    quality,
    transparent,
    filename: exportFilename(settings),
    notes,
  };
}

/** A one-line summary of the export, for the panel. */
export function describeExport(resolved: ResolvedExport): string {
  const parts = [`${resolved.width}×${resolved.height}`, resolved.format.toUpperCase()];
  if (supportsQuality(resolved.format)) parts.push(`${Math.round(resolved.quality * 100)}% quality`);
  if (resolved.transparent) parts.push('transparent');
  return parts.join(' · ');
}

/**
 * Scale an artboard to a target long edge, preserving aspect.
 *
 * Used by the "match artboard" and preset-scale actions so a 9:16 board does
 * not get squashed into a square export.
 */
export function fitExportSize(
  boardWidth: number,
  boardHeight: number,
  longEdge: number,
): { width: number; height: number } {
  const ratio = boardWidth >= boardHeight
    ? { w: 1, h: boardHeight / boardWidth }
    : { w: boardWidth / boardHeight, h: 1 };
  return {
    width: clampExportSize(longEdge * ratio.w),
    height: clampExportSize(longEdge * ratio.h),
  };
}
