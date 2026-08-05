'use client';

import { useNavPanel } from '@/hooks/useNavPanel';
import { cn } from '@/lib/utils';

/**
 * Insets the page content so it clears the secondary nav panel.
 *
 * The panel is fixed (it must not scroll away with the page), so the content
 * has to be told how much room to leave. Padding rather than a margin or a
 * grid column: every dashboard page already assumes a full-width main, and a
 * grid would reflow layouts that centre on the viewport.
 *
 * Client component, kept separate from the layout so the layout itself stays
 * a server component and the pages under it are unaffected.
 */
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const open = useNavPanel((s) => s.open);

  return (
    <main
      className={cn(
        // pt-14 clears the single-row top bar. It was pt-[100px] when a second
        // fixed row of sub-tabs sat under it; that row is now the panel.
        'min-h-screen pt-14 pb-28 transition-[padding] duration-[var(--dur-med)] ease-[var(--ease-spring)]',
        open ? 'md:pr-56' : 'md:pr-[3.25rem]',
      )}
    >
      {children}
    </main>
  );
}
