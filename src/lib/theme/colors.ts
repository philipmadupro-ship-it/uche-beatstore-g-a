const LEGACY_TO_CHAMPAGNE: Record<string, string> = {
  '#FFFFFF': '#FFFFFF',
  '#8a7a5c': 'rgba(255,255,255,0.8)',
  '#a08a6a': 'rgba(255,255,255,0.8)',
  '#e8dcc8': '#FFFFFF',
  '#e8d8b8': '#FFFFFF',
};

export const CHAMPAGNE_ACCENT = '#FFFFFF';

export function normalizeThemeColor(color: string | null | undefined, fallback = CHAMPAGNE_ACCENT) {
  const value = color?.trim();
  if (!value) return fallback;
  return LEGACY_TO_CHAMPAGNE[value.toLowerCase()] ?? value;
}
