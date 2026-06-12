'use client';

import { useEffect, useState, useMemo } from 'react';
import { Loader2, TrendingUp, Users } from 'lucide-react';

interface Ping {
  position_seconds: number;
  created_at: string;
}

interface TrackHeatmapProps {
  trackId: string;
  durationSeconds: number;
}

export function TrackHeatmap({ trackId, durationSeconds }: TrackHeatmapProps) {
  const [pings, setPings] = useState<Ping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHeatmap = async () => {
      try {
        const res = await fetch(`/api/tracks/${trackId}/heatmap`);
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        const data = await res.json();
        setPings(data.pings || []);
      } catch (err: any) {
        console.error('Error loading heatmap:', err);
        setError(err.message || 'Failed to load heatmap data');
      } finally {
        setLoading(false);
      }
    };
    fetchHeatmap();
  }, [trackId]);

  // Aggregate pings into 60 bins
  const binsCount = 60;
  const heatmapData = useMemo(() => {
    const counts = Array(binsCount).fill(0);
    if (!durationSeconds || durationSeconds <= 0 || pings.length === 0) {
      return counts;
    }

    const binDuration = durationSeconds / binsCount;

    pings.forEach((ping) => {
      const idx = Math.floor(ping.position_seconds / binDuration);
      const clampedIdx = Math.max(0, Math.min(binsCount - 1, idx));
      counts[clampedIdx] += 1;
    });

    return counts;
  }, [pings, durationSeconds, binsCount]);

  const maxVal = useMemo(() => {
    const m = Math.max(...heatmapData);
    return m === 0 ? 1 : m;
  }, [heatmapData]);

  // Find the 'hot spot' (bin with highest engagement)
  const hotSpotInfo = useMemo(() => {
    if (pings.length === 0) return null;
    let maxIdx = 0;
    let maxVal = 0;
    heatmapData.forEach((val, idx) => {
      if (val > maxVal) {
        maxVal = val;
        maxIdx = idx;
      }
    });

    if (maxVal === 0) return null;

    const binDuration = durationSeconds / binsCount;
    const startTime = Math.round(maxIdx * binDuration);
    const endTime = Math.round((maxIdx + 1) * binDuration);

    const fmtTime = (secs: number) => {
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    return {
      timeRange: `${fmtTime(startTime)} - ${fmtTime(endTime)}`,
      pings: maxVal,
    };
  }, [heatmapData, pings.length, durationSeconds]);

  if (loading) {
    return (
      <div className="h-28 w-full flex items-center justify-center bg-[#11100D]/50 border border-[#2B2821]/50 rounded-xl">
        <Loader2 size={16} className="animate-spin text-[#D0C3AF]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-28 w-full flex items-center justify-center bg-[#11100D]/50 border border-red-950/20 rounded-xl px-4 text-center">
        <p className="text-[11px] text-red-400">Failed to render listener density: {error}</p>
      </div>
    );
  }

  return (
    <div className="bg-[#171511] border border-[#211F1A] rounded-2xl p-6 shadow-xl relative overflow-hidden">
      {/* Abstract background subtle pattern */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#7F77DD]/[0.02] to-transparent pointer-events-none" />

      <div className="flex items-center justify-between mb-4 relative z-10">
        <div>
          <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#B4AA99] flex items-center gap-1.5">
            <TrendingUp size={11} className="text-[#7F77DD]" />
            Audience Heatmap Analytics
          </h4>
          <p className="text-[10px] text-[#9B9282] mt-0.5 font-bold uppercase tracking-widest">
            Visual density of real-time listener playhead retention
          </p>
        </div>

        <div className="flex items-center gap-4 text-[10px] font-mono text-[#D0C3AF]">
          <span className="flex items-center gap-1">
            <Users size={11} className="text-[#B4AA99]" />
            {pings.length} total coordinates logged
          </span>
        </div>
      </div>

      {pings.length === 0 ? (
        <div className="h-24 flex flex-col items-center justify-center border border-dashed border-[#2B2821] rounded-xl bg-[#11100D]/30">
          <p className="text-[11px] text-[#9B9282]">No playhead coordinates captured yet.</p>
          <p className="text-[9px] text-[#6E685B] mt-1 font-mono uppercase tracking-wider">
            Share layout pings will compile coordinates automatically
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Heat Density Bar Chart */}
          <div className="h-16 flex items-end gap-[2px] w-full pt-4 relative bg-[#090907]/40 border border-[#2B2821] p-3 rounded-xl overflow-hidden">
            {heatmapData.map((val, idx) => {
              const pct = val > 0 ? (val / maxVal) * 100 : 8; // subtle baseline noise
              const isHot = val === maxVal && val > 0;
              return (
                <div
                  key={idx}
                  className="flex-1 transition-all duration-300 relative group"
                  style={{ height: `${pct}%` }}
                >
                  <div
                    className={`w-full h-full rounded-sm transition-all duration-300 ${
                      isHot
                        ? 'bg-[#7F77DD] shadow-[0_0_8px_rgba(127,119,221,0.5)]'
                        : val > 0
                          ? 'bg-gradient-to-t from-[#7F77DD]/40 to-[#7F77DD]/80 hover:from-[#7F77DD]/60 hover:to-[#7F77DD]'
                          : 'bg-[#2B2821]'
                    }`}
                  />
                  {/* Tooltip on hover */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block bg-black border border-[#3B372F] text-white px-2 py-1 rounded text-[8px] font-mono whitespace-nowrap pointer-events-none z-50 shadow-xl">
                    {val} playhead logs
                  </div>
                </div>
              );
            })}
          </div>

          {/* Metrics summary */}
          {hotSpotInfo && (
            <div className="bg-[#11100D]/40 border border-[#2B2821] rounded-xl p-3.5 flex items-center justify-between text-[11px]">
              <div>
                <span className="text-[#9B9282] font-mono uppercase tracking-wider text-[9px] block">Hot Retention Segment</span>
                <span className="text-[#F7EBDD] font-bold font-mono tracking-tight mt-0.5 block">{hotSpotInfo.timeRange}</span>
              </div>
              <div className="text-right">
                <span className="text-[#9B9282] font-mono uppercase tracking-wider text-[9px] block">Peak Density Count</span>
                <span className="text-[#7F77DD] font-bold font-mono tracking-tight mt-0.5 block">{hotSpotInfo.pings} coordinates</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
