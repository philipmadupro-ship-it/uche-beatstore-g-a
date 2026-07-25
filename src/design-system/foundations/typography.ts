export const beatstorTypography = {
  fonts: {
    brand: "'Synkopy', 'Akira Expanded', ui-sans-serif, system-ui",
    interface: "'Akira Expanded', 'Inter', ui-sans-serif, system-ui",
    store: "'Inter', ui-sans-serif, system-ui",
    technical: "'Panchang', 'Inter', ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  weights: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  sizes: {
    xs: '0.625rem',
    sm: '0.75rem',
    md: '0.875rem',
    lg: '1rem',
    xl: '1.125rem',
    '2xl': '1.5rem',
    '3xl': '2rem',
    displaySm: '2.5rem',
    displayMd: '3.5rem',
    displayLg: '4.5rem',
  },
  leading: {
    tight: '1.05',
    heading: '1.12',
    body: '1.45',
    relaxed: '1.65',
  },
  tracking: {
    tight: '0',
    normal: '0',
    wide: '0.08em',
    technical: '0.18em',
  },
} as const;
