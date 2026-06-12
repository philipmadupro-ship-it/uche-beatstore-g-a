'use client';

import { useEffect, useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import { toast } from '@/hooks/useToast';

interface GlobalLicense {
  id: string;
  name: string;
  price_usd: number | null;
  is_free: boolean;
  is_exclusive: boolean;
  sort_order: number;
}

interface TrackLicenseRow {
  license_id: string;
  enabled: boolean;
  linked: boolean;
  price_override_usd: number | null;
}

/**
 * Per-track license panel. Opens in the beat row in the store editor.
 *
 * Fetches the current track_licenses rows from /api/track-licenses?track_id=X,
 * merges with the global license list to show enable/disable + price override
 * per tier. Changes are saved immediately to /api/track-licenses (POST).
 *
 * If NO track_licenses rows exist → all global tiers apply at their default prices.
 * If ANY rows exist → only the enabled rows apply (override mode).
 */
export function TrackLicensePanel({ trackId, globalLicenses }: {
  trackId: string;
  globalLicenses: GlobalLicense[];
}) {
  const [rows, setRows] = useState<TrackLicenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/track-licenses?track_id=${trackId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setRows(Array.isArray(data) ? data : data.licenses ?? []);
      } catch {} finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [trackId]);

  // Find the current row for a license (or synthesize a default).
  const rowFor = (licenseId: string): TrackLicenseRow => {
    const found = rows.find((r) => r.license_id === licenseId);
    return found ?? { license_id: licenseId, enabled: true, linked: false, price_override_usd: null };
  };

  const save = async (licenseId: string, patch: { enabled?: boolean; price_override_usd?: number | null }) => {
    setSaving(licenseId);
    const current = rowFor(licenseId);
    const next = { ...current, ...patch };
    // Optimistic update
    setRows((prev) => {
      const existing = prev.find((r) => r.license_id === licenseId);
      if (existing) return prev.map((r) => r.license_id === licenseId ? { ...r, ...patch, linked: true } : r);
      return [...prev, { ...next, linked: true }];
    });
    try {
      const res = await fetch('/api/track-licenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_id: trackId, license_id: licenseId, enabled: next.enabled, price_override_usd: next.price_override_usd }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    } catch (err: any) {
      // Rollback
      setRows((prev) => prev.map((r) => r.license_id === licenseId ? current : r));
      toast.error('Failed to save', err.message);
    } finally { setSaving(null); }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-4">
      <Loader2 size={13} className="animate-spin text-[#837B6D]" />
    </div>
  );

  if (globalLicenses.length === 0) return (
    <p className="text-[10px] text-[#9B9282] font-mono py-3">
      No license tiers yet — build them in{' '}
      <a href="/settings/licenses" className="text-[#D0C3AF] underline underline-offset-2">Settings → Licenses</a>.
    </p>
  );

  const anyLinked = rows.some((r) => r.linked);

  return (
    <div className="space-y-2">
      {!anyLinked && (
        <p className="text-[9px] text-[#837B6D] font-mono">
          Using all global tiers. Toggle a tier to set per-beat overrides.
        </p>
      )}
      {globalLicenses.map((gl) => {
        const row = rowFor(gl.id);
        const isBusy = saving === gl.id;
        return (
          <div key={gl.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${row.enabled ? 'border-[#3B372F] bg-[#171511]' : 'border-[#211F1A] bg-[#11100D] opacity-60'}`}>
            {/* Enable toggle */}
            <button
              onClick={() => save(gl.id, { enabled: !row.enabled })}
              disabled={isBusy}
              className={`w-8 h-4 shrink-0 rounded-full border-2 border-transparent transition-colors relative ${row.enabled ? 'bg-[#6DC6A4]' : 'bg-[#2B2821]'}`}
            >
              <span className={`absolute top-0 w-3 h-3 rounded-full bg-white shadow transition-transform ${row.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            {/* Tier info */}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-[#F7EBDD] truncate">{gl.name}</p>
              <p className="text-[9px] font-mono text-[#9B9282]">
                {gl.is_exclusive ? 'Exclusive' : 'Non-exclusive'}
                {gl.is_free ? ' · Free' : ''}
              </p>
            </div>
            {/* Price override */}
            {!gl.is_free && row.enabled && (
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] text-[#9B9282]">$</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={row.price_override_usd ?? gl.price_usd ?? ''}
                  placeholder={gl.price_usd != null ? String(gl.price_usd) : '—'}
                  onBlur={(e) => {
                    const val = e.target.value.trim() === '' ? null : parseFloat(e.target.value);
                    save(gl.id, { price_override_usd: val });
                  }}
                  className="w-16 bg-[#090907] border border-[#2B2821] rounded px-1.5 py-0.5 text-[11px] text-[#F7EBDD] focus:outline-none focus:border-[#3B372F] font-mono tabular-nums"
                />
              </div>
            )}
            {isBusy && <Loader2 size={11} className="animate-spin text-[#837B6D] shrink-0" />}
            {!isBusy && row.linked && <Check size={11} className="text-[#6DC6A4] shrink-0" />}
          </div>
        );
      })}
    </div>
  );
}
