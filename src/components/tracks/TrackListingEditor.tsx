'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, Check, DollarSign, FileText, Image, AlertTriangle, Activity, Globe, Upload, Layers } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import type { Track } from '@/lib/types';

/* ── Per-track license row shape from /api/track-licenses ─── */
interface TrackLicenseRow {
  id: string;
  name: string;
  price_usd: number;
  is_exclusive: boolean;
  linked: boolean;
  enabled: boolean;
  price_override_usd: number | null;
}

interface Props {
  track: Track;
  /** Called after a successful save so the parent can re-fetch
   *  if it cares to. Optional. */
  onSaved?: () => void;
}

export function TrackListingEditor({ track, onSaved }: Props) {
  // Description
  const [description, setDescription] = useState(track.description ?? '');

  // Publishing State
  const [storeListed, setStoreListed] = useState(!!track.store_listed);
  const [coverUrlInput, setCoverUrlInput] = useState(track.cover_url ?? '');
  const [bpmInput, setBpmInput] = useState(track.bpm != null ? String(track.bpm) : '');
  const [keyInput, setKeyInput] = useState(track.key ?? '');
  const [scaleInput, setScaleInput] = useState(track.scale ?? 'minor');

  // Per-track pricing overrides
  const [leasePrice, setLeasePrice] = useState(
    track.lease_price_usd != null ? String(track.lease_price_usd) : '',
  );
  const [exclusivePrice, setExclusivePrice] = useState(
    track.exclusive_price_usd != null ? String(track.exclusive_price_usd) : '',
  );

  const [saving, setSaving] = useState<string | null>(null);
  const [recentlySaved, setRecentlySaved] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);

  // Free download
  const [freeDownload, setFreeDownload] = useState(!!track.free_download_enabled);

  // Per-track license rows
  const [licenseRows, setLicenseRows] = useState<TrackLicenseRow[]>([]);
  const [licenseSaving, setLicenseSaving] = useState<string | null>(null); // license_id currently saving

  const fetchLicenseRows = useCallback(async () => {
    try {
      const res = await fetch(`/api/track-licenses?track_id=${track.id}`);
      if (!res.ok) return; // silently skip if 404 (no tiers configured yet)
      const data = await res.json();
      setLicenseRows(data.licenses ?? []);
    } catch {
      // best-effort
    }
  }, [track.id]);

  useEffect(() => { fetchLicenseRows(); }, [fetchLicenseRows]);

  const persistLicense = async (
    licenseId: string,
    enabled: boolean,
    priceOverride: string,
  ) => {
    setLicenseSaving(licenseId);
    try {
      const res = await fetch(`/api/track-licenses?track_id=${track.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          license_id: licenseId,
          enabled,
          price_override_usd: priceOverride === '' ? null : Number(priceOverride),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      await fetchLicenseRows();
    } catch (err) {
      toast.error("Couldn't save license setting", err instanceof Error ? err.message : 'Try again');
    } finally {
      setLicenseSaving(null);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync state when track details change
  useEffect(() => {
    setDescription(track.description ?? '');
    setStoreListed(!!track.store_listed);
    setFreeDownload(!!track.free_download_enabled);
    setCoverUrlInput(track.cover_url ?? '');
    setBpmInput(track.bpm != null ? String(track.bpm) : '');
    setKeyInput(track.key ?? '');
    setScaleInput(track.scale ?? 'minor');
    setLeasePrice(track.lease_price_usd != null ? String(track.lease_price_usd) : '');
    setExclusivePrice(track.exclusive_price_usd != null ? String(track.exclusive_price_usd) : '');
  }, [track.id, track.description, track.store_listed, track.cover_url, track.bpm, track.key, track.scale, track.lease_price_usd, track.exclusive_price_usd]);

  const persist = async (field: string, value: any) => {
    setSaving(field);
    try {
      const payload: Record<string, any> = {};
      if (field === 'description') {
        payload.description = value.trim() || null;
      } else if (field === 'lease') {
        const n = value.trim() === '' ? null : Number(value);
        if (n !== null && (!Number.isFinite(n) || n < 0)) {
          toast.error('Price must be a non-negative number');
          setSaving(null);
          return;
        }
        payload.lease_price_usd = n;
      } else if (field === 'exclusive') {
        const n = value.trim() === '' ? null : Number(value);
        if (n !== null && (!Number.isFinite(n) || n < 0)) {
          toast.error('Price must be a non-negative number');
          setSaving(null);
          return;
        }
        payload.exclusive_price_usd = n;
      } else if (field === 'store_listed') {
        payload.store_listed = !!value;
      } else if (field === 'free_download_enabled') {
        payload.free_download_enabled = !!value;
      } else if (field === 'cover_url') {
        payload.cover_url = value || null;
      } else if (field === 'bpm') {
        payload.bpm = value === '' ? null : Number(value);
      } else if (field === 'key') {
        payload.key = value || null;
      } else if (field === 'scale') {
        payload.scale = value || null;
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
      console.error('Track update failed:', err);
      toast.error('Couldn’t save', err instanceof Error ? err.message : 'Try again');
    } finally {
      setSaving(null);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload/image', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setCoverUrlInput(data.url);
      await persist('cover_url', data.url);
      toast.success('Cover art uploaded');
    } catch (err: any) {
      toast.error('Upload failed: ' + err.message);
    } finally {
      setImageUploading(false);
    }
  };

  const persistIfChanged = (field: string, value: string) => {
    const original = field === 'description'
      ? (track.description ?? '')
      : field === 'lease'
        ? (track.lease_price_usd != null ? String(track.lease_price_usd) : '')
        : field === 'exclusive'
          ? (track.exclusive_price_usd != null ? String(track.exclusive_price_usd) : '')
          : field === 'cover_url'
            ? (track.cover_url ?? '')
            : field === 'bpm'
              ? (track.bpm != null ? String(track.bpm) : '')
              : field === 'key'
                ? (track.key ?? '')
                : (track.scale ?? 'minor');

    if (value === original) return;
    persist(field, value);
  };

  const handleTogglePublish = async () => {
    const nextState = !storeListed;
    setStoreListed(nextState);
    await persist('store_listed', nextState);
    if (nextState) {
      toast.success('Beat published to public storefront!');
    } else {
      toast.success('Beat unpublished from storefront.');
    }
  };

  return (
    <div className="mb-10">
      {/* Single unified Beatstore Publishing Widget — description, toggles,
          cover art, audio metadata, and licensing all live here so the
          editor reads top-to-bottom as a single publishing checklist. */}
      <div className="flex items-center gap-2 mb-3">
        <Globe size={11} className={storeListed ? 'text-[#7F77DD]' : 'text-[#5a5142]'} />
        <p className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142]">
          Storefront Publishing Hub
        </p>
      </div>

      <div className="bg-[#14110d] border border-[#1f1a13] rounded-2xl shadow-xl relative overflow-hidden">
        {storeListed && (
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#7F77DD] to-transparent" />
        )}

        {/* ── Header: status badge + publish toggle ── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#1f1a13]">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#E8DCC8]">Beatstore Status</h3>
            <p className="text-[9px] font-mono text-[#5a5142] uppercase tracking-widest mt-0.5">
              {storeListed ? '✓ Live on Storefront' : '○ Draft Mode (Offline)'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-full font-bold border ${
              storeListed
                ? 'text-[#AFA9EC] bg-[#1a1833] border-[#534AB7]'
                : 'text-[#5a5142] bg-[#0c0a08] border-[#1a160f]'
            }`}>
              {storeListed ? 'Published' : 'Draft'}
            </span>
            <button
              onClick={handleTogglePublish}
              disabled={saving === 'store_listed'}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out outline-none ${
                storeListed ? 'bg-[#7F77DD]' : 'bg-[#1f1a13]'
              }`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                storeListed ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">

          {/* ── Description ── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a] flex items-center gap-1.5">
                <FileText size={9} /> Description
              </label>
              <SaveStateChip state={saving === 'description' ? 'saving' : recentlySaved === 'description' ? 'saved' : 'idle'} />
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={(e) => persistIfChanged('description', e.target.value)}
              rows={3}
              maxLength={5000}
              placeholder="Describe the vibe, mood, references, usage terms…"
              className="w-full bg-[#0c0a08] border border-[#1f1a13] rounded-lg px-3 py-2.5 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#8A7A5C] transition-colors resize-none leading-relaxed"
            />
          </div>

          {/* ── Free Download toggle ── */}
          <div className="flex items-center justify-between py-3 border-y border-[#1f1a13]">
            <div>
              <p className="text-[11px] font-medium text-[#E8DCC8]">Free Download</p>
              <p className="text-[9px] font-mono text-[#5a5142] mt-0.5">
                Allow anyone to download for free — no checkout required.
              </p>
            </div>
            <button
              onClick={async () => {
                const next = !freeDownload;
                setFreeDownload(next);
                await persist('free_download_enabled', next);
                toast.success(next ? 'Free download enabled.' : 'Free download disabled.');
              }}
              disabled={saving === 'free_download_enabled'}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out outline-none ml-4 ${
                freeDownload ? 'bg-[#6DC6A4]' : 'bg-[#1f1a13]'
              }`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                freeDownload ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </div>

          {/* ── Cover Art ── */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center p-3 rounded-xl bg-[#0c0a08] border border-[#1a160f]">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="w-16 h-16 rounded-lg bg-[#16130e] border border-[#1f1a13] overflow-hidden shrink-0 cursor-pointer hover:border-[#D4BFA0]/40 transition-colors relative group"
            >
              {coverUrlInput ? (
                <img src={coverUrlInput} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-[#3a3328] gap-0.5">
                  <Image size={16} />
                  <span className="text-[8px] font-mono uppercase">Upload</span>
                </div>
              )}
              {imageUploading ? (
                <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                  <Loader2 size={14} className="animate-spin text-[#D4BFA0]" />
                </div>
              ) : (
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Upload size={12} className="text-white" />
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a]">Cover Art</span>
                {coverUrlInput
                  ? <span className="text-[9px] text-[#6DC6A4] font-mono">✓ Set</span>
                  : <span className="text-[9px] text-amber-500 font-mono flex items-center gap-1"><AlertTriangle size={9} /> Recommended</span>
                }
              </div>
              <input
                type="url"
                value={coverUrlInput}
                onChange={(e) => setCoverUrlInput(e.target.value)}
                onBlur={(e) => persistIfChanged('cover_url', e.target.value)}
                placeholder="Paste URL or click thumbnail to upload…"
                className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-md px-3 py-1.5 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#8A7A5C] transition-colors"
              />
            </div>
          </div>

          {/* ── BPM & Key ── */}
          <div className="p-4 rounded-xl bg-[#0c0a08] border border-[#1a160f] space-y-3">
            <div className="flex items-center justify-between border-b border-[#1a160f] pb-2">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a]">
                <Activity size={10} /> BPM & Key
              </div>
              <span className="text-[9px] font-mono text-[#3a3328]">Override detected values</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142] mb-1 block">BPM</label>
                <input type="number" value={bpmInput}
                  onChange={(e) => setBpmInput(e.target.value)}
                  onBlur={(e) => persistIfChanged('bpm', e.target.value)}
                  placeholder={track.bpm != null ? String(track.bpm) : '—'}
                  className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-md px-2.5 py-1.5 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#8A7A5C] transition-colors font-mono"
                />
              </div>
              <div>
                <label className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142] mb-1 block">Key</label>
                <input type="text" value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onBlur={(e) => persistIfChanged('key', e.target.value)}
                  placeholder={track.key ?? '—'}
                  className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-md px-2.5 py-1.5 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#8A7A5C] transition-colors font-mono uppercase"
                />
              </div>
              <div>
                <label className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142] mb-1 block">Scale</label>
                <select value={scaleInput}
                  onChange={(e) => { setScaleInput(e.target.value); persist('scale', e.target.value); }}
                  className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-md px-2.5 py-1.5 text-[11px] text-[#E8DCC8] focus:outline-none focus:border-[#8A7A5C] transition-colors font-mono"
                >
                  <option value="minor">Minor</option>
                  <option value="major">Major</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Licensing ── */}
          <div className="p-4 rounded-xl bg-[#0c0a08] border border-[#1a160f] space-y-3">
            <div className="flex items-center justify-between border-b border-[#1a160f] pb-2">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a]">
                <Layers size={10} /> License Tiers
              </div>
              <span className="text-[9px] font-mono text-[#3a3328]">
                {licenseRows.length > 0 ? 'Toggle or override price per tier' : 'Inherits profile defaults'}
              </span>
            </div>

            {licenseRows.length > 0 ? (
              /* Creator has tiers configured — show per-track controls */
              <div className="space-y-1">
                <p className="text-[9px] font-mono text-[#3a3328] pb-1">
                  All tiers enabled by default. Disable to hide from product page or set a price override.
                </p>
                {licenseRows.map((row) => (
                  <LicenseTierRow
                    key={row.id}
                    row={row}
                    saving={licenseSaving === row.id}
                    onChange={(enabled, priceOverride) =>
                      persistLicense(row.id, enabled, priceOverride)
                    }
                  />
                ))}
              </div>
            ) : (
              /* No tiers yet — fallback to legacy lease / exclusive price fields */
              <div className="space-y-1">
                <p className="text-[9px] font-mono text-[#3a3328] pb-1">
                  No license tiers set up yet.{' '}
                  <a href="/settings/licenses" className="text-[#a08a6a] hover:text-[#D4BFA0] underline underline-offset-2 transition-colors">
                    Create tiers in Settings →
                  </a>
                  {' '}Until then, set per-track price overrides below.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <PriceInput
                    label="Basic Lease (USD)"
                    value={leasePrice}
                    onChange={setLeasePrice}
                    onCommit={(v) => persistIfChanged('lease', v)}
                    saving={saving === 'lease'}
                    saved={recentlySaved === 'lease'}
                    placeholder="Profile default"
                  />
                  <PriceInput
                    label="Exclusive (USD)"
                    value={exclusivePrice}
                    onChange={setExclusivePrice}
                    onCommit={(v) => persistIfChanged('exclusive', v)}
                    saving={saving === 'exclusive'}
                    saved={recentlySaved === 'exclusive'}
                    placeholder="Profile default"
                  />
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

function LicenseTierRow({
  row, saving, onChange,
}: {
  row: TrackLicenseRow;
  saving: boolean;
  onChange: (enabled: boolean, priceOverride: string) => void;
}) {
  const [priceOverride, setPriceOverride] = useState(
    row.price_override_usd != null ? String(row.price_override_usd) : '',
  );
  // Keep local price in sync if parent refetches
  useEffect(() => {
    setPriceOverride(row.price_override_usd != null ? String(row.price_override_usd) : '');
  }, [row.price_override_usd]);

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
      row.enabled ? 'bg-white/[0.02]' : 'bg-transparent opacity-50'
    }`}>
      {/* Enabled toggle */}
      <button
        type="button"
        disabled={saving}
        onClick={() => onChange(!row.enabled, priceOverride)}
        className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-150 ${
          row.enabled ? 'bg-[#7F77DD]' : 'bg-[#1f1a13]'
        }`}
        aria-label={row.enabled ? 'Disable tier' : 'Enable tier'}
      >
        <span className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition duration-150 ${
          row.enabled ? 'translate-x-[11px]' : 'translate-x-0'
        }`} />
      </button>

      {/* Tier info */}
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-medium text-[#E8DCC8]">{row.name}</span>
        <span className="ml-2 text-[9px] font-mono text-[#5a5142]">
          ${row.price_usd} base
        </span>
        {row.is_exclusive && (
          <span className="ml-1.5 text-[8px] font-mono uppercase tracking-wider text-[#D4BFA0] bg-[#D4BFA0]/10 px-1 py-0.5 rounded">
            Excl
          </span>
        )}
      </div>

      {/* Price override */}
      <div className="relative w-24 shrink-0">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-[#3a3328] pointer-events-none">$</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={priceOverride}
          onChange={(e) => setPriceOverride(e.target.value)}
          onBlur={() => {
            if (row.enabled || priceOverride !== '') {
              onChange(row.enabled, priceOverride);
            }
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="Base price"
          className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-md pl-5 pr-2 py-1 text-[10px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#8A7A5C] font-mono transition-colors"
        />
      </div>

      {saving ? (
        <Loader2 size={10} className="animate-spin text-[#5a5142] shrink-0" />
      ) : (
        <div className="w-[10px] shrink-0" />
      )}
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
        <label className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142]">{label}</label>
        <SaveStateChip state={saving ? 'saving' : saved ? 'saved' : 'idle'} />
      </div>
      <div className="relative">
        <DollarSign size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#3a3328] pointer-events-none" />
        <input
          type="number"
          min={0}
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder={placeholder}
          className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-md pl-7 pr-2.5 py-1.5 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#8A7A5C] transition-colors font-mono"
        />
      </div>
    </div>
  );
}

function SaveStateChip({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  if (state === 'idle') return null;
  if (state === 'saving') {
    return (
      <span className="text-[8px] font-mono text-[#6a5d4a] flex items-center gap-0.5">
        <Loader2 size={8} className="animate-spin" />
        Saving
      </span>
    );
  }
  return (
    <span className="text-[8px] font-mono text-[#6DC6A4] flex items-center gap-0.5">
      <Check size={8} />
      Saved
    </span>
  );
}
