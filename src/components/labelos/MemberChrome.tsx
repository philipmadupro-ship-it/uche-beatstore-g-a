'use client';

/**
 * The bar for Label OS pages that sit OUTSIDE an org shell (`/o`, the org
 * picker): a home link and Sign out. Inside an org the TopBar carries both.
 * Without it a member who landed on `/o` had no logo, no way back and no way
 * to end the session. Colours go through the tokens so the archive theme reads.
 */
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export function MemberChrome({ homeHref = '/o', homeLabel = 'Your organizations' }: { homeHref?: string; homeLabel?: string }) {
  const signOut = async () => {
    try {
      await createClient().auth.signOut();
    } finally {
      window.location.assign('/login');
    }
  };
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border-default)] bg-[var(--background-primary)]" data-testid="member-chrome">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6 md:px-10">
        <Link href={homeHref} aria-label={homeLabel} className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-[var(--text-primary)]">
            <span className="text-[10px] font-black tracking-tighter text-[var(--text-inverse)]">U2C</span>
          </span>
          <span className="hidden truncate text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-primary)] sm:inline">{homeLabel}</span>
        </Link>
        <div className="flex-1" />
        <button
          type="button"
          onClick={signOut}
          data-testid="member-sign-out"
          className="tap inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border-default)] px-3 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
        >
          <LogOut size={14} aria-hidden="true" />
          Sign out
        </button>
      </div>
    </header>
  );
}
