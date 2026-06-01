'use client';

import { useEffect, useState } from 'react';
import { BarChart3, Loader2, ShoppingBag, Eye } from 'lucide-react';

interface ProjectStats {
  plays: number;
  sales: number;
  gross_usd: number;
}

/**
 * Compact analytics strip for a project. Shows plays (from store_plays),
 * sales count + gross (from license_purchases + project_access_links) for
 * this project only — a lightweight drill-down from the /analytics page.
 */
export function ProjectAnalyticsPanel({ projectId }: { projectId: string }) {
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/analytics/projects/${projectId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setStats(data);
      } catch {
        // best-effort — analytics are non-blocking
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  if (loading) return (
    <div className="flex items-center gap-2 py-2 text-[#3a3328]">
      <Loader2 size={11} className="animate-spin" />
      <span className="text-[10px] font-mono">Loading analytics…</span>
    </div>
  );

  if (!stats) return null;

  return (
    <div className="flex items-center gap-4 py-3 border-t border-[#1a160f]">
      <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#3a3328] flex items-center gap-1">
        <BarChart3 size={10} /> Stats
      </span>
      <Stat icon={<Eye size={11} />} label="Plays" value={stats.plays} />
      <Stat icon={<ShoppingBag size={11} />} label="Sales" value={stats.sales} />
      {stats.gross_usd > 0 && (
        <span className="text-[12px] font-mono font-bold text-[#6DC6A4]">
          ${stats.gross_usd.toFixed(2)}
        </span>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1 text-[#a08a6a]" title={label}>
      {icon}
      <span className="text-[12px] font-mono font-semibold tabular-nums">{value}</span>
    </span>
  );
}
