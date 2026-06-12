const LEGACY_TO_CHAMPAGNE: Record<string, string> = {
  '#d4bfa0': '#E7D7BE',
  '#8a7a5c': '#C9BCA8',
  '#a08a6a': '#D0C3AF',
  '#e8dcc8': '#F7EBDD',
  '#e8d8b8': '#F3E6D1',
};

export const CHAMPAGNE_ACCENT = '#E7D7BE';

export function normalizeThemeColor(color: string | null | undefined, fallback = CHAMPAGNE_ACCENT) {
  const value = color?.trim();
  if (!value) return fallback;
  return LEGACY_TO_CHAMPAGNE[value.toLowerCase()] ?? value;
}
