'use client';

import { Download } from 'lucide-react';

// ── Shared LicenseTier type ─────────────────────────────────────────────────
// Single source of truth — import this type everywhere instead of redeclaring.
export interface LicenseTier {
  id: string;
  name: string;
  description?: string | null;
  price_usd: number;
  is_free?: boolean;
  file_types?: string[];
  stems_included?: boolean;
  is_exclusive?: boolean;
  sort_order?: number;
}

interface LicenseSelectorProps {
  /** Tier list from /api/licenses or synthesised from creator_profiles fallback */
  tiers: LicenseTier[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Defaults to the warm accent colour used throughout the store */
  accentColor?: string;
  /** When true, renders a single Free Download CTA instead of tier cards */
  isFreeDownload?: boolean;
  onFreeDownload?: () => void;
}

/**
 * Pure presentational component — no internal fetches, no cart logic.
 * The caller owns state (selectedId) and actions (onSelect, onFreeDownload).
 * Used in BeatPreviewDrawer (store) and ClientShareVariant (share page).
 */
export function LicenseSelector({
  tiers,
  selectedId,
  onSelect,
  accentColor = '#D4BFA0',
  isFreeDownload,
  onFreeDownload,
}: LicenseSelectorProps) {
  if (isFreeDownload) {
    return (
      <button
        onClick={onFreeDownload}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#6DC6A4]/10 border border-[#6DC6A4]/20 text-[#6DC6A4] text-[12px] font-bold uppercase tracking-wider hover:bg-[#6DC6A4]/20 transition-colors"
      >
        <Download size={14} />
        Free Download
      </button>
    );
  }

  if (tiers.length === 0) {
    return (
      <p className="text-[11px] text-[#4a4338] text-center py-4 font-mono">
        No licenses configured
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {tiers.map((tier) => {
        const isSelected = selectedId === tier.id;
        return (
          <button
            key={tier.id}
            onClick={() => onSelect(tier.id)}
            className={`w-full text-left px-4 py-3.5 rounded-xl border-2 transition-all ${
              isSelected
                ? 'border-[#D4BFA0] bg-[#1a1610]/40'
                : 'border-[#1f1a13] hover:border-[#D4BFA0]/40 bg-transparent'
            }`}
            style={isSelected ? { borderColor: accentColor } : {}}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-semibold text-[#E8DCC8]">{tier.name}</span>
              <span
                className="text-[13px] font-bold tabular-nums"
                style={{ color: accentColor }}
              >
                {tier.is_free ? 'Free' : `$${Number(tier.price_usd).toLocaleString()}`}
              </span>
            </div>
            {tier.description && (
              <p className="text-[10px] text-[#6a5d4a] leading-relaxed">{tier.description}</p>
            )}
            {tier.file_types && tier.file_types.length > 0 && (
              <div className="flex gap-1 mt-2 flex-wrap">
                {tier.file_types.map((ft) => (
                  <span
                    key={ft}
                    className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#1f1a13] text-[#6a5d4a] border border-[#2d2620]"
                  >
                    {ft}
                  </span>
                ))}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
