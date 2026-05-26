'use client';

/**
 * /analytics — Producer dashboard.
 *
 * Three top-line numbers (plays, sales, gross), a 30-day sparkline, a
 * top-tracks leaderboard, and a recent-activity feed. All numbers come
 * from /api/analytics in a single round-trip.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import {
  Loader2, BarChart3, Headphones, DollarSign, ShoppingBag,
  Music, Layers, AlertCircle,
} from 'lucide-react';

interface Totals { plays: number; sales_count: number; gross_usd: number }
interface ByTrack { track_id: string; title: string; plays: number; sales: number; gross: number }
interface ByDay { date: string; sales: number; gross: number }
interface RecentSale { kind: 'track' | 'project'; item: string; buyer_email: string; amount: number; created_at: string }

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function AnalyticsPage() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [byTrack, setByTrack] = useState<ByTrack[]>([]);
  const [byDay, setByDay] = useState<ByDay[]>([]);
  const [recent, setRecent] = useState<RecentSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/analytics');
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setTotals(data.totals);
        setByTrack(data.by_track ?? []);
        setByDay(data.by_day ?? []);
        setRecent(data.recent_sales ?? []);
      } catch (err: any) {
        setError(err.message || 'Failed to load analytics');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Sparkline math — bucket the by_day gross into a polyline.
  const sparkline = useMemo(() => {
    if (byDay.length === 0) return null;
    const max = Math.max(1, ...byDay.map((d) => d.gross));
    const w = 600;
    const h = 60;
    const stepX = w / Math.max(1, byDay.length - 1);
    const pts = byDay.map((d, i) => {
      const x = i * stepX;
      const y = h - (d.gross / max) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { w, h, points: pts.join(' '), max };
  }, [byDay]);

  return (
    <DashboardLayout>
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 md:px-10 pt-6 md:pt-10 pb-32">
        <div className="mb-8">
          <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#a08a6a] mb-1">Dashboard</p>
          <h1 className="text-[28px] sm:text-[36px] font-bold tracking-tight text-white leading-none font-heading">
            Analytics
          </h1>
          <p className="text-[12px] text-[#6a5d4a] mt-1.5">
            What's actually selling. All time, with a 30-day breakdown.
          </p>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] py-20 flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-[#4a4338]" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-6 flex items-start gap-3">
            <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-[12px] text-red-300 font-medium">Could not load analytics</p>
              <p className="text-[10px] text-[#a08a6a] mt-1 font-mono">{error}</p>
            </div>
          </div>
        ) : (totals?.plays ?? 0) === 0 && (totals?.sales_count ?? 0) === 0 && (totals?.gross_usd ?? 0) === 0 ? (
          <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] px-6 py-16 text-center">
            <BarChart3 size={28} className="text-[#3a3328] mx-auto mb-3" />
            <p className="text-[14px] text-[#E8DCC8] font-medium mb-1">No activity yet</p>
            <p className="text-[12px] text-[#6a5d4a] max-w-md mx-auto mb-5">
              Once a buyer plays a beat or completes a purchase, the numbers, sparkline, and top-tracks leaderboard will populate here.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Link href="/store-editor" className="text-[10px] font-mono uppercase tracking-wider px-3 py-2 rounded-md bg-[#D4BFA0] text-[#14110d] hover:bg-[#E8DCC8] transition-colors">
                List tracks for sale
              </Link>
              <Link href="/contacts" className="text-[10px] font-mono uppercase tracking-wider px-3 py-2 rounded-md border border-[#2d2620] text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#3a3328] transition-colors">
                Send a beat
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Totals strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              <Stat label="Plays" value={String(totals?.plays ?? 0)} icon={<Headphones size={14} />} />
              <Stat label="Sales" value={String(totals?.sales_count ?? 0)} icon={<ShoppingBag size={14} />} />
              <Stat label="Gross" value={fmtMoney(totals?.gross_usd ?? 0)} icon={<DollarSign size={14} />} />
            </div>

            {/* 30-day sparkline */}
            {sparkline && (
              <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] p-5 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#a08a6a]">
                    Last 30 days — gross
                  </p>
                  <p className="text-[10px] font-mono text-[#5a5142] tabular-nums">
                    peak {fmtMoney(sparkline.max)}/day
                  </p>
                </div>
                <svg
                  viewBox={`0 0 ${sparkline.w} ${sparkline.h + 4}`}
                  preserveAspectRatio="none"
                  className="w-full h-[60px] text-[#D4BFA0]"
                  aria-label="30-day gross revenue sparkline"
                >
                  <polyline
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={sparkline.points}
                  />
                </svg>
                <div className="flex justify-between mt-2 text-[8px] font-mono text-[#3a3328]">
                  <span>{byDay[0] ? fmtDate(byDay[0].date) : ''}</span>
                  <span>today</span>
                </div>
              </div>
            )}

            {/* Top tracks */}
            <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] mb-6 overflow-hidden">
              <div className="px-5 py-3 border-b border-[#1a160f] flex items-center gap-2">
                <BarChart3 size={12} className="text-[#a08a6a]" />
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#a08a6a]">
                  Top tracks
                </p>
              </div>
              {byTrack.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <Music size={20} className="text-[#3a3328] mx-auto mb-2" />
                  <p className="text-[12px] text-[#6a5d4a]">No track activity yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-[#1a160f]">
                  <div className="hidden md:grid grid-cols-[1fr_70px_70px_90px] gap-3 px-5 py-2 text-[8px] font-mono uppercase tracking-[0.2em] text-[#5a5142]">
                    <span>Track</span>
                    <span className="text-right">Plays</span>
                    <span className="text-right">Sales</span>
                    <span className="text-right">Gross</span>
                  </div>
                  {byTrack.map((t) => (
                    <div key={t.track_id} className="grid grid-cols-[1fr_70px_70px_90px] gap-3 px-5 py-2.5">
                      <Link
                        href={`/library/${t.track_id}`}
                        className="text-[12px] text-[#E8DCC8] truncate hover:text-[#D4BFA0] transition-colors"
                      >
                        {t.title}
                      </Link>
                      <span className="text-[11px] font-mono text-[#a08a6a] tabular-nums text-right">{t.plays}</span>
                      <span className="text-[11px] font-mono text-[#a08a6a] tabular-nums text-right">{t.sales}</span>
                      <span className="text-[11px] font-mono font-bold text-white tabular-nums text-right">{fmtMoney(t.gross)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent activity */}
            <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] overflow-hidden">
              <div className="px-5 py-3 border-b border-[#1a160f]">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#a08a6a]">
                  Recent activity
                </p>
              </div>
              {recent.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <ShoppingBag size={20} className="text-[#3a3328] mx-auto mb-2" />
                  <p className="text-[12px] text-[#6a5d4a]">No sales yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-[#1a160f]">
                  {recent.map((s, i) => {
                    const Icon = s.kind === 'project' ? Layers : Music;
                    return (
                      <div key={i} className="flex items-center gap-3 px-5 py-3">
                        <Icon size={11} className="text-[#5a5142] shrink-0" />
                        <span className="text-[11px] font-mono text-[#a08a6a] tabular-nums w-20 shrink-0">
                          {fmtDate(s.created_at)}
                        </span>
                        <span className="text-[12px] text-[#E8DCC8] truncate flex-1">{s.item}</span>
                        <span className="text-[11px] text-[#6a5d4a] truncate hidden sm:block">{s.buyer_email}</span>
                        <span className="text-[12px] font-mono font-bold text-white tabular-nums shrink-0">{fmtMoney(s.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] px-4 py-3">
      <div className="flex items-center gap-1.5 text-[#5a5142] mb-1">
        {icon}
        <span className="text-[9px] font-mono uppercase tracking-[0.2em]">{label}</span>
      </div>
      <p className="text-[20px] font-bold text-white tabular-nums">{value}</p>
    </div>
  );
}
