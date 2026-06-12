'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Loader2, Check, DollarSign, FileText, Image, AlertTriangle, Activity, Globe,
  Upload, ChevronDown, Calendar, RotateCcw, X,
} from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
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

interface CreatorDefaults {
  lease: number | null;
  exclusive: number | null;
  bundleThreshold: number;
  bundlePercent: number;
}

interface Props {
  track: Track;
  /** Called after a successful save so the parent can re-fetch if it cares. */
  onSaved?: () => void;
}

export function TrackListingEditor({ track, onSaved }: Props) {
  // Description
  const [description, setDescription] = useState(track.description ?? '');

  // Publishing State
  const [storeListed, setStoreListed] = useState(!!track.store_listed);
  const [exclusiveSold, setExclusiveSold] = useState(!!track.exclusive_sold);
  const [coverUrlInput, setCoverUrlInput] = useState(track.cover_url ?? '');
  const [bpmInput, setBpmInput] = useState(track.bpm != null ? String(track.bpm) : '');
  const [keyInput, setKeyInput] = useState(track.key ?? '');
  const [scaleInput, setScaleInput] = useState(track.scale ?? 'minor');

  // Per-track pricing overrides
  const [leasePrice, setLeasePrice] = useState(track.lease_price_usd != null ? String(track.lease_price_usd) : '');
  const [exclusivePrice, setExclusivePrice] = useState(track.exclusive_price_usd != null ? String(track.exclusive_price_usd) : '');

  const [saving, setSaving] = useState<string | null>(null);
  const [recentlySaved, setRecentlySaved] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);

  // Free download + merchandising
  const [freeDownload, setFreeDownload] = useState(!!track.free_download_enabled);
  const [featured, setFeatured] = useState(!!(track as any).store_featured);
  const [voiceTag, setVoiceTag] = useState(!!track.voice_tag_enabled);
  const [sortOrder, setSortOrder] = useState(track.store_sort_order != null ? String(track.store_sort_order) : '');

  // Scheduled drop
  const scheduledAt = (track as any).scheduled_publish_at as string | null | undefined;
  const [scheduleInput, setScheduleInput] = useState('');

  // Creator defaults (for resolved-price preview) + tag count (for readiness)
  const [defaults, setDefaults] = useState<CreatorDefaults | null>(null);
  const [tagCount, setTagCount] = useState<number | null>(null);

  // Collapsible sections — pricing + description open; the set-once panels start closed.
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(['pricing', 'description']));
  const toggleSection = (id: string) =>
    setOpenSections((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Per-track license rows
  const [licenseRows, setLicenseRows] = useState<TrackLicenseRow[]>([]);
  const [licenseSaving, setLicenseSaving] = useState<string | null>(null);

  const fetchLicenseRows = useCallback(async () => {
    try {
      const res = await fetch(`/api/track-licenses?track_id=${track.id}`);
      if (!res.ok) return;
      const data = await res.json();
      setLicenseRows(data.licenses ?? []);
    } catch {
      // best-effort
    }
  }, [track.id]);

  useEffect(() => { fetchLicenseRows(); }, [fetchLicenseRows]);

  // Creator profile defaults — lets us preview the resolved buyer-facing price.
  useEffect(() => {
    let alive = true;
    fetch('/api/profile').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!alive || !d?.profile) return;
      const p = d.profile;
      setDefaults({
        lease: p.license_lease_price_usd ?? null,
        exclusive: p.license_exclusive_price_usd ?? null,
        bundleThreshold: Number(p.bundle_discount_threshold ?? 0),
        bundlePercent: Number(p.bundle_discount_percent ?? 0),
      });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  // Tag count for the readiness checklist.
  useEffect(() => {
    let alive = true;
    fetch(`/api/tracks/${track.id}/tags`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!alive) return;
      const n = Array.isArray(d?.tags) ? d.tags.length : Array.isArray(d) ? d.length : 0;
      setTagCount(n);
    }).catch(() => setTagCount(0));
    return () => { alive = false; };
  }, [track.id]);

  const persistLicense = async (licenseId: string, enabled: boolean, priceOverride: string) => {
    setLicenseSaving(licenseId);
    try {
      const res = await fetch(`/api/track-licenses?track_id=${track.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_id: licenseId, enabled, price_override_usd: priceOverride === '' ? null : Number(priceOverride) }),
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

  useEffect(() => {
    setDescription(track.description ?? '');
    setStoreListed(!!track.store_listed);
    setExclusiveSold(!!track.exclusive_sold);
    setFreeDownload(!!track.free_download_enabled);
    setFeatured(!!(track as any).store_featured);
    setVoiceTag(!!track.voice_tag_enabled);
    setSortOrder(track.store_sort_order != null ? String(track.store_sort_order) : '');
    setCoverUrlInput(track.cover_url ?? '');
    setBpmInput(track.bpm != null ? String(track.bpm) : '');
    setKeyInput(track.key ?? '');
    setScaleInput(track.scale ?? 'minor');
    setLeasePrice(track.lease_price_usd != null ? String(track.lease_price_usd) : '');
    setExclusivePrice(track.exclusive_price_usd != null ? String(track.exclusive_price_usd) : '');
  }, [track.id, track.description, track.store_listed, track.exclusive_sold, track.cover_url, track.bpm, track.key, track.scale, track.lease_price_usd, track.exclusive_price_usd]);

  const persist = async (field: string, value: any) => {
    setSaving(field);
    try {
      const payload: Record<string, any> = {};
      if (field === 'description') {
        payload.description = value.trim() || null;
      } else if (field === 'lease') {
        const n = value.trim() === '' ? null : Number(value);
        if (n !== null && (!Number.isFinite(n) || n < 0)) { toast.error('Price must be a non-negative number'); setSaving(null); return; }
        payload.lease_price_usd = n;
      } else if (field === 'exclusive') {
        const n = value.trim() === '' ? null : Number(value);
        if (n !== null && (!Number.isFinite(n) || n < 0)) { toast.error('Price must be a non-negative number'); setSaving(null); return; }
        payload.exclusive_price_usd = n;
      } else if (field === 'store_listed') {
        payload.store_listed = !!value;
      } else if (field === 'free_download_enabled') {
        payload.free_download_enabled = !!value;
      } else if (field === 'store_featured') {
        payload.store_featured = !!value;
      } else if (field === 'voice_tag_enabled') {
        payload.voice_tag_enabled = !!value;
      } else if (field === 'store_sort_order') {
        payload.store_sort_order = value === '' ? null : Number(value);
      } else if (field === 'scheduled_publish_at') {
        payload.scheduled_publish_at = value || null;
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
      const res = await fetch('/api/upload/image', { method: 'POST', body: formData });
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
    const original = field === 'description' ? (track.description ?? '')
      : field === 'lease' ? (track.lease_price_usd != null ? String(track.lease_price_usd) : '')
      : field === 'exclusive' ? (track.exclusive_price_usd != null ? String(track.exclusive_price_usd) : '')
      : field === 'cover_url' ? (track.cover_url ?? '')
      : field === 'bpm' ? (track.bpm != null ? String(track.bpm) : '')
      : field === 'key' ? (track.key ?? '')
      : (track.scale ?? 'minor');
    if (value === original) return;
    persist(field, value);
  };

  /* ── Resolved price preview + readiness ── */
  const resolvedLease = leasePrice !== '' ? Number(leasePrice) : (defaults?.lease ?? null);
  const resolvedExclusive = exclusivePrice !== '' ? Number(exclusivePrice) : (defaults?.exclusive ?? null);
  const enabledTiers = licenseRows.filter((r) => r.enabled);
  const hasPrice = enabledTiers.length > 0 || resolvedLease != null || resolvedExclusive != null;

  const checks = [
    { id: 'price', label: 'Price', ok: hasPrice, required: true },
    { id: 'cover', label: 'Cover', ok: !!coverUrlInput, required: false },
    { id: 'meta', label: 'BPM + Key', ok: track.bpm != null && !!keyInput, required: false },
    { id: 'desc', label: 'Description', ok: description.trim().length > 0, required: false },
    { id: 'tags', label: 'Tags', ok: (tagCount ?? 0) > 0, required: false },
  ];
  const readyCount = checks.filter((c) => c.ok).length;
  const canPublish = checks.filter((c) => c.required && !c.ok).length === 0;

  const priceLabel = (() => {
    if (enabledTiers.length > 0) {
      const prices = enabledTiers.map((r) => r.price_override_usd ?? r.price_usd);
      return `${enabledTiers.length} tier${enabledTiers.length > 1 ? 's' : ''} · from $${Math.min(...prices)}`;
    }
    const parts: string[] = [];
    if (resolvedLease != null) parts.push(`$${resolvedLease} lease`);
    if (resolvedExclusive != null) parts.push(`$${resolvedExclusive} excl`);
    return parts.join('  ·  ') || 'No price set';
  })();
  const bundleNote = defaults && defaults.bundleThreshold > 0 && defaults.bundlePercent > 0
    ? `Bundle: ${defaults.bundleThreshold}+ items → ${defaults.bundlePercent}% off`
    : null;

  const handleTogglePublish = async () => {
    const nextState = !storeListed;
    if (nextState && !canPublish) {
      toast.error('Set a price first', 'Add a per-track price, enable a tier, or set a profile default before publishing.');
      return;
    }
    setStoreListed(nextState);
    await persist('store_listed', nextState);
    toast.success(nextState ? 'Beat published to public storefront!' : 'Beat unpublished from storefront.');
  };

  const relist = async () => {
    setSaving('relist');
    try {
      const res = await fetch(`/api/tracks/${track.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exclusive_sold: false, store_listed: true }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${res.status}`); }
      setExclusiveSold(false); setStoreListed(true);
      toast.success('Re-listed', 'Exclusive lock cleared and the beat is live again.');
      onSaved?.();
    } catch (err) {
      toast.error("Couldn't re-list", err instanceof Error ? err.message : 'Try again');
    } finally { setSaving(null); }
  };

  const scheduleDrop = async () => {
    if (!scheduleInput) return;
    const iso = new Date(scheduleInput).toISOString();
    await persist('scheduled_publish_at', iso);
    setScheduleInput('');
    toast.success('Drop scheduled', `Goes live ${new Date(iso).toLocaleString()}.`);
  };
  const clearSchedule = async () => {
    await persist('scheduled_publish_at', null);
    toast.success('Schedule cleared');
  };

  return (
    <div className="mb-10">
      <div className="flex items-center gap-2 mb-3">
        <Globe size={11} className={storeListed ? 'text-[#7F77DD]' : 'text-[#9B9282]'} />
        <p className="text-[10px] font-mono uppercase tracking-wider text-[#9B9282]">Storefront Publishing Hub</p>
      </div>

      <div className="bg-[#171511] border border-[#2B2821] rounded-2xl shadow-xl relative overflow-hidden">
        {storeListed && !exclusiveSold && (
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#7F77DD] to-transparent" />
        )}

        {/* ── Header: status + publish/relist ── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#2B2821]">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#F7EBDD]">Beatstore Status</h3>
            <p className="text-[9px] font-mono text-[#9B9282] uppercase tracking-widest mt-0.5">
              {exclusiveSold ? '◆ Exclusive Sold' : storeListed ? '✓ Live on Storefront' : '○ Draft Mode (Offline)'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {storeListed && !exclusiveSold && (
              <a href={`/store/${track.id}`} target="_blank" rel="noopener noreferrer"
                className="text-[9px] font-mono uppercase tracking-widest text-[#B4AA99] hover:text-[#F7EBDD] underline underline-offset-2 transition-colors">
                View live ↗
              </a>
            )}
            {exclusiveSold ? (
              <button
                onClick={relist}
                disabled={saving === 'relist'}
                className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest px-3 py-1.5 rounded-full font-bold border border-[#534AB7] bg-[#1a1833] text-[#AFA9EC] hover:bg-[#221d3d] transition-colors disabled:opacity-50"
              >
                {saving === 'relist' ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                Re-list
              </button>
            ) : (
              <>
                <span className={`text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-full font-bold border ${
                  storeListed ? 'text-[#AFA9EC] bg-[#1a1833] border-[#534AB7]' : 'text-[#9B9282] bg-[#11100D] border-[#211F1A]'
                }`}>
                  {storeListed ? 'Published' : 'Draft'}
                </span>
                <button
                  onClick={handleTogglePublish}
                  disabled={saving === 'store_listed'}
                  title={!storeListed && !canPublish ? 'Set a price before publishing' : undefined}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out outline-none ${
                    storeListed ? 'bg-[#7F77DD]' : !canPublish ? 'bg-[#2B2821] opacity-60' : 'bg-[#2B2821]'
                  }`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    storeListed ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Readiness checklist ── */}
        {!exclusiveSold && (
          <div className="px-5 py-3 border-b border-[#2B2821] bg-[#11100D]/40">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282]">
                Listing readiness · {readyCount}/{checks.length}
              </span>
              {!canPublish && (
                <span className="text-[9px] font-mono text-amber-500 flex items-center gap-1">
                  <AlertTriangle size={9} /> Price required to publish
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {checks.map((c) => (
                <span
                  key={c.id}
                  className={cn(
                    'inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded-full border',
                    c.ok
                      ? 'text-[#6DC6A4] bg-[#6DC6A4]/8 border-[#6DC6A4]/25'
                      : c.required
                        ? 'text-amber-500 bg-amber-500/8 border-amber-500/25'
                        : 'text-[#9B9282] bg-transparent border-[#2B2821]',
                  )}
                >
                  {c.ok ? <Check size={9} /> : <X size={9} />}
                  {c.label}
                </span>
              ))}
            </div>

            {/* Schedule a drop — only while in draft */}
            {!storeListed && (
              <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-[#211F1A]">
                <Calendar size={11} className="text-[#B4AA99]" />
                {scheduledAt ? (
                  <>
                    <span className="text-[10px] font-mono text-[#AFA9EC]">
                      Scheduled · {new Date(scheduledAt).toLocaleString()}
                    </span>
                    <button onClick={clearSchedule} disabled={saving === 'scheduled_publish_at'}
                      className="text-[9px] font-mono uppercase tracking-wider text-[#B4AA99] hover:text-[#F7EBDD] flex items-center gap-1">
                      <X size={9} /> Clear
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[#9B9282]">Schedule drop</span>
                    <input
                      type="datetime-local"
                      value={scheduleInput}
                      onChange={(e) => setScheduleInput(e.target.value)}
                      className="bg-[#090907] border border-[#2B2821] rounded-md px-2 py-1 text-[10px] text-[#F7EBDD] focus:outline-none focus:border-[#C9BCA8] font-mono"
                    />
                    <button
                      onClick={scheduleDrop}
                      disabled={!scheduleInput || saving === 'scheduled_publish_at'}
                      className="text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded-md bg-[#342F27] border border-[#C9BCA8]/40 text-[#F3E6D1] hover:bg-[#332b1d] transition-colors disabled:opacity-40"
                    >
                      Set
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <div className="p-5 space-y-3">
          {/* ── Pricing & licensing (with resolved-price preview) ── */}
          <Section id="pricing" title="Pricing & Licensing" icon={<DollarSign size={11} className="text-[#D0C3AF]" />}
            summary={priceLabel} open={openSections.has('pricing')} onToggle={() => toggleSection('pricing')}>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-lg bg-[#100d09] border border-[#211F1A]">
              <span className="text-[9px] font-mono uppercase tracking-wider text-[#9B9282]">Buyers see</span>
              <span className="text-[12px] font-mono font-bold text-[#F3E6D1]">{priceLabel}</span>
              {bundleNote && <span className="text-[9px] font-mono text-[#6DC6A4]">{bundleNote}</span>}
            </div>

            {licenseRows.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[9px] font-mono text-[#6E685B] pb-1">
                  All tiers enabled by default. Disable to hide from the product page or set a price override.
                </p>
                {licenseRows.map((row) => (
                  <LicenseTierRow key={row.id} row={row} saving={licenseSaving === row.id}
                    onChange={(enabled, priceOverride) => persistLicense(row.id, enabled, priceOverride)} />
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-[9px] font-mono text-[#6E685B] pb-1">
                  No license tiers yet.{' '}
                  <a href="/settings/licenses" className="text-[#D0C3AF] hover:text-[#E7D7BE] underline underline-offset-2 transition-colors">Create tiers in Settings →</a>
                  {' '}Until then, set per-track price overrides below.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <PriceInput label="Basic Lease (USD)" value={leasePrice} onChange={setLeasePrice}
                    onCommit={(v) => persistIfChanged('lease', v)} saving={saving === 'lease'} saved={recentlySaved === 'lease'}
                    placeholder={defaults?.lease != null ? `Default $${defaults.lease}` : 'Profile default'} />
                  <PriceInput label="Exclusive (USD)" value={exclusivePrice} onChange={setExclusivePrice}
                    onCommit={(v) => persistIfChanged('exclusive', v)} saving={saving === 'exclusive'} saved={recentlySaved === 'exclusive'}
                    placeholder={defaults?.exclusive != null ? `Default $${defaults.exclusive}` : 'Profile default'} />
                </div>
              </div>
            )}
          </Section>

          {/* ── Description ── */}
          <Section id="description" title="Description" icon={<FileText size={11} className="text-[#D0C3AF]" />}
            summary={description.trim() ? `${description.trim().length} chars` : 'Empty'} open={openSections.has('description')} onToggle={() => toggleSection('description')}>
            <div className="flex justify-end mb-1.5">
              <SaveStateChip state={saving === 'description' ? 'saving' : recentlySaved === 'description' ? 'saved' : 'idle'} />
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={(e) => persistIfChanged('description', e.target.value)}
              rows={3}
              maxLength={5000}
              placeholder="Describe the vibe, mood, references, usage terms…"
              className="w-full bg-[#11100D] border border-[#2B2821] rounded-lg px-3 py-2.5 text-[12px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#C9BCA8] transition-colors resize-none leading-relaxed"
            />
          </Section>

          {/* ── Cover Art ── */}
          <Section id="cover" title="Cover Art" icon={<Image size={11} className="text-[#D0C3AF]" />}
            summary={coverUrlInput ? 'Set' : 'Recommended'} open={openSections.has('cover')} onToggle={() => toggleSection('cover')}>
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <div onClick={() => fileInputRef.current?.click()}
                className="w-16 h-16 rounded-lg bg-[#1A1813] border border-[#2B2821] overflow-hidden shrink-0 cursor-pointer hover:border-[#E7D7BE]/40 transition-colors relative group">
                {coverUrlInput ? (
                  <img src={coverUrlInput} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-[#6E685B] gap-0.5">
                    <Image size={16} /><span className="text-[8px] font-mono uppercase">Upload</span>
                  </div>
                )}
                {imageUploading ? (
                  <div className="absolute inset-0 bg-black/70 flex items-center justify-center"><Loader2 size={14} className="animate-spin text-[#E7D7BE]" /></div>
                ) : (
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><Upload size={12} className="text-white" /></div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#B4AA99]">Cover Art</span>
                  {coverUrlInput
                    ? <span className="text-[9px] text-[#6DC6A4] font-mono">✓ Set</span>
                    : <span className="text-[9px] text-amber-500 font-mono flex items-center gap-1"><AlertTriangle size={9} /> Recommended</span>}
                </div>
                <input type="url" value={coverUrlInput} onChange={(e) => setCoverUrlInput(e.target.value)}
                  onBlur={(e) => persistIfChanged('cover_url', e.target.value)} placeholder="Paste URL or click thumbnail to upload…"
                  className="w-full bg-[#090907] border border-[#2B2821] rounded-md px-3 py-1.5 text-[11px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#C9BCA8] transition-colors" />
              </div>
            </div>
          </Section>

          {/* ── BPM & Key ── */}
          <Section id="meta" title="BPM & Key" icon={<Activity size={11} className="text-[#D0C3AF]" />}
            summary={`${bpmInput || '—'} bpm · ${keyInput || '—'} ${scaleInput}`} open={openSections.has('meta')} onToggle={() => toggleSection('meta')}>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[9px] font-mono uppercase tracking-wider text-[#9B9282] mb-1 block">BPM</label>
                <input type="number" value={bpmInput} onChange={(e) => setBpmInput(e.target.value)} onBlur={(e) => persistIfChanged('bpm', e.target.value)}
                  placeholder={track.bpm != null ? String(track.bpm) : '—'}
                  className="w-full bg-[#090907] border border-[#2B2821] rounded-md px-2.5 py-1.5 text-[11px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#C9BCA8] transition-colors font-mono" />
              </div>
              <div>
                <label className="text-[9px] font-mono uppercase tracking-wider text-[#9B9282] mb-1 block">Key</label>
                <input type="text" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} onBlur={(e) => persistIfChanged('key', e.target.value)}
                  placeholder={track.key ?? '—'}
                  className="w-full bg-[#090907] border border-[#2B2821] rounded-md px-2.5 py-1.5 text-[11px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#C9BCA8] transition-colors font-mono uppercase" />
              </div>
              <div>
                <label className="text-[9px] font-mono uppercase tracking-wider text-[#9B9282] mb-1 block">Scale</label>
                <select value={scaleInput} onChange={(e) => { setScaleInput(e.target.value); persist('scale', e.target.value); }}
                  className="w-full bg-[#090907] border border-[#2B2821] rounded-md px-2.5 py-1.5 text-[11px] text-[#F7EBDD] focus:outline-none focus:border-[#C9BCA8] transition-colors font-mono">
                  <option value="minor">Minor</option>
                  <option value="major">Major</option>
                </select>
              </div>
            </div>
          </Section>

          {/* ── Merchandising & distribution ── */}
          <Section id="merch" title="Merchandising & Distribution" icon={<Globe size={11} className="text-[#D0C3AF]" />}
            summary={[featured && 'Pick', voiceTag && 'Tagged', freeDownload && 'Free'].filter(Boolean).join(' · ') || 'How it appears on /store'}
            open={openSections.has('merch')} onToggle={() => toggleSection('merch')}>
            <div className="space-y-3">
              <ToggleRow label="Free download" hint="Anyone can download for free — no checkout."
                on={freeDownload} onColor="bg-[#6DC6A4]" busy={saving === 'free_download_enabled'}
                onToggle={async () => { const next = !freeDownload; setFreeDownload(next); await persist('free_download_enabled', next); toast.success(next ? 'Free download enabled.' : 'Free download disabled.'); }} />
              <ToggleRow label="Featured pick" hint="Highlight in the storefront's Picks row (must be published)."
                on={featured} onColor="bg-[#E7D7BE]" busy={saving === 'store_featured'}
                onToggle={async () => { const next = !featured; setFeatured(next); await persist('store_featured', next); toast.success(next ? 'Marked as a featured pick.' : 'Removed from picks.'); }} />
              <ToggleRow label="Voice tag on preview" hint="Overlay your producer tag on the store preview to deter rips. Clean file still delivers on purchase."
                on={voiceTag} onColor="bg-[#9d95e8]" busy={saving === 'voice_tag_enabled'}
                onToggle={async () => { const next = !voiceTag; setVoiceTag(next); await persist('voice_tag_enabled', next); toast.success(next ? 'Voice tag enabled on preview.' : 'Voice tag disabled.'); }} />
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-medium text-[#F7EBDD]">Store sort order</p>
                  <p className="text-[9px] font-mono text-[#9B9282] mt-0.5">Lower shows first. Blank = default (newest).</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}
                    onBlur={(e) => { if (e.target.value !== (track.store_sort_order != null ? String(track.store_sort_order) : '')) persist('store_sort_order', e.target.value); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} placeholder="—"
                    className="w-20 bg-[#090907] border border-[#2B2821] rounded-md px-2.5 py-1.5 text-[11px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#C9BCA8] transition-colors font-mono text-center" />
                  <SaveStateChip state={saving === 'store_sort_order' ? 'saving' : recentlySaved === 'store_sort_order' ? 'saved' : 'idle'} />
                </div>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  id, title, icon, summary, open, onToggle, children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-[#11100D] border border-[#211F1A] overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-white/[0.015] transition-colors" aria-expanded={open} data-section={id}>
        {icon}
        <span className="text-[10px] font-mono uppercase tracking-wider text-[#B4AA99]">{title}</span>
        {summary && <span className="text-[9px] font-mono text-[#6E685B] truncate hidden sm:inline">· {summary}</span>}
        <div className="flex-1" />
        <ChevronDown size={13} className={cn('text-[#9B9282] transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
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
  useEffect(() => {
    setPriceOverride(row.price_override_usd != null ? String(row.price_override_usd) : '');
  }, [row.price_override_usd]);

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
      row.enabled ? 'bg-white/[0.02]' : 'bg-transparent opacity-50'
    }`}>
      <button
        type="button"
        disabled={saving}
        onClick={() => onChange(!row.enabled, priceOverride)}
        className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-150 ${
          row.enabled ? 'bg-[#7F77DD]' : 'bg-[#2B2821]'
        }`}
        aria-label={row.enabled ? 'Disable tier' : 'Enable tier'}
      >
        <span className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition duration-150 ${
          row.enabled ? 'translate-x-[11px]' : 'translate-x-0'
        }`} />
      </button>

      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-medium text-[#F7EBDD]">{row.name}</span>
        <span className="ml-2 text-[9px] font-mono text-[#9B9282]">${row.price_usd} base</span>
        {/* Deliverable hint — what the buyer actually downloads for this tier. */}
        <span className="ml-1.5 text-[8px] font-mono uppercase tracking-wider text-[#B4AA99]">
          {row.is_exclusive ? 'WAV + stems' : 'MP3'}
        </span>
        {row.is_exclusive && (
          <span className="ml-1.5 text-[8px] font-mono uppercase tracking-wider text-[#E7D7BE] bg-[#E7D7BE]/10 px-1 py-0.5 rounded">Excl</span>
        )}
      </div>

      <div className="relative w-24 shrink-0">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-[#6E685B] pointer-events-none">$</span>
        <input
          type="number" min={0} step="0.01" value={priceOverride}
          onChange={(e) => setPriceOverride(e.target.value)}
          onBlur={() => { if (row.enabled || priceOverride !== '') onChange(row.enabled, priceOverride); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="Base price"
          className="w-full bg-[#090907] border border-[#2B2821] rounded-md pl-5 pr-2 py-1 text-[10px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#C9BCA8] font-mono transition-colors"
        />
      </div>

      {saving ? <Loader2 size={10} className="animate-spin text-[#9B9282] shrink-0" /> : <div className="w-[10px] shrink-0" />}
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
        <label className="text-[9px] font-mono uppercase tracking-wider text-[#9B9282]">{label}</label>
        <SaveStateChip state={saving ? 'saving' : saved ? 'saved' : 'idle'} />
      </div>
      <div className="relative">
        <DollarSign size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6E685B] pointer-events-none" />
        <input
          type="number" min={0} step="0.01" value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder={placeholder}
          className="w-full bg-[#090907] border border-[#2B2821] rounded-md pl-7 pr-2.5 py-1.5 text-[11px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#C9BCA8] transition-colors font-mono"
        />
      </div>
    </div>
  );
}

function ToggleRow({
  label, hint, on, onColor, busy, onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onColor: string;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-[#F7EBDD]">{label}</p>
        <p className="text-[9px] font-mono text-[#9B9282] mt-0.5 leading-relaxed">{hint}</p>
      </div>
      <button
        onClick={onToggle}
        disabled={busy}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out outline-none disabled:opacity-60 ${
          on ? onColor : 'bg-[#2B2821]'
        }`}
        aria-pressed={on}
      >
        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          on ? 'translate-x-5' : 'translate-x-0'
        }`} />
      </button>
    </div>
  );
}

function SaveStateChip({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  if (state === 'idle') return null;
  if (state === 'saving') {
    return (
      <span className="text-[8px] font-mono text-[#B4AA99] flex items-center gap-0.5">
        <Loader2 size={8} className="animate-spin" /> Saving
      </span>
    );
  }
  return (
    <span className="text-[8px] font-mono text-[#6DC6A4] flex items-center gap-0.5">
      <Check size={8} /> Saved
    </span>
  );
}
