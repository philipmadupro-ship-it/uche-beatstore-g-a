'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A collapsible section: summary always visible, detail on demand.
 *
 * Generalised from the accordion the store editor had built for itself, which
 * was the one page already doing this right — fourteen sections of settings
 * behind headers instead of a wall. The pattern belongs in the primitives so
 * the rest of the app can stop rendering everything at once.
 *
 * The rule this encodes: a collapsed section must still say what is inside it.
 * A header that hides its content without a count, a state or a summary just
 * moves the work from reading to clicking. That is why `summary` sits next to
 * the title rather than inside the panel.
 *
 * Uncontrolled by default; pass `open` + `onOpenChange` when the state has to
 * live somewhere else (persisted, or shared with a sibling).
 */
export interface DisclosureProps {
  title: string;
  /** Shown beside the title while collapsed — a count, a state, a preview. */
  summary?: string;
  icon?: React.ReactNode;
  /** Emphasis for sections that are reporting a problem. Uses the palette's
   *  red tokens rather than amber: amber reads as "in progress" next to the
   *  store's own gold accents, and this is reporting lost revenue. */
  tone?: 'default' | 'warning';
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: React.ReactNode;
}

export function Disclosure({
  title,
  summary,
  icon,
  tone = 'default',
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className = '',
  children,
}: DisclosureProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolled;
  const setOpen = (v: boolean) => {
    if (!isControlled) setUncontrolled(v);
    onOpenChange?.(v);
  };

  const panelId = useId();

  return (
    <section
      className={cn(
        'overflow-hidden rounded-xl border',
        tone === 'warning'
          ? 'border-[var(--error)]/45 bg-[var(--error-strong)]/[0.05]'
          : 'border-white/10 bg-white/[0.02]',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className="tap flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {icon && <span className="shrink-0">{icon}</span>}
          <span
            className={cn(
              'truncate font-mono text-[10px] uppercase tracking-[0.2em]',
              tone === 'warning' ? 'text-[var(--error-text)]' : 'text-white/70',
            )}
          >
            {title}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {summary && (
            <span className="hidden truncate font-mono text-[10px] text-white/35 sm:inline">
              {summary}
            </span>
          )}
          <ChevronDown
            size={13}
            aria-hidden
            className={cn(
              'shrink-0 text-white/40 transition-transform duration-[var(--dur-fast)]',
              open ? '' : '-rotate-90',
            )}
          />
        </span>
      </button>
      {open && (
        <div id={panelId} className="border-t border-white/10 px-4 pb-4 pt-3">
          {children}
        </div>
      )}
    </section>
  );
}
