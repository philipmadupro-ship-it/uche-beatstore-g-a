'use client';

import { useEffect, useState } from 'react';
import { Loader2, Check, DollarSign, FileText } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import type { Track } from '@/lib/types';

/**
 * Per-track listing editor: description + lease/exclusive price.
 *
 * Lives on the library track detail page. The profile-level prices
 * in /settings act as defaults; whatever the producer sets here
 * overrides those defaults for THIS track only. Empty fields fall
 * back to the profile — leaving the input blank is the documented
 * way to opt back into the default.
 *
 * Save is debounced-on-blur (and on Enter for the price inputs)
 * rather than auto-saving every keystroke — the producer is
 * thinking while typing a description, and a save toast per
 * keystroke would be noise.
 */

interface Props {
  track: Track;
  /** Called after a successful save so the parent can re-fetch
   *  if it cares to. Optional. */
  onSaved?: () => void;
}

export function TrackListingEditor({ track, onSaved }: Props) {
  const [description, setDescription] = useState(track.description ?? '');
  const [leasePrice, setLeasePrice] = useState(
    track.lease_price_usd != null ? String(track.lease_price_usd) : '',
  );
  const [exclusivePrice, setExclusivePrice] = useState(
    track.exclusive_price_usd != null ? String(track.exclusive_price_usd) : '',
  );
  const [saving, setSaving] = useState<null | 'description' | 'lease' | 'exclusive'>(null);
  const [recentlySaved, setRecentlySaved] = useState<null | 'description' | 'lease' | 'exclusive'>(null);

  // Track prop change => re-sync local state. Happens when the parent
  // refetches after a stem upload / analyze etc.
  useEffect(() => {
    setDescription(track.description ?? '');
    setLeasePrice(track.lease_price_usd != null ? String(track.lease_price_usd) : '');
    setExclusivePrice(track.exclusive_price_usd != null ? String(track.exclusive_price_usd) : '');
  }, [track.id, track.description, track.lease_price_usd, track.exclusive_price_usd]);

  const persist = async (field: 'description' | 'lease' | 'exclusive', value: string) => {
    setSaving(field);
    try {
      const payload: Record<string, any> = {};
      if (field === 'description') {
        payload.description = value.trim() || null;
      } else {
        const n = value.trim() === '' ? null : Number(value);
        if (n !== null && (!Number.isFinite(n) || n < 0)) {
          toast.error('Price must be a non-negative number');
          setSaving(null);
          return;
        }
        payload[field === 'lease' ? 'lease_price_usd' : 'exclusive_price_usd'] = n;
      }
      const res = await fetch(`/api/tracks/${track.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      setRecentlySaved(field);
      setTimeout(() => setRecentlySaved((cur) => (cur === field ? null : cur)), 2000);
      onSaved?.();
    } catch (err) {
      console.error('Track listing save failed:', err);
      toast.error('Couldn’t save', err instanceof Error ? err.message : 'Try again');
    } finally {
      setSaving(null);
    }
  };

  // Persist on blur so the producer doesn't have to click a save
  // button — but only if the value actually changed. Comparing the
  // raw strings, since "" and null are the same intent here.
  const persistIfChanged = (field: 'description' | 'lease' | 'exclusive', value: string) => {
    const original = field === 'description'
      ? (track.description ?? '')
      : field === 'lease'
        ? (track.lease_price_usd != null ? String(track.lease_price_usd) : '')
        : (track.exclusive_price_usd != null ? String(track.exclusive_price_usd) : '');
    if (value === original) return;
    persist(field, value);
  };

  return (
    <div className="mb-10">
      <p className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-3 flex items-center gap-2">
        <FileText size={11} />
        Listing details
      </p>

      <div className="space-y-4">
        {/* Description */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a]">
              Description
            </label>
            <SaveStateChip state={saving === 'description' ? 'saving' : recentlySaved === 'description' ? 'saved' : 'idle'} />
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={(e) => persistIfChanged('description', e.target.value)}
            rows={3}
            maxLength={5000}
            placeholder="What's this track about? Mood, style, cleared samples, suggested use…"
            className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-md px-3 py-2.5 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#8A7A5C] transition-colors resize-none leading-relaxed"
          />
          <p className="text-[9px] text-[#3a3328] mt-1 font-mono">
            Shown under the track on the Client variant share page.
          </p>
        </div>

        {/* Prices — two columns. Empty = inherit from /settings profile. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PriceInput
            label="Lease price (USD)"
            value={leasePrice}
            onChange={setLeasePrice}
            onCommit={(v) => persistIfChanged('lease', v)}
            saving={saving === 'lease'}
            saved={recentlySaved === 'lease'}
            placeholder="Inherits profile default"
          />
          <PriceInput
            label="Exclusive price (USD)"
            value={exclusivePrice}
            onChange={setExclusivePrice}
            onCommit={(v) => persistIfChanged('exclusive', v)}
            saving={saving === 'exclusive'}
            saved={recentlySaved === 'exclusive'}
            placeholder="Inherits profile default"
          />
        </div>
      </div>
    </div>
  );
}

function PriceInput({
  label, value, onChange, onCommit, saving, saved, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  saving: boolean;
  saved: boolean;
  placeholder: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a]">{label}</label>
        <SaveStateChip state={saving ? 'saving' : saved ? 'saved' : 'idle'} />
      </div>
      <div className="relative">
        <DollarSign size={11} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3a3328] pointer-events-none" />
        <input
          type="number"
          min={0}
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder={placeholder}
          className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-md pl-8 pr-3 py-2.5 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#8A7A5C] transition-colors"
        />
      </div>
    </div>
  );
}

function SaveStateChip({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  if (state === 'idle') return null;
  if (state === 'saving') {
    return (
      <span className="text-[9px] font-mono text-[#6a5d4a] flex items-center gap-1">
        <Loader2 size={9} className="animate-spin" />
        Saving
      </span>
    );
  }
  return (
    <span className="text-[9px] font-mono text-[#6DC6A4] flex items-center gap-1">
      <Check size={9} />
      Saved
    </span>
  );
}
