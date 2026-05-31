'use client';

/**
 * /analytics — Engagement & plays dashboard with advanced filters.
 *
 * Plays, track popularity, and engagement by date range / BPM / type.
 * Revenue and transactions live on /sales, not here.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import {
  Loader2, Headphones, Music, AlertCircle, BarChart3,
  TrendingUp, Radio, ExternalLink, SlidersHorizontal, X, ChevronDown, ChevronUp, Link2,
} from 'lucide-react';
import { TAG_TAXONOMY } from '@/lib/types/tags';
import { SkeletonStatStrip, SkeletonList } from '@/components/ui/Skeleton';

// ── Types ────────────────────────────────────────────────────────
interface Totals { plays: number; sales_count: number; gross_usd: number }
interface ByTrack { track_id: string; title: string; plays: number; sales: number; gross: number }
interface ByDay { date: string; sales: number; gross: number }
interface ShareLinkRow {
  token: string;
  recipient_kind: string | null;
  plays: number;
  unique_opens: number;
  track_count: number;
  top_source: string;
  platforms: Record<string, number>;
  last_play: string | null;
  created_at: string | null;
}

interface TrackMeta {
  id: string;
  type: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  status: string | null;
  track_tags?: Array<{ tag: string; category: string }>;
}

type DatePreset = '7d' | '30d' | '90d' | 'all';
type TypeFilter = 'all' | 'beat' | 'instrumental' | 'song' | 'remix';

const STATUS_OPTIONS = [
  { value: 'maq',        label: 'MAQ',      color: 'bg-[#1a1033] text-[#b39ddb] border-[#534AB7]/40' },
  { value: 'needs_work', label: 'WIP',      color: 'bg-[#1f1a0a] text-[#c8a84b] border-[#3a2f1f]'   },
  { value: 'finished',   label: 'Finished', color: 'bg-[#0a1f0a] text-[#8ecf9f] border-[#1f3a1f]'   },
  { value: 'archived',   label: 'Archived', color: 'bg-[#16130e] text-[#6a5d4a] border-[#1f1a13]'   },
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const DATE_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'beat', label: 'Beats' },
  { value: 'instrumental', label: 'Instrumentals' },
  { value: 'song', label: 'Songs' },
  { value: 'remix', label: 'Remixes' },
];

// ── Page ─────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [byTrack, setByTrack] = useState<ByTrack[]>([]);
  const [byDay, setByDay] = useState<ByDay[]>([]);
  const [byShareLink, setByShareLink] = useState<ShareLinkRow[]>([]);
  const [trackMeta, setTrackMeta] = useState<Map<string, TrackMeta>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Filter state ─────────────────────────────────────────────
  const [datePreset, setDatePreset] = useState<DatePreset>('30d');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [bpmMin, setBpmMin] = useState<string>('');
  const [bpmMax, setBpmMax] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const toggleGenre = (g: string) => setSelectedGenres((prev) => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; });
  const toggleStatus = (s: string) => setSelectedStatuses((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

  const hasActiveFilters = datePreset !== '30d' || typeFilter !== 'all' || selectedGenres.size > 0 || selectedStatuses.size > 0 || bpmMin !== '' || bpmMax !== '';
  const activeFilterCount = [datePreset !== '30d', typeFilter !== 'all', selectedGenres.size > 0, selectedStatuses.size > 0, bpmMin !== '' || bpmMax !== ''].filter(Boolean).length;

  useEffect(() => {
    (async () => {
      try {
        const [analyticsRes, tracksRes] = await Promise.all([
          fetch('/api/analytics'),
          fetch('/api/tracks'),
        ]);
        if (!analyticsRes.ok) {
          const j = await analyticsRes.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${analyticsRes.status}`);
        }
        const analyticsData = await analyticsRes.json();
        setTotals(analyticsData.totals);
        setByTrack(analyticsData.by_track ?? []);
        setByDay(analyticsData.by_day ?? []);
        setByShareLink(analyticsData.by_share_link ?? []);

        if (tracksRes.ok) {
          const tracksData = await tracksRes.json();
          const meta = new Map<string, TrackMeta>();
          for (const t of (Array.isArray(tracksData) ? tracksData : [])) {
            meta.set(t.id, { id: t.id, type: t.type, bpm: t.bpm, key: t.key, scale: t.scale, status: t.status ?? null, track_tags: t.track_tags ?? [] });
          }
          setTrackMeta(meta);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load analytics');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Date cutoff from preset ──────────────────────────────────
  const dateCutoff = useMemo(() => {
    if (datePreset === 'all') return null;
    const days = datePreset === '7d' ? 7 : datePreset === '30d' ? 30 : 90;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }, [datePreset]);

  // ── Filter by_day for chart ──────────────────────────────────
  const filteredByDay = useMemo(() => {
    if (!dateCutoff) return byDay;
    return byDay.filter((d) => d.date >= dateCutoff);
  }, [byDay, dateCutoff]);

  // ── Filter byTrack by genre + state + type + BPM ────────────
  const filteredByTrack = useMemo(() => {
    const bpmLow  = bpmMin !== '' ? Number(bpmMin) : null;
    const bpmHigh = bpmMax !== '' ? Number(bpmMax) : null;

    return byTrack.filter((t) => {
      const meta = trackMeta.get(t.track_id);
      // Type
      if (typeFilter !== 'all' && meta?.type !== typeFilter) return false;
      // State
      if (selectedStatuses.size > 0 && !selectedStatuses.has(meta?.status ?? '')) return false;
      // Genre (from track_tags)
      if (selectedGenres.size > 0) {
        const genres = (meta?.track_tags ?? []).filter((tt) => tt.category === 'genre').map((tt) => tt.tag);
        if (!Array.from(selectedGenres).some((g) => genres.includes(g))) return false;
      }
      // BPM
      if (bpmLow != null || bpmHigh != null) {
        const bpm = meta?.bpm ?? null;
        if (bpm == null) return false;
        if (bpmLow != null && bpm < bpmLow) return false;
        if (bpmHigh != null && bpm > bpmHigh) return false;
      }
      return true;
    });
  }, [byTrack, trackMeta, typeFilter, selectedGenres, selectedStatuses, bpmMin, bpmMax]);

  // ── Filtered plays total ─────────────────────────────────────
  const filteredTotalPlays = useMemo(
    () => filteredByTrack.reduce((a, t) => a + t.plays, 0),
    [filteredByTrack],
  );

  // ── Activity chart ───────────────────────────────────────────
  const activityLine = useMemo(() => {
    if (filteredByDay.length === 0) return null;
    const vals = filteredByDay.map((d) => d.sales);
    const max = Math.max(1, ...vals);
    const w = 400; const h = 44;
    const step = w / Math.max(1, vals.length - 1);
    const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
    return { pts, vals, max, w, h };
  }, [filteredByDay]);

  const maxPlays = useMemo(() => Math.max(1, ...filteredByTrack.map((t) => t.plays)), [filteredByTrack]);

  const isEmpty = !loading && !error && (totals?.plays ?? 0) === 0;

  const resetFilters = () => { setDatePreset('30d'); setTypeFilter('all'); setSelectedGenres(new Set()); setSelectedStatuses(new Set()); setBpmMin(''); setBpmMax(''); };

  return (
    <DashboardLayout>
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 md:px-10 pt-6 md:pt-10 pb-32">

        {/* Header + cross-link */}
        <div className="flex items-start justify-between mb-5 gap-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#a08a6a] mb-1">Dashboard</p>
            <h1 className="text-[28px] sm:text-[36px] font-bold tracking-tight text-white leading-none font-heading">Analytics</h1>
            <p className="text-[12px] text-[#6a5d4a] mt-1.5">Plays and track engagement — not revenue.</p>
          </div>
          <Link href="/sales" className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full border border-[#1f1a13] bg-[#14110d] text-[10px] font-mono text-[#6a5d4a] hover:text-[#E8DCC8] hover:border-[#2d2620] transition-all">
            Revenue & sales <ExternalLink size={10} />
          </Link>
        </div>

        {/* ── Filter bar ──────────────────────────────────────────── */}
        <div className="mb-5">
          {/* Date preset chips + filter toggle */}
          <div className="flex items-center gap-2 flex-wrap">
            {DATE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setDatePreset(value)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors ${
                  datePreset === value
                    ? 'bg-white text-black'
                    : 'bg-white/[0.04] border border-white/[0.06] text-[#a08a6a] hover:text-white hover:bg-white/[0.08]'
                }`}
              >{label}</button>
            ))}
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors ${
                showFilters || hasActiveFilters
                  ? 'bg-[#2A2418] border-[#8A7A5C]/40 text-[#E8D8B8]'
                  : 'bg-white/[0.04] border-white/[0.06] text-[#a08a6a] hover:text-[#E8DCC8]'
              }`}
            >
              <SlidersHorizontal size={12} />
              Filters
              {activeFilterCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-[#D4BFA0] text-black text-[8px] font-bold flex items-center justify-center leading-none">{activeFilterCount}</span>
              )}
            </button>
          </div>

          {/* Expanded filter panel */}
          {showFilters && (
            <div className="mt-3 bg-[#0e0c08] border border-[#1a160f] rounded-xl p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">

              {/* Genre — first-class */}
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2">Genre</p>
                <div className="flex flex-wrap gap-1.5">
                  {TAG_TAXONOMY.genre.map((g) => (
                    <button key={g} onClick={() => toggleGenre(g)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                        selectedGenres.has(g) ? 'bg-[#D4BFA0] text-black border-[#D4BFA0]' : 'border-[#1f1a13] text-[#6a5d4a] hover:text-[#a08a6a] hover:border-[#2d2620]'
                      }`}>{g}</button>
                  ))}
                </div>
              </div>

              {/* State — first-class */}
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2">State</p>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_OPTIONS.map(({ value, label, color }) => (
                    <button key={value} onClick={() => toggleStatus(value)}
                      className={`px-3 py-1 rounded-full text-[11px] font-medium border transition-all ${
                        selectedStatuses.has(value) ? color : 'bg-[#14110d] border-[#1f1a13] text-[#6a5d4a] hover:text-[#a08a6a] hover:border-[#2d2620]'
                      }`}>{label}</button>
                  ))}
                </div>
              </div>

              {/* Advanced: type + BPM */}
              <div>
                <button onClick={() => setAdvancedOpen((v) => !v)} className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] hover:text-[#a08a6a] transition-colors">
                  {advancedOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                  Advanced (type, BPM)
                </button>
                {advancedOpen && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2">Track type</p>
                      <div className="flex flex-wrap gap-1.5">
                        {TYPE_OPTIONS.map(({ value, label }) => (
                          <button key={value} onClick={() => setTypeFilter(value)}
                            className={`px-2.5 py-1 rounded-md text-[10px] font-medium border transition-colors ${typeFilter === value ? 'bg-[#D4BFA0] text-black border-[#D4BFA0]' : 'border-[#1f1a13] text-[#6a5d4a] hover:text-[#E8DCC8] hover:border-[#2d2620]'}`}
                          >{label}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2">BPM range</p>
                      <div className="flex items-center gap-2">
                        <input type="number" placeholder="min" value={bpmMin} onChange={(e) => setBpmMin(e.target.value)}
                          className="w-20 bg-[#14110d] border border-[#1a160f] rounded px-2 py-1.5 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] tabular-nums" />
                        <span className="text-[#3a3328] text-[10px]">–</span>
                        <input type="number" placeholder="max" value={bpmMax} onChange={(e) => setBpmMax(e.target.value)}
                          className="w-20 bg-[#14110d] border border-[#1a160f] rounded px-2 py-1.5 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] tabular-nums" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {hasActiveFilters && (
                <button onClick={resetFilters} className="flex items-center gap-1.5 text-[10px] font-mono text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors">
                  <X size={11} /> Reset all filters
                </button>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <>
            <SkeletonStatStrip count={3} />
            <SkeletonList rows={8} />
          </>
        ) : error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-6 flex items-start gap-3">
            <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-[12px] text-red-300 font-medium">{error}</p>
          </div>
        ) : isEmpty ? (
          <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] px-6 py-16 text-center">
            <Radio size={28} className="text-[#3a3328] mx-auto mb-3" />
            <p className="text-[14px] text-[#E8DCC8] font-medium mb-1">No plays yet</p>
            <p className="text-[12px] text-[#6a5d4a] max-w-md mx-auto mb-5">
              Once someone streams a beat via a share link or your store, plays appear here by track and by day.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Link href="/store-editor" className="text-[10px] font-mono uppercase tracking-wider px-3 py-2 rounded-md bg-[#D4BFA0] text-[#14110d] hover:bg-[#E8DCC8] transition-colors">List tracks for sale</Link>
              <Link href="/contacts" className="text-[10px] font-mono uppercase tracking-wider px-3 py-2 rounded-md border border-[#2d2620] text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#3a3328] transition-colors">Send a beat</Link>
            </div>
          </div>
        ) : (
          <>
            {/* Engagement KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-5">
              <EngagementCard label={`Total plays (${DATE_OPTIONS.find(d => d.value === datePreset)?.label ?? ''})`} value={String(filteredByTrack.length > 0 ? filteredTotalPlays : totals?.plays ?? 0)} icon={<Headphones size={14} />} accent="#D4BFA0" />
              <EngagementCard label="Tracks with plays" value={String(filteredByTrack.filter((t) => t.plays > 0).length)} icon={<Music size={14} />} accent="#9d95e8" />
              <EngagementCard
                label="Avg plays / track"
                value={filteredByTrack.filter((t) => t.plays > 0).length > 0
                  ? (filteredByTrack.reduce((a, t) => a + t.plays, 0) / filteredByTrack.filter((t) => t.plays > 0).length).toFixed(1)
                  : '—'}
                icon={<TrendingUp size={14} />}
                accent="#6DC6A4"
              />
            </div>

            {/* Activity chart */}
            {activityLine && activityLine.vals.some(Boolean) && (
              <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] px-5 py-4 mb-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142]">Activity · {DATE_OPTIONS.find(d => d.value === datePreset)?.label}</p>
                  <p className="text-[9px] font-mono text-[#3a3328]">
                    {filteredByDay[0] ? fmtDate(filteredByDay[0].date) : ''} → today
                  </p>
                </div>
                <svg viewBox={`0 0 ${activityLine.w} ${activityLine.h}`} className="w-full" preserveAspectRatio="none" style={{ height: activityLine.h }}>
                  <defs>
                    <linearGradient id="engageGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#9d95e8" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#9d95e8" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <polyline points={`0,${activityLine.h} ${activityLine.pts} ${activityLine.w},${activityLine.h}`} fill="url(#engageGrad)" stroke="none" />
                  <polyline points={activityLine.pts} fill="none" stroke="#9d95e8" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
              </div>
            )}

            {/* Filter summary chips */}
            {hasActiveFilters && (
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-[9px] font-mono text-[#5a5142] uppercase tracking-wider">Active filters:</span>
                {datePreset !== '30d' && <Chip label={DATE_OPTIONS.find(d => d.value === datePreset)?.label ?? ''} onRemove={() => setDatePreset('30d')} />}
                {Array.from(selectedGenres).map((g) => <Chip key={g} label={g} onRemove={() => toggleGenre(g)} />)}
                {Array.from(selectedStatuses).map((s) => <Chip key={s} label={STATUS_OPTIONS.find(o => o.value === s)?.label ?? s} onRemove={() => toggleStatus(s)} />)}
                {typeFilter !== 'all' && <Chip label={TYPE_OPTIONS.find(t => t.value === typeFilter)?.label ?? ''} onRemove={() => setTypeFilter('all')} />}
                {(bpmMin !== '' || bpmMax !== '') && <Chip label={`${bpmMin || '?'}–${bpmMax || '?'} BPM`} onRemove={() => { setBpmMin(''); setBpmMax(''); }} />}
                <span className="text-[10px] font-mono text-[#5a5142] ml-1">
                  Showing {filteredByTrack.length} / {byTrack.length} tracks
                </span>
              </div>
            )}

            {/* Top tracks leaderboard — plays only, no revenue */}
            {filteredByTrack.length > 0 ? (
              <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] mb-5 overflow-hidden">
                <div className="px-5 py-3 border-b border-[#1a160f] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={12} className="text-[#a08a6a]" />
                    <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#a08a6a]">Top tracks by plays</p>
                  </div>
                  <p className="text-[9px] font-mono text-[#3a3328]">{filteredByTrack.length} tracks</p>
                </div>
                <div className="divide-y divide-[#1a160f]">
                  {filteredByTrack.slice(0, 15).map((t, rank) => {
                    const meta = trackMeta.get(t.track_id);
                    return (
                      <div key={t.track_id} className="flex items-center gap-3 px-5 py-3 hover:bg-[#16130e] transition-colors">
                        <span className="text-[10px] font-mono text-[#3a3328] tabular-nums w-5 shrink-0">{rank + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1.5 gap-2">
                            <Link href={`/library/${t.track_id}`} className="text-[12px] text-[#E8DCC8] truncate hover:text-[#D4BFA0] transition-colors flex-1">
                              {t.title}
                            </Link>
                            <div className="flex items-center gap-3 shrink-0">
                              {meta?.bpm && <span className="text-[9px] font-mono text-[#3a3328]">{meta.bpm} BPM</span>}
                              {meta?.type && <span className="text-[9px] font-mono text-[#5a5142] capitalize">{meta.type}</span>}
                              <span className="text-[11px] font-mono font-bold text-[#D4BFA0] tabular-nums">{t.plays} plays</span>
                            </div>
                          </div>
                          <div className="h-[3px] rounded-full bg-[#1f1a13] overflow-hidden">
                            <div className="h-full rounded-full bg-[#D4BFA0]/60 transition-all duration-500"
                              style={{ width: `${Math.max(2, (t.plays / maxPlays) * 100).toFixed(1)}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] px-6 py-10 text-center mb-5">
                <Music size={20} className="text-[#3a3328] mx-auto mb-2" />
                <p className="text-[12px] text-[#6a5d4a]">No tracks match the current filters.</p>
              </div>
            )}

            {/* Share-link analytics (Task 6) — per-token engagement + source */}
            {byShareLink.length > 0 && (
              <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] mb-5 overflow-hidden">
                <div className="px-5 py-3 border-b border-[#1a160f] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Link2 size={12} className="text-[#a08a6a]" />
                    <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#a08a6a]">Share links</p>
                  </div>
                  <p className="text-[9px] font-mono text-[#3a3328]">{byShareLink.length} opened</p>
                </div>
                {/* Column headers */}
                <div className="hidden sm:flex items-center gap-3 px-5 py-2 border-b border-[#1a160f] text-[8px] font-mono uppercase tracking-[0.18em] text-[#3a3328]">
                  <span className="flex-1">Link</span>
                  <span className="w-16 text-right">Plays</span>
                  <span className="w-20 text-right">Unique</span>
                  <span className="w-28 text-right">Source</span>
                </div>
                <div className="divide-y divide-[#1a160f]">
                  {byShareLink.slice(0, 20).map((s) => (
                    <div key={s.token} className="flex items-center gap-3 px-5 py-3 hover:bg-[#16130e] transition-colors">
                      <div className="flex-1 min-w-0">
                        <a
                          href={`/share/${s.token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[12px] text-[#E8DCC8] hover:text-[#D4BFA0] transition-colors font-mono truncate inline-flex items-center gap-1.5"
                          title={s.token}
                        >
                          /{s.token.slice(0, 12)}{s.token.length > 12 ? '…' : ''}
                          <ExternalLink size={9} className="text-[#5a5142] shrink-0" />
                        </a>
                        <p className="text-[9px] font-mono text-[#5a5142] mt-0.5">
                          {s.track_count} track{s.track_count === 1 ? '' : 's'}
                          {s.recipient_kind ? ` · ${s.recipient_kind}` : ''}
                        </p>
                      </div>
                      <span className="w-16 text-right text-[11px] font-mono font-bold text-[#D4BFA0] tabular-nums">{s.plays}</span>
                      <span className="w-20 text-right text-[11px] font-mono text-[#a08a6a] tabular-nums">{s.unique_opens}</span>
                      <span className="w-28 text-right text-[10px] font-mono text-[#a08a6a] truncate" title={s.top_source}>{s.top_source}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[9px] font-mono text-[#3a3328] text-center mt-6">
              For revenue and order history → <Link href="/sales" className="text-[#6a5d4a] hover:text-[#a08a6a] underline underline-offset-2 transition-colors">Sales</Link>
            </p>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function EngagementCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent: string }) {
  return (
    <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1.5" style={{ color: accent }}>
        {icon}
        <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] truncate">{label}</span>
      </div>
      <p className="text-[22px] font-bold text-white tabular-nums leading-none">{value}</p>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#2A2418] border border-[#8A7A5C]/30 text-[9px] font-mono text-[#E8D8B8]">
      {label}
      <button onClick={onRemove} className="text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors ml-0.5">
        <X size={9} />
      </button>
    </span>
  );
}
