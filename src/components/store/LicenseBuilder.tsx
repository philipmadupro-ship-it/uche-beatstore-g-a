'use client';

/**
 * LicenseBuilder — reusable license-tier manager.
 *
 * Self-contained: fetches from /api/licenses, saves changes via
 * PATCH /api/licenses/[id], creates via POST, deletes via DELETE.
 *
 * Used in:
 *   - /store-editor   (License Tiers section)
 *   - /settings/licenses  (still reachable via Settings nav, redirects to store-editor or renders this)
 */

import { useEffect, useState } from 'react';
import {
  Plus, Trash2, Loader2, Check, ChevronUp, ChevronDown,
  DollarSign, Globe, Music, Lock, FileText, Zap, AlertCircle,
} from 'lucide-react';
import { toast } from '@/hooks/useToast';

/* ─── Types ─────────────────────────────────────────────────── */

interface License {
  id: string;
  name: string;
  description: string | null;
  price_usd: number;
  is_free: boolean;
  file_types: string[];
  stems_included: boolean;
  is_exclusive: boolean;
  streaming_limit: number | null;
  distribution_limit: number | null;
  commercial_rights: boolean;
  sync_rights: boolean;
  broadcast_rights: boolean;
  credit_required: boolean;
  sort_order: number;
}

const DEFAULT_NEW: Omit<License, 'id' | 'sort_order'> = {
  name: '',
  description: null,
  price_usd: 0,
  is_free: false,
  file_types: ['MP3'],
  stems_included: false,
  is_exclusive: false,
  streaming_limit: 100000,
  distribution_limit: null,
  commercial_rights: true,
  sync_rights: false,
  broadcast_rights: false,
  credit_required: true,
};

const FILE_TYPE_OPTIONS = ['MP3', 'WAV', 'FLAC', 'STEMS', 'MIDI', 'PROJECT'];

const LIMIT_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'Unlimited', value: null },
  { label: '10K', value: 10_000 },
  { label: '50K', value: 50_000 },
  { label: '100K', value: 100_000 },
  { label: '500K', value: 500_000 },
  { label: '1M', value: 1_000_000 },
];

/* ─── Component ─────────────────────────────────────────────── */

