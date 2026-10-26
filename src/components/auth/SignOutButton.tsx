'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

/**
 * Shared producer sign-out. One behaviour everywhere: Supabase signOut, error
 * toast on failure, hard-nav to /login on success (see useAuth). Used by the
 * TopBar account menu, the mobile drawer, and the Sidebar footer — the
 * Settings/Profile page buttons call the same hook directly.
 */
export function SignOutButton({
  variant = 'menu',
  onDone,
  className,
  label = 'Sign out',
  redirectTo,
}: {
  variant?: 'menu' | 'button' | 'link';
  onDone?: () => void;
  className?: string;
  label?: string;
  redirectTo?: string;
}) {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    if (busy) return;
    setBusy(true);
    const { error } = await signOut(redirectTo ? { redirectTo } : undefined);
    if (error) {
      setBusy(false);
      toast.error('Sign out failed', error);
      return;
    }
    onDone?.();
    // useAuth hard-navigates to /login on success.
  };

  if (variant === 'link') {
    return (
      <button
        type="button"
        onClick={handle}
        disabled={busy}
        aria-label="Sign out"
        className={cn(
          'text-[9px] text-white/50 font-mono uppercase tracking-wider hover:text-white transition-colors disabled:opacity-50',
          className,
        )}
      >
        {busy ? 'Signing out…' : label}
      </button>
    );
  }

  if (variant === 'button') {
    return (
      <button
        type="button"
        onClick={handle}
        disabled={busy}
        aria-label="Sign out"
        className={cn(
          'flex h-9 items-center gap-2 rounded-full border border-white/[0.06] px-3 text-[11px] font-medium text-white/80 transition-all hover:border-red-400/30 hover:text-red-400 disabled:opacity-50',
          className,
        )}
      >
        <LogOut size={13} aria-hidden="true" />
        {busy ? 'Signing out…' : label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={busy}
      aria-label="Sign out"
      className={cn(
        'tap flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium tracking-tight transition-colors',
        'text-red-300/90 hover:bg-red-500/10 hover:text-red-200 disabled:opacity-50',
        className,
      )}
    >
      <LogOut size={17} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{busy ? 'Signing out…' : label}</span>
    </button>
  );
}
