import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Class joiner for the shadcn components in `components/shadcn`.
 *
 * Separate from `cn` in `lib/utils` on purpose. That one only joins strings
 * and lets both classes through; this one resolves conflicts, so the LAST
 * class wins — which is what shadcn's `className` overrides rely on.
 *
 * tailwind-merge has to be told about the app's own type utilities. Left to
 * its defaults it reads `text-meta` as a colour (any unknown `text-*` is),
 * so `cn('text-meta', 'text-white/40')` would silently drop the type size.
 * Registering them as font sizes makes them conflict only with other sizes.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['eyebrow', 'micro', 'meta', 'row-title'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
