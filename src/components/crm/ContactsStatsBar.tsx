'use client';

import { ChevronDown, BarChart3 } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';

export interface ContactsStats {
  total: number;
  active: number;
  needNudge: number;
  responseRate: number;
  openedCount: number;
  sends: number;
  pipeline: Record<string, number>;
}

const PIPELINE_ROWS: [string, string][] = [
  ['placed', '#6DC6A4'],
  ['negotiating', '#e8a86a'],
  ['interested', 'rgba(255,255,255,0.9)'],
  ['opened', '#7aa8e8'],
  ['sent', 'rgba(255,255,255,0.5)'],
];

function Metric({ color, value, label, className = 'inline-flex' }: { color: string; value: string | number; label: string; className?: string }) {
  return (
    <span className={`shrink-0 items-center gap-1.5 whitespace-nowrap ${className}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[11px] text-white font-medium tabular-nums">{value}</span>
      <span className="text-[11px] text-white/40">{label}</span>
    </span>
  );
}

/** Single compact stats line. Pipeline funnel tucked behind a Popover. */
export function ContactsStatsBar({ stats }: { stats: ContactsStats }) {
  return (
    <div className="mb-5 flex min-w-0 items-center gap-x-3 px-1 sm:gap-x-4">
      {/* One line at every width. The header already counts contacts and the
          response rate is the least useful figure, so a phone keeps the two
          that ask for action; the rest return from sm up. */}
      <Metric className="hidden sm:inline-flex" color="rgba(255,255,255,0.8)" value={stats.total.toLocaleString()} label="contacts" />
      <span className="hidden text-white/20 sm:inline">·</span>
      <Metric color="#6DC6A4" value={stats.active} label="active" />
      <span className="text-white/20">·</span>
      <Metric color="#e8a86a" value={stats.needNudge} label="to nudge" />
      <span className="hidden text-white/20 sm:inline">·</span>
      <Metric className="hidden sm:inline-flex" color="#7aa8e8" value={`${stats.responseRate}%`} label="response" />

      <Popover
        align="left"
        width={240}
        trigger={({ open, toggle, ref }) => (
          <button
            ref={ref}
            onClick={toggle}
            aria-label="Send pipeline"
            className={`ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors sm:px-3 ${
              open ? 'bg-white/10 border-white/30 text-white' : 'border-[var(--border)] text-white/80 hover:text-white hover:border-[var(--border-hover)]'
            }`}
          >
            <BarChart3 size={12} aria-hidden /> <span className="hidden sm:inline">Pipeline</span> <ChevronDown size={11} aria-hidden className={open ? 'rotate-180' : ''} />
          </button>
        )}
      >
        <div className="p-3 space-y-2">
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40 mb-1">Send pipeline</p>
          {stats.sends === 0 ? (
            <p className="text-[11px] text-white/40">No sends yet</p>
          ) : (
            PIPELINE_ROWS.map(([stage, color]) => {
              const n = stats.pipeline[stage] ?? 0;
              const pct = stats.sends > 0 ? Math.round((n / stats.sends) * 100) : 0;
              return (
                <div key={stage} className="flex items-center gap-2">
                  <div className="w-20 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                  <span className="text-[10px] font-mono capitalize text-white/40 flex-1">{stage}</span>
                  <span className="text-[10px] font-mono text-white/80 tabular-nums">{n}</span>
                </div>
              );
            })
          )}
          <div className="pt-2 mt-1 border-t border-[var(--border)] flex items-center justify-between">
            <span className="text-[10px] font-mono text-white/40">Opened</span>
            <span className="text-[10px] font-mono text-white/80">
              {stats.openedCount > 0 ? `${stats.openedCount} · ${Math.round((stats.openedCount / Math.max(1, stats.sends)) * 100)}%` : 'pending'}
            </span>
          </div>
        </div>
      </Popover>
    </div>
  );
}
