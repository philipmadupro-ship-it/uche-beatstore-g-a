'use client';

import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ActionMenu } from '@/components/ui/ActionMenu';

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
                className={`flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 hover:border-white/20 hover:bg-[#18140f] transition-all ${action.color} disabled:opacity-40`}
              >
                <Icon size={15} />
                <span className="text-[8px] font-mono uppercase tracking-wider text-white/40 leading-none">
                  {action.label.split(' ')[0]}
                </span>
              </button>
            );
          })}

          {overflow.length > 0 && (
            /* One menu model app-wide. This was hand-rolled and declared
               role="menu" without implementing arrow-key navigation — the
               ARIA contract says a menu is arrow-navigable, so announcing it
               and doing nothing is worse than not announcing it. */
            <ActionMenu
              align="right"
              width={200}
              label="More actions"
              triggerContent={
                <span className="flex flex-col items-center gap-1">
                  <MoreHorizontal size={15} />
                  <span className="text-[8px] font-mono uppercase leading-none tracking-wider">More</span>
                </span>
              }
              triggerClassName="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-white/40 transition-all hover:border-white/20 hover:bg-[#18140f]"
              sections={[{
                id: 'overflow',
                items: overflow.map((action, i) => ({
                  id: `${action.label}-${i}`,
                  label: action.label,
                  disabled,
                  onSelect: action.action ?? (() => onAction(action.label)),
                })),
              }]}
            />
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
              className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] text-white hover:bg-white/[0.05] transition-all group relative overflow-hidden"
            >
              <div className={`w-8 h-8 rounded-lg bg-[#090907] border border-white/10 flex items-center justify-center ${action.color} opacity-80 group-hover:opacity-100 group-hover:border-white/20 transition-all`}>
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
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-[9px] font-mono uppercase tracking-[0.2em] text-white/40 hover:text-white/80 hover:bg-white/[0.04] transition-colors"
          >
            <MoreHorizontal size={12} />
            {showAll ? 'Show less' : `More${hiddenCount > 0 ? ` · ${hiddenCount}` : ''}`}
          </button>
        )}
      </div>
    </>
  );
}
