'use client';

import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface DrawerAction {
  icon: LucideIcon;
  label: string;
  /** Tailwind color class applied to the icon + label. */
  color: string;
  /** Optional direct handler — when omitted, the parent's onAction(label)
   *  is invoked instead. Lets simple actions wire inline (e.g. opening
   *  a file picker) while complex ones go through the parent's
   *  state-aware dispatcher. */
  action?: () => void;
}

interface Props {
  actions: DrawerAction[];
  /** Used as fallback when a row doesn't carry its own `action`. */
  onAction: (label: string) => void;
  /** Mid-flight deletion disables every row to avoid double-clicks. */
  disabled?: boolean;
  /** Desktop: how many actions show before a "More" expander. Omit = all. */
  defaultVisible?: number;
}

/**
 * Desktop: a few primary actions + a "More" expander (keeps the drawer from
 * ending on a wall of options). Mobile (<sm): primary icon pills + overflow.
 */
export function DrawerActionList({ actions, onAction, disabled, defaultVisible }: Props) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const PRIMARY_COUNT = 5;
  const primary = actions.slice(0, PRIMARY_COUNT);
  const overflow = actions.slice(PRIMARY_COUNT);

  // Desktop collapse: show the first `defaultVisible` until expanded.
  const deskCollapsed = defaultVisible != null && actions.length > defaultVisible && !showAll;
  const deskActions = deskCollapsed ? actions.slice(0, defaultVisible) : actions;
  const hiddenCount = actions.length - (defaultVisible ?? actions.length);

  return (
    <>
      {/* ── Mobile: icon strip + overflow ─────────────────────────── */}
      <div className="sm:hidden px-4 pb-4">
        <div className="flex items-center gap-2 flex-wrap">
          {primary.map((action, i) => {
            const Icon = action.icon;
            return (
              <button
                key={`mob-${i}`}
                onClick={action.action ?? (() => onAction(action.label))}
                disabled={disabled}
                title={action.label}
                className={`flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl bg-[#171511] border border-[#2B2821] hover:border-[#3B372F] hover:bg-[#18140f] transition-all ${action.color} disabled:opacity-40`}
              >
                <Icon size={15} />
                <span className="text-[8px] font-mono uppercase tracking-wider text-[#9B9282] leading-none">
                  {action.label.split(' ')[0]}
                </span>
              </button>
            );
          })}

          {overflow.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setOverflowOpen((o) => !o)}
                title="More actions"
                className="flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl bg-[#171511] border border-[#2B2821] hover:border-[#3B372F] hover:bg-[#18140f] transition-all text-[#9B9282]"
              >
                <MoreHorizontal size={15} />
                <span className="text-[8px] font-mono uppercase tracking-wider leading-none">More</span>
              </button>
              {overflowOpen && (
                <>
                  <div className="fixed inset-0 z-50" onClick={() => setOverflowOpen(false)} />
                  <div className="absolute bottom-full mb-2 right-0 z-60 w-44 bg-[#171511] border border-[#2B2821] rounded-xl shadow-xl overflow-hidden">
                    {overflow.map((action, i) => {
                      const Icon = action.icon;
                      return (
                        <button
                          key={`ov-${i}`}
                          onClick={() => { setOverflowOpen(false); (action.action ?? (() => onAction(action.label)))(); }}
                          disabled={disabled}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-[11px] font-medium hover:bg-[#211F1A] transition-colors ${action.color}`}
                        >
                          <Icon size={13} />
                          {action.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Desktop: primary actions + "More" expander ─────────────── */}
      <div className="hidden sm:block p-6 grid grid-cols-1 gap-1">
        {deskActions.map((action, i) => {
          const Icon = action.icon;
          return (
            <button
              key={`${action.label}-${i}`}
              onClick={action.action ?? (() => onAction(action.label))}
              disabled={disabled}
              className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] text-[#F7EBDD] hover:bg-[#211F1A] transition-all group relative overflow-hidden"
            >
              <div className={`w-8 h-8 rounded-lg bg-[#090907] border border-[#2B2821] flex items-center justify-center ${action.color} opacity-80 group-hover:opacity-100 group-hover:border-[#E7D7BE]/30 transition-all`}>
                <Icon size={16} />
              </div>
              <span className={`${action.color} group-hover:text-white transition-colors`}>{action.label}</span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            </button>
          );
        })}
        {defaultVisible != null && actions.length > defaultVisible && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282] hover:text-[#D0C3AF] hover:bg-[#171511] transition-colors"
          >
            <MoreHorizontal size={12} />
            {showAll ? 'Show less' : `More${hiddenCount > 0 ? ` · ${hiddenCount}` : ''}`}
          </button>
        )}
      </div>
    </>
  );
}
