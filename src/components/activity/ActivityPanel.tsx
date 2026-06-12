'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell, X, Upload, GitBranch, MessageSquare, Send, Star, Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface ActivityItem {
  id: string;
  kind: 'upload' | 'version' | 'comment' | 'send' | 'rating';
  at: string;
  title: string;
  subject_id?: string | null;
  subject_kind?: 'track' | 'project' | 'contact' | null;
  meta?: Record<string, unknown>;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const KIND_META: Record<ActivityItem['kind'], { icon: React.ElementType; color: string }> = {
  upload:  { icon: Upload,        color: 'text-[#F3E6D1]' },
  version: { icon: GitBranch,     color: 'text-[#6DC6A4]' },
  comment: { icon: MessageSquare, color: 'text-[#e8b76a]' },
  send:    { icon: Send,          color: 'text-[#7aa8e8]' },
  rating:  { icon: Star,          color: 'text-[#D6BE7A]' },
};

/**
 * Slide-in activity feed anchored to the right edge.
 *
 * Pulls /api/activity for the last 7 days when opened. Each item links
 * to the relevant subject — tracks open the library detail page,
 * comments jump to the project, sends jump to the contact.
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
type ActivityFilter = 'all' | ActivityItem['kind'];

export function ActivityPanel({ open, onClose }: Props) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local-only filter chip. `all` shows everything; the others narrow
  // by ActivityItem.kind. Counts are derived from the unfiltered list
  // so the chips advertise scope honestly even when the active chip
  // is hiding rows.
  const [filter, setFilter] = useState<ActivityFilter>('all');

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
        className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Panel — slides in from the right edge. Glass surface matches
          the rest of the recent UI work (player bar, drawer header). */}
      <aside
        className="fixed top-0 right-0 bottom-0 z-[90] w-[360px] flex flex-col
                   bg-gradient-to-b from-[#101012]/95 via-[#090907]/95 to-[#090907]/95
                   backdrop-blur-2xl border-l border-white/[0.06]
                   shadow-[-12px_0_40px_rgba(0,0,0,0.5)]
                   animate-in slide-in-from-right duration-300"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
          <div className="flex items-center gap-2">
            <Bell size={13} className="text-[#F3E6D1]" />
            <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#F7EBDD]">
              Activity
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[#B4AA99] hover:text-white hover:bg-white/[0.06] transition-colors"
            aria-label="Close activity panel"
          >
            <X size={13} />
          </button>
        </div>

        {/* Filter chips — All + one per kind. Each carries the count
            of matching rows so the user knows what's hiding behind a
            chip before clicking. The strip stays mounted even while
            loading; rendering chips with zero counts is fine. */}
        <div className="px-3 pt-3 pb-2 border-b border-white/[0.04] overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-1.5">
            {(['all', 'upload', 'version', 'comment', 'send', 'rating'] as const).map((k) => {
              const count = k === 'all' ? items.length : items.filter((i) => i.kind === k).length;
              const active = filter === k;
              const meta = k === 'all' ? null : KIND_META[k];
              const Icon = meta?.icon;
              return (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={cn(
                    'shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider transition-colors border',
                    active
                      ? 'bg-[#342F27] text-[#F3E6D1] border-[#C9BCA8]/60'
                      : 'bg-transparent text-[#B4AA99] border-white/[0.06] hover:text-[#F7EBDD] hover:border-white/[0.12]',
                  )}
                >
                  {Icon && <Icon size={9} className={active ? 'text-[#F3E6D1]' : meta!.color} />}
                  <span>{k === 'all' ? 'All' : k}</span>
                  <span className={cn('font-bold tabular-nums', active ? 'text-[#F3E6D1]' : 'text-[#9B9282]')}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[#837B6D]">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : error ? (
            <div className="px-3 py-8 text-center">
              <p className="text-[11px] text-[#D6BE7A] mb-2">Couldn’t load activity</p>
              <p className="text-[10px] text-[#9B9282] font-mono">{error}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-16 text-center text-[#837B6D]">
              <p className="text-[12px]">Nothing yet in the last 7 days.</p>
              <p className="text-[10px] mt-1.5 text-[#6E685B]">Uploads, comments, sends and ratings will land here.</p>
            </div>
          ) : (() => {
            const visible = filter === 'all' ? items : items.filter((i) => i.kind === filter);
            if (visible.length === 0) {
              return (
                <div className="px-3 py-16 text-center text-[#837B6D]">
                  <p className="text-[12px]">No {filter} activity in the last 7 days.</p>
                  <button
                    onClick={() => setFilter('all')}
                    className="text-[10px] mt-2 text-[#F3E6D1] hover:text-white transition-colors underline underline-offset-2"
                  >
                    Show all
                  </button>
                </div>
              );
            }
            return (
              <ul className="space-y-0.5">
                {visible.map((item) => (
                  <ActivityRow key={item.id} item={item} onNavigate={onClose} />
                ))}
              </ul>
            );
          })()}
        </div>
      </aside>
    </>,
    document.body,
  );
}

/**
 * Single activity row. Hover-highlights subtly; clicking jumps to the
 * subject (track / project / contact) and dismisses the panel so the
 * user lands directly on the relevant view.
 */
function ActivityRow({ item, onNavigate }: { item: ActivityItem; onNavigate: () => void }) {
  const { icon: Icon, color } = KIND_META[item.kind];
  const href = subjectHref(item);
  const time = relativeTime(item.at);

  const body = (
    <div className="flex gap-3 px-3 py-2.5 rounded-md hover:bg-white/[0.03] transition-colors cursor-pointer group">
      <div className={cn(
        'w-7 h-7 rounded-full flex items-center justify-center shrink-0 border border-white/[0.05]',
        'bg-white/[0.03]',
      )}>
        <Icon size={12} className={color} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-[#F7EBDD] leading-snug line-clamp-2 group-hover:text-white transition-colors">
          {item.title}
        </p>
        <p className="text-[10px] text-[#9B9282] mt-0.5 font-mono tabular-nums">
          {time}
        </p>
      </div>
    </div>
  );

  return (
    <li>
      {href ? (
        <Link href={href} onClick={onNavigate}>{body}</Link>
      ) : (
        body
      )}
    </li>
  );
}

function subjectHref(item: ActivityItem): string | null {
  if (!item.subject_id || !item.subject_kind) return null;
  switch (item.subject_kind) {
    case 'track':   return `/library/${item.subject_id}`;
    case 'project': return `/projects/${item.subject_id}`;
    case 'contact': return `/contacts`; // CRM is list-only — no per-contact route
    default:        return null;
  }
}

/**
 * Compact "5m ago / 3h ago / 2d ago" formatter. Falls back to a full
 * date once we're past 7 days (the activity window itself is 7 days,
 * so this branch is mostly defensive against clock skew).
 */
function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1)    return 'just now';
  if (min < 60)   return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)    return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7)    return `${day}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