export function LicenseBuilder() {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Partial<License>>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => { fetchLicenses(); }, []);

  async function fetchLicenses() {
    try {
      const res = await fetch('/api/licenses');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setLicenses(data.licenses ?? []);
    } catch {
      toast.error('Could not load licenses');
    } finally {
      setLoading(false);
    }
  }

  function getDraft(l: License): License {
    return { ...l, ...drafts[l.id] } as License;
  }

  function patch(id: string, field: keyof License, value: unknown) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [field]: value } }));
  }

  function patchFileType(id: string, type: string, on: boolean) {
    const current = drafts[id]?.file_types ?? licenses.find((l) => l.id === id)?.file_types ?? [];
    const next = on ? [...new Set([...current, type])] : current.filter((t) => t !== type);
    patch(id, 'file_types', next);
  }

  async function saveLicense(l: License) {
    const d = drafts[l.id];
    if (!d || Object.keys(d).length === 0) return;
    setSaving((s) => ({ ...s, [l.id]: true }));
    try {
      const res = await fetch(`/api/licenses/${l.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const updated = await res.json();
      setLicenses((ls) => ls.map((x) => x.id === l.id ? updated.license : x));
      setDrafts((ds) => { const next = { ...ds }; delete next[l.id]; return next; });
      toast.success('License saved');
    } catch (err: any) {
      toast.error('Save failed', err.message);
    } finally {
      setSaving((s) => ({ ...s, [l.id]: false }));
    }
  }

  async function createLicense() {
    setCreating(true);
    try {
      const res = await fetch('/api/licenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...DEFAULT_NEW, name: 'New License' }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setLicenses((ls) => [...ls, data.license]);
      setExpandedId(data.license.id);
      toast.success('License tier created');
    } catch (err: any) {
      toast.error('Create failed', err.message);
    } finally {
      setCreating(false);
    }
  }

  async function deleteLicense(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/licenses/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setLicenses((ls) => ls.filter((l) => l.id !== id));
      setDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
      toast.success('License deleted');
    } catch (err: any) {
      toast.error('Delete failed', err.message);
    } finally {
      setDeleting(null);
    }
  }

  async function moveUp(idx: number) {
    if (idx === 0) return;
    const reordered = [...licenses];
    [reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]];
    setLicenses(reordered.map((l, i) => ({ ...l, sort_order: i })));
    await Promise.all([
      fetch(`/api/licenses/${reordered[idx - 1].id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort_order: idx - 1 }),
      }),
      fetch(`/api/licenses/${reordered[idx].id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort_order: idx }),
      }),
    ]);
  }

  async function moveDown(idx: number) {
    if (idx >= licenses.length - 1) return;
    await moveUp(idx + 1);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[#5a5142]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Explainer */}
      <div className="rounded-xl border border-[#1f1a13] bg-[#0c0a08] p-4 flex gap-3">
        <AlertCircle size={13} className="text-[#a08a6a] shrink-0 mt-0.5" />
        <div className="text-[11px] text-[#6a5d4a] leading-relaxed space-y-1">
          <p>
            Create up to <strong className="text-[#a08a6a]">4 license tiers</strong> that appear as cards on every product page.
            Per-track price overrides (set in the library) take precedence over these global tier prices.
          </p>
        </div>
      </div>

      {/* License list */}
      {licenses.map((l, idx) => {
        const draft = getDraft(l);
        const isDirty = !!drafts[l.id] && Object.keys(drafts[l.id]).length > 0;
        const isExpanded = expandedId === l.id;

        return (
          <div
            key={l.id}
            className={`rounded-2xl border transition-all ${
              isExpanded ? 'border-[#2d2620] bg-[#14110d]' : 'border-[#1f1a13] bg-[#14110d]/60'
            }`}
          >
            {/* Row header */}
            <div className="flex items-center gap-3 px-4 py-3">
              {/* Reorder arrows */}
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  onClick={() => moveUp(idx)}
                  disabled={idx === 0}
                  className="w-5 h-4 flex items-center justify-center text-[#3a3328] hover:text-[#a08a6a] disabled:opacity-20 transition-colors"
                >
                  <ChevronUp size={11} />
                </button>
                <button
                  onClick={() => moveDown(idx)}
                  disabled={idx === licenses.length - 1}
                  className="w-5 h-4 flex items-center justify-center text-[#3a3328] hover:text-[#a08a6a] disabled:opacity-20 transition-colors"
                >
                  <ChevronDown size={11} />
                </button>
              </div>

              {/* Name + price summary */}
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[#E8DCC8] truncate">
                  {draft.name || 'Untitled'}
                  {draft.is_exclusive && (
                    <span className="ml-2 text-[9px] font-mono uppercase tracking-wider text-[#D4BFA0] bg-[#D4BFA0]/10 px-1.5 py-0.5 rounded-full border border-[#D4BFA0]/20">
                      Exclusive
                    </span>
                  )}
                </p>
                <p className="text-[10px] font-mono text-[#5a5142] mt-0.5">
                  {draft.is_free ? 'Free' : `$${Number(draft.price_usd).toLocaleString()}`}
                  {' · '}
                  {(draft.file_types ?? []).join(', ')}
                </p>
              </div>

              {isDirty && (
                <span className="text-[9px] font-mono text-amber-500 uppercase tracking-wider">
                  Unsaved
                </span>
              )}

              <button
                onClick={() => setExpandedId(isExpanded ? null : l.id)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#5a5142] hover:text-white hover:bg-white/[0.04] transition-colors"
              >
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>

            {/* Expanded editor */}
            {isExpanded && (
              <div className="px-4 pb-5 space-y-5 border-t border-[#1f1a13] pt-4">
                {/* Name + price row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="license-label">License Name</label>
                    <input
                      type="text"
                      maxLength={80}
                      value={draft.name}
                      onChange={(e) => patch(l.id, 'name', e.target.value)}
                      placeholder="e.g. MP3 Lease, Unlimited License…"
                      className="license-input"
                    />
                  </div>
                  <div>
                    <label className="license-label">
                      Price (USD)
                      <span className="ml-2 text-[#3a3328]">— 0 = free</span>
                    </label>
                    <div className="relative">
                      <DollarSign size={11} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3a3328] pointer-events-none" />
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={draft.price_usd}
                        onChange={(e) => patch(l.id, 'price_usd', Number(e.target.value))}
                        className="license-input pl-8"
                      />
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="license-label">Tagline / Description</label>
                  <input
                    type="text"
                    maxLength={200}
                    value={draft.description ?? ''}
                    onChange={(e) => patch(l.id, 'description', e.target.value || null)}
                    placeholder="Non-exclusive · Up to 100K streams…"
                    className="license-input"
                  />
                </div>

                {/* File types */}
                <div>
                  <label className="license-label">Files Included</label>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {FILE_TYPE_OPTIONS.map((ft) => {
                      const on = (draft.file_types ?? []).includes(ft);
                      return (
                        <button
                          key={ft}
                          onClick={() => patchFileType(l.id, ft, !on)}
                          className={`px-3 py-1.5 rounded-full text-[10px] font-mono uppercase tracking-wider transition-all border ${
                            on
                              ? 'bg-[#1a1833] border-[#534AB7] text-[#AFA9EC]'
                              : 'bg-transparent border-[#1f1a13] text-[#5a5142] hover:border-[#2d2620] hover:text-[#a08a6a]'
                          }`}
                        >
                          {on && <Check size={8} className="inline mr-1" />}
                          {ft}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Streaming + Distribution limits */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="license-label">Streaming Limit</label>
                    <select
                      value={draft.streaming_limit ?? 'null'}
                      onChange={(e) =>
                        patch(l.id, 'streaming_limit', e.target.value === 'null' ? null : Number(e.target.value))
                      }
                      className="license-input"
                    >
                      {LIMIT_OPTIONS.map((o) => (
                        <option key={String(o.value)} value={o.value ?? 'null'}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="license-label">Distribution Limit</label>
                    <select
                      value={draft.distribution_limit ?? 'null'}
                      onChange={(e) =>
                        patch(l.id, 'distribution_limit', e.target.value === 'null' ? null : Number(e.target.value))
                      }
                      className="license-input"
                    >
                      {LIMIT_OPTIONS.map((o) => (
                        <option key={String(o.value)} value={o.value ?? 'null'}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Rights toggles */}
                <div>
                  <label className="license-label mb-2">Rights</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {(
                      [
                        { field: 'commercial_rights', label: 'Commercial Use', icon: DollarSign },
                        { field: 'sync_rights',        label: 'Sync / Film',    icon: Globe    },
                        { field: 'broadcast_rights',   label: 'Broadcast / TV', icon: Zap      },
                        { field: 'stems_included',     label: 'Stems Included', icon: Music    },
                        { field: 'is_exclusive',       label: 'Exclusive Rights', icon: Lock   },
                        { field: 'credit_required',    label: 'Credit Required', icon: FileText },
                      ] as const
                    ).map(({ field, label, icon: Icon }) => {
                      const on = !!(draft as unknown as Record<string, unknown>)[field];
                      return (
                        <button
                          key={field}
                          onClick={() => patch(l.id, field, !on)}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all border ${
                            on
                              ? 'bg-[#1a1833] border-[#534AB7] text-[#AFA9EC]'
                              : 'bg-[#0c0a08] border-[#1f1a13] text-[#5a5142] hover:border-[#2d2620] hover:text-[#a08a6a]'
                          }`}
                        >
                          <Icon size={11} className="shrink-0" />
                          <span className="text-[10px] font-mono uppercase tracking-wider leading-tight">{label}</span>
                          {on && <Check size={9} className="ml-auto shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Action row */}
                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${l.name}"? This can't be undone.`)) {
                        deleteLicense(l.id);
                      }
                    }}
                    disabled={deleting === l.id}
                    className="flex items-center gap-1.5 text-[11px] text-[#5a5142] hover:text-red-400 transition-colors"
                  >
                    {deleting === l.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                    Delete
                  </button>
                  <button
                    onClick={() => saveLicense(l)}
                    disabled={!isDirty || saving[l.id]}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#D4BFA0] hover:bg-[#E8D8B8] disabled:opacity-40 text-black text-[11px] font-bold uppercase tracking-wider transition-all"
                  >
                    {saving[l.id] ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Add license button */}
      {licenses.length < 4 ? (
        <button
          onClick={createLicense}
          disabled={creating}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-dashed border-[#2d2620] text-[11px] font-mono uppercase tracking-wider text-[#5a5142] hover:text-[#a08a6a] hover:border-[#a08a6a]/30 transition-all disabled:opacity-40"
        >
          {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          Add License Tier
          <span className="text-[#3a3328]">({4 - licenses.length} remaining)</span>
        </button>
      ) : (
        <p className="text-center text-[10px] font-mono text-[#3a3328] py-2">
          Maximum 4 license tiers reached.
        </p>
      )}

      {/* Scoped field styles — shared with settings/licenses */}
      <style jsx global>{`
        .license-label {
          display: block;
          font-size: 9px;
          font-family: ui-monospace, monospace;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: #5a5142;
          margin-bottom: 6px;
        }
        .license-input {
          width: 100%;
          background: #0c0a08;
          border: 1px solid #1f1a13;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 12px;
          color: #E8DCC8;
          outline: none;
          transition: border-color 0.15s;
          appearance: none;
        }
        .license-input::placeholder { color: #3a3328; }
        .license-input:focus { border-color: #8A7A5C; }
      `}</style>
    </div>
  );
}
