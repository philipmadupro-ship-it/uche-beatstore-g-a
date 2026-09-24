'use client';

import { useEffect, useRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * The app's checkbox. A real <input type="checkbox"> (so forms, labels,
 * Space and screen readers all behave natively) with the browser's own
 * drawing switched off and the control language drawn on top: translucent at
 * rest, a white fill when checked — selection is STATE, and state is white
 * (design-direction principle 3). The old `accent-[var(--accent)]` gave a
 * champagne OS checkbox that looked different on every browser.
 *
 * `indeterminate` is a DOM property, not an attribute, so it is set in an
 * effect — it is what a "select page" header shows when some rows are picked.
 * The ::after hit area keeps a 44px touch target around a 16px box.
 */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { indeterminate?: boolean };

export function Checkbox({ indeterminate = false, className, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <span className={cn('relative inline-grid size-4 shrink-0 place-items-center', className)}>
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          'peer size-4 cursor-pointer appearance-none rounded-[5px] border border-white/20 bg-white/[0.06] transition-colors',
          'hover:border-white/30 hover:bg-white/[0.10]',
          'checked:border-white checked:bg-white indeterminate:border-white/60 indeterminate:bg-white/60',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-1 focus-visible:ring-offset-[#090907]',
          'disabled:cursor-not-allowed disabled:opacity-40',
          "after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
        )}
        {...rest}
      />
      <svg viewBox="0 0 12 12" aria-hidden className="pointer-events-none absolute size-3 text-black opacity-0 peer-checked:opacity-100">
        <path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span aria-hidden className="pointer-events-none absolute h-[2px] w-2 rounded bg-black opacity-0 peer-indeterminate:opacity-100" />
    </span>
  );
}
