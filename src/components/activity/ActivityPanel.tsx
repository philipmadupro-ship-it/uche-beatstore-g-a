'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Bell, X, Loader2 } from 'lucide-react';
import { useDialogBehavior } from '@/hooks/useDialogBehavior';
import {
  ACTIVITY_GROUPS, GROUP_LABEL, filterByGroup, groupByDay, groupCounts,
  type ActivityGroup, type ActivityItem,
} from '@/lib/dashboard/activity-taxonomy';
import { formatRelativeTime } from '@/lib/notifications/presentation';
import { ActivityRow, chipClass } from './activity-ui';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Slide-in activity feed anchored to the right edge.
 *
 * Pulls /api/activity for the last 7 days when opened. What counts as an
 * event, its group, wording and link live in lib/dashboard/activity-taxonomy;
 * rows are grouped by day and filtered by group (Music / Sales / Artists / Sharing).
 *
 * Implementation notes:
 *  - Portaled to <body> so the panel escapes any parent stacking context
 *    (Player bar / DashboardLayout's transforms).
 *  - 320px wide column on the right; the rest of the page dims via a
 *    semi-transparent backdrop that closes the panel on click.
 *  - Fetches only on open. No realtime sub — opening the panel is the
 *    user's intent signal, so we don't need to keep it warm in the
 *    background.
 */
type ActivityFilter = 'all' | ActivityGroup;

export function ActivityPanel({ open, onClose }: Props) {
  const panelRef = useDialogBehavior({ open, onClose });
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local-only filter chip. `all` shows everything; the others narrow
  // by ActivityItem.kind. Counts are derived from the unfiltered list
  // so the chips advertise scope honestly even when the active chip
  // is hiding rows.
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const counts = groupCounts(items);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const to = new Date().toISOString();
        const res = await fetch(`/api/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        setItems((data?.activity ?? []) as ActivityItem[]);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load activity');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/* Backdrop — click to dismiss. Lighter than a modal because the
          panel is informational, not a focus-trap. */}
      <div
 className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm ui-fade-in duration-200"
        onClick={onClose}
      />

      {/* Panel — slides in from the right edge. Glass surface matches
          the rest of the recent UI work (player bar, drawer header). */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Recent activity"
        tabIndex={-1}
        className="fixed top-0 right-0 bottom-0 z-[90] w-[360px] flex flex-col
                   bg-gradient-to-b from-[#101012]/95 via-[#090907]/95 to-[#090907]/95
                   backdrop-blur-2xl border-l border-white/[0.06]
                   shadow-[-12px_0_40px_rgba(0,0,0,0.5)]
 ui-drawer-right duration-300 focus:outline-none"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
          <div className="flex items-center gap-2">
            <Bell size={13} className="text-white" />
            <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-white">
              Activity
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
            aria-label="Close activity panel"
          >
            <X size={13} />
          </button>
        </div>

        {/* Group chips — All + Music / Sales / Artists / Sharing. A group with
            no rows is not offered; counts come from the unfiltered list. */}
        <div className="px-3 pt-3 pb-2 border-b border-white/[0.04]">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter activity by group">
            {(['all', ...ACTIVITY_GROUPS.filter((g) => counts[g] > 0)] as ActivityFilter[]).map((k) => {
              const count = k === 'all' ? items.length : counts[k];
              const active = filter === k;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(k)}
                  className={chipClass(active)}
                >
                  <span>{k === 'all' ? 'All' : GROUP_LABEL[k]}</span>
                  <span className={cn('font-bold tabular-nums', active ? 'text-white' : 'text-white/40')}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-white/40">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : error ? (
            <div className="px-3 py-8 text-center">
              <p className="text-[11px] text-white mb-2">Couldn’t load activity</p>
              <p className="text-[10px] text-white/40 font-mono">{error}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-16 text-center text-white/40">
              <p className="text-[11px]">Nothing yet in the last 7 days.</p>
              <p className="text-[10px] mt-1.5 text-white/30">Uploads, sales, artist replies and sends will land here.</p>
            </div>
          ) : (() => {
            const visible = filterByGroup(items, filter);
            if (visible.length === 0) {
              return (
                <div className="px-3 py-16 text-center text-white/40">
                  <p className="text-[11px]">No {filter === 'all' ? '' : `${GROUP_LABEL[filter].toLowerCase()} `}activity in the last 7 days.</p>
                  <button
                    onClick={() => setFilter('all')}
                    className="text-[10px] mt-2 text-white hover:text-white transition-colors underline underline-offset-2"
                  >
                    Show all
                  </button>
                </div>
              );
            }
            return (
              <div className="space-y-3">
                {groupByDay(visible).map((day) => (
                  <section key={day.key} aria-label={day.label}>
                    <h3 className="px-3 pb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">{day.label}</h3>
                    <ul className="space-y-0.5">
                      {day.items.map((item) => (
                        <ActivityRow key={item.id} item={item} onNavigate={onClose} timeLabel={formatRelativeTime(item.at)} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            );
          })()}
        </div>
      </aside>
    </>,
    document.body,
  );
}
