'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronsRight, ExternalLink, Store } from 'lucide-react';
import { useNavPanel } from '@/hooks/useNavPanel';
import { ALL_GROUPS, activeGroupFor, isItemActive } from './model';
import { cn } from '@/lib/utils';

/**
 * Secondary navigation, as a collapsible right-hand panel.
 *
 * This used to be a second fixed row under the top bar: every surface of the
 * active hub, always on screen, 44px of vertical chrome on every page whether
 * or not the producer was navigating. Vertical space is the scarce axis in a
 * list-heavy app — a track list wants height, not width — so the secondary
 * nav moved to the axis that had room to give.
 *
 * Two states, both persisted:
 *   - Expanded (14rem): hub sections with their surfaces, so any destination
 *     is one click.
 *   - Collapsed (3.25rem): an icon rail of the three hubs. Still one click to
 *     a hub, so collapsing costs reach only for sub-surfaces.
 *
 * Desktop only. Mobile keeps the existing left drawer, where a persistent
 * side rail would eat the content it is meant to serve.
 */
export function NavPanel() {
  const pathname = usePathname();
  const open = useNavPanel((s) => s.open);
  const toggle = useNavPanel((s) => s.toggle);
  const expanded = useNavPanel((s) => s.expanded);
  const toggleSection = useNavPanel((s) => s.toggleSection);

  const activeGroup = activeGroupFor(pathname);

  return (
    <aside
      id="nav-panel"
      aria-label="Secondary navigation"
      className={cn(
        'fixed right-0 top-14 bottom-0 z-20 hidden shrink-0 flex-col border-l border-white/10',
        'bg-[#090907]/95 backdrop-blur-md transition-[width] duration-[var(--dur-med)] ease-[var(--ease-spring)] md:flex',
        open ? 'w-56' : 'w-[3.25rem]',
      )}
    >
      <div className={cn('flex items-center border-b border-white/10 px-2 py-2', open ? 'justify-between' : 'justify-center')}>
        {open && (
          <span className="pl-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">
            Navigate
          </span>
        )}
        <button
          onClick={toggle}
          aria-expanded={open}
          aria-label={open ? 'Collapse navigation panel' : 'Expand navigation panel'}
          title={open ? 'Collapse panel' : 'Expand panel'}
          className="tap grid size-8 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <ChevronsRight
            size={14}
            className={cn('transition-transform duration-[var(--dur-fast)]', open ? '' : 'rotate-180')}
          />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2">
        {ALL_GROUPS.map((g) => {
          const Icon = g.icon;
          const isActiveGroup = activeGroup.key === g.key;
          // The hub you're in is always open. Others remember their own state,
          // so a producer who lives in two hubs can keep both to hand.
          const sectionOpen = isActiveGroup || expanded.includes(g.key);

          if (!open) {
            return (
              <Link
                key={g.key}
                href={g.items[0].href}
                title={g.label}
                aria-label={g.label}
                aria-current={isActiveGroup ? 'page' : undefined}
                className={cn(
                  'mb-1 grid size-9 place-items-center rounded-lg transition-colors',
                  isActiveGroup ? 'bg-[#0D0D0A] text-white' : 'text-white/50 hover:bg-white/[0.06] hover:text-white',
                )}
              >
                <Icon size={15} strokeWidth={1.75} />
              </Link>
            );
          }

          return (
            <div key={g.key} className="mb-1">
              <button
                onClick={() => toggleSection(g.key)}
                aria-expanded={sectionOpen}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                  isActiveGroup ? 'text-white' : 'text-white/50 hover:text-white',
                )}
              >
                <Icon size={13} strokeWidth={1.75} className="shrink-0" />
                <span className="flex-1 truncate font-mono text-[10px] uppercase tracking-[0.15em]">{g.label}</span>
                <ChevronDown
                  size={11}
                  className={cn('shrink-0 transition-transform duration-[var(--dur-fast)]', sectionOpen ? '' : '-rotate-90')}
                />
              </button>

              {sectionOpen && (
                <div className="mt-0.5 space-y-0.5 pl-1.5">
                  {g.items.map((it) => {
                    const active = isItemActive(it.href, pathname);
                    const ItemIcon = it.icon;
                    return (
                      <Link
                        key={it.href}
                        href={it.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-2.5 rounded-lg px-2 py-2 text-[12px] font-medium tracking-tight transition-colors',
                          active
                            ? 'bg-[#0D0D0A] text-white'
                            : 'text-white/55 hover:bg-white/[0.05] hover:text-white',
                        )}
                      >
                        <ItemIcon size={13} strokeWidth={1.75} className="shrink-0" />
                        <span className="truncate">{it.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Secondary destinations, out of the top bar and into the panel where
          they belong — the public storefront is somewhere a producer checks,
          not a control they reach for constantly. */}
      <div className="border-t border-white/10 p-2">
        <Link
          href="/store"
          target="_blank"
          rel="noopener noreferrer"
          title="View public storefront"
          className={cn(
            'flex items-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white',
            open ? 'gap-2.5 px-2 py-2' : 'size-9 justify-center',
          )}
        >
          <Store size={13} className="shrink-0" />
          {open && (
            <>
              <span className="flex-1 truncate text-[12px] font-medium">View storefront</span>
              <ExternalLink size={10} className="shrink-0 opacity-60" />
            </>
          )}
        </Link>
      </div>
    </aside>
  );
}
