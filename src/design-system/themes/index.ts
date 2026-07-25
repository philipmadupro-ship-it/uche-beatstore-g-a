import { semanticColorsToCssVars } from '../foundations/colors';
import { deRocheArchiveTheme } from './de-roche-archive';
import { deRocheNightTheme } from './de-roche-night';

export const beatstorThemes = {
  [deRocheNightTheme.id]: deRocheNightTheme,
  [deRocheArchiveTheme.id]: deRocheArchiveTheme,
} as const;

export type BeatstorThemeId = keyof typeof beatstorThemes;

export function getBeatstorTheme(themeId: BeatstorThemeId = 'de-roche-night') {
  return beatstorThemes[themeId];
}

export function getBeatstorThemeCssVars(themeId: BeatstorThemeId = 'de-roche-night') {
  return semanticColorsToCssVars(getBeatstorTheme(themeId).colors);
}

export { deRocheArchiveTheme, deRocheNightTheme };
