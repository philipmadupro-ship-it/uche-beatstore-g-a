export const deRochePrimitives = {
  black950: '#0B0B0A',
  black900: '#11110F',
  charcoal850: '#181815',
  charcoal800: '#1E1E1A',
  basalt750: '#282722',
  stone700: '#34322C',
  earth650: '#413B32',
  umber600: '#554A3D',
  taupe550: '#6C6255',
  stone500: '#80776A',
  clay450: '#928779',
  beige400: '#AA9C89',
  sand350: '#B9AA95',
  limestone300: '#C8BBA7',
  bone200: '#D8CEBE',
  chalk150: '#E6DED1',
  paper100: '#EEE8DD',
} as const;

export const deRocheWavePalette = {
  sub: '#A9412D',
  bass: '#D66738',
  lowMid: '#C88B46',
  mid: '#9A6E83',
  highMid: '#695FAD',
  high: '#3C78A8',
  air: '#71A4B5',
} as const;

export const accentStudies = {
  original: {
    name: 'Original champagne accent',
    brandPrimary: '#E7D7BE',
    brandPrimaryHover: '#F3E6D1',
    brandPrimaryActive: '#C9BCA8',
    brandOnPrimary: deRochePrimitives.black900,
  },
  luxuryBeige: {
    name: 'Luxury beige',
    brandPrimary: '#C4B49C',
    brandPrimaryHover: '#D0C2AE',
    brandPrimaryActive: '#AA9980',
    brandOnPrimary: deRochePrimitives.black900,
  },
  earthDigitalDual: {
    name: 'Earth interface, digital audio',
    brandPrimary: '#C4B49C',
    brandPrimaryHover: '#D0C2AE',
    brandPrimaryActive: '#AA9980',
    brandOnPrimary: deRochePrimitives.black900,
    audioOnlyPalette: deRocheWavePalette,
  },
} as const;

export type SemanticColorTokens = {
  backgroundPrimary: string;
  backgroundSecondary: string;
  backgroundElevated: string;
  backgroundRecessed: string;
  backgroundInverse: string;
  surfacePrimary: string;
  surfaceSecondary: string;
  surfaceHover: string;
  surfaceActive: string;
  surfaceSelected: string;
  surfaceDisabled: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  textDisabled: string;
  borderSubtle: string;
  borderDefault: string;
  borderStrong: string;
  borderFocus: string;
  brandPrimary: string;
  brandPrimaryHover: string;
  brandPrimaryActive: string;
  brandOnPrimary: string;
  waveLow: string;
  waveLowMid: string;
  waveMid: string;
  waveHighMid: string;
  waveHigh: string;
  success: string;
  warning: string;
  error: string;
  information: string;
};

export function semanticColorsToCssVars(colors: SemanticColorTokens) {
  return {
    '--background-primary': colors.backgroundPrimary,
    '--background-secondary': colors.backgroundSecondary,
    '--background-elevated': colors.backgroundElevated,
    '--background-recessed': colors.backgroundRecessed,
    '--background-inverse': colors.backgroundInverse,
    '--surface-primary': colors.surfacePrimary,
    '--surface-secondary': colors.surfaceSecondary,
    '--surface-hover': colors.surfaceHover,
    '--surface-active': colors.surfaceActive,
    '--surface-selected': colors.surfaceSelected,
    '--surface-disabled': colors.surfaceDisabled,
    '--text-primary': colors.textPrimary,
    '--text-secondary': colors.textSecondary,
    '--text-tertiary': colors.textTertiary,
    '--text-inverse': colors.textInverse,
    '--text-disabled': colors.textDisabled,
    '--border-subtle': colors.borderSubtle,
    '--border-default': colors.borderDefault,
    '--border-strong': colors.borderStrong,
    '--border-focus': colors.borderFocus,
    '--brand-primary': colors.brandPrimary,
    '--brand-primary-hover': colors.brandPrimaryHover,
    '--brand-primary-active': colors.brandPrimaryActive,
    '--brand-on-primary': colors.brandOnPrimary,
    '--wave-low': colors.waveLow,
    '--wave-low-mid': colors.waveLowMid,
    '--wave-mid': colors.waveMid,
    '--wave-high-mid': colors.waveHighMid,
    '--wave-high': colors.waveHigh,
    '--success': colors.success,
    '--warning': colors.warning,
    '--error': colors.error,
    '--information': colors.information,
  } as const;
}
