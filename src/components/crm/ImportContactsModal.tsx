'use client';

import { useMemo, useRef, useState } from 'react';
import {
  X, Upload, FileSpreadsheet, Loader2, Check, AlertTriangle, Info,
  Mail, Phone, Tag, AtSign,
} from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { useDialogBehavior } from '@/hooks/useDialogBehavior';

interface PreviewContact {
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  label?: string;
  category?: string;
  genre?: string;
  country?: string;
  city?: string;
  instagram?: string;
  twitter?: string;
  website?: string;
  notes?: string;
}

interface RowResult {
  contact: PreviewContact;
  warnings: string[];
  errors: string[];
}

interface PreviewResponse {
  headers: string[];
  sampleRows: string[][];
  results: RowResult[];
  total: number;
  invalid: number;
}

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

const CATEGORIES = ['artist', 'producer', 'manager', 'label', 'a&r', 'dj', 'curator', 'engineer', 'press', 'other'];

const CAT_COLORS: Record<string, string> = {
  artist:    'bg-white/10 text-white border-white/20',
  producer:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  manager:   'bg-amber-500/10 text-amber-400 border-amber-500/30',
  label:     'bg-rose-500/10 text-rose-400 border-rose-500/30',
  'a&r':     'bg-purple-500/10 text-purple-400 border-purple-500/30',
  dj:        'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  curator:   'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
  engineer:  'bg-white/[0.04] text-white/80 border-white/10',
  press:     'bg-white/[0.04] text-white/80 border-white/10',
  other:     'bg-white/[0.04] text-white/70 border-white/10',
};

export function ImportContactsModal({ onClose, onSuccess }: Props) {
  const panelRef = useDialogBehavior({ open: true, onClose });
  const fileRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    inserted: number; skipped: number; total: number;
    categoryBreakdown?: Record<string, number>;
  } | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());

  const handleFile = async (file: File) => {
    setError(null);
    setPreview(null);
    setResult(null);
    setFilename(file.name);
    setSkipped(new Set());
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/contacts/import', { method: 'PUT', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to parse file');
      // Pre-mark rows with errors as skipped
      const initSkip = new Set<number>();
      (json.results as RowResult[]).forEach((r, i) => {
        if (r.errors.length > 0) initSkip.add(i);
      });
      setSkipped(initSkip);
      setPreview(json);
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setParsing(false);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const updateContact = (index: number, patch: Partial<PreviewContact>) => {
    if (!preview) return;
    const next = { ...preview };
    next.results = preview.results.map((r, i) =>
      i === index ? { ...r, contact: { ...r.contact, ...patch } } : r
    );
    setPreview(next);
  };

  const toggleSkip = (index: number) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const counts = useMemo(() => {
    if (!preview) return { ready: 0, errors: 0, warns: 0, byCat: {} as Record<string, number> };
    let ready = 0, errors = 0, warns = 0;
    const byCat: Record<string, number> = {};
    preview.results.forEach((r, i) => {
      if (skipped.has(i)) return;
      ready++;
      if (r.errors.length > 0) errors++;
      if (r.warnings.length > 0) warns++;
      const c = r.contact.category || 'other';
      byCat[c] = (byCat[c] || 0) + 1;
    });
    return { ready, errors, warns, byCat };
  }, [preview, skipped]);

  const submit = async () => {
    if (!preview) return;
    setImporting(true);
    setError(null);
    try {
      const contacts: PreviewContact[] = preview.results
        .filter((_, i) => !skipped.has(i))
        .map((r) => r.contact);
      const res = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Import failed');
      setResult(json);
      onSuccess();
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Import contacts"
        tabIndex={-1}
        className="bg-[#090907] border border-white/10 rounded-lg w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 h-12 border-b border-white/10">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={14} className="text-white" />
            <h2 className="text-[13px] font-medium text-white">Import contacts</h2>
            {filename && <span className="text-[11px] text-white/60 ml-2">· {filename}</span>}
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!preview && !result && (
            <>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                className="border border-dashed border-white/20 rounded-lg p-12 text-center cursor-pointer hover:border-white/40 hover:bg-white/[0.02] transition-colors"
              >
                {parsing ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 size={20} className="animate-spin text-white" />
                    <p className="text-[12px] text-white/80">Parsing {filename}…</p>
                  </div>
                ) : (
                  <>
                    <Upload size={22} className="text-white/50 mx-auto mb-3" />
                    <p className="text-[13px] text-white mb-1">Drop a file or click to upload</p>
                    <p className="text-[11px] text-white/60">.csv, .xlsx, .xls — columns auto-detected</p>
                  </>
                )}
                <input
                  ref={fileRef} type="file"
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={onPick}
                  className="hidden"
                />
              </div>
              {error && (
                <div className="mt-4 flex items-start gap-2 p-3 rounded border border-red-900/50 bg-red-950/20 text-[11px] text-red-300">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <div className="mt-5 grid grid-cols-2 gap-4 text-[11px] text-white/60">
                <div>
                  <p className="text-white/80 mb-2 font-medium">What we detect</p>
                  <ul className="space-y-1">
                    <li>• Name, Email, Phone, Role, Label</li>
                    <li>• Instagram (@handle), Twitter, Website</li>
                    <li>• City, Country, Genre, Category</li>
                  </ul>
                </div>
                <div>
                  <p className="text-white/80 mb-2 font-medium">Smart cleanup</p>
                  <ul className="space-y-1">
                    <li>• Auto-categorize by role (manager / A&R / etc.)</li>
                    <li>• Validate emails &amp; flag bad rows</li>
                    <li>• Skip duplicates by email</li>
                  </ul>
                </div>
              </div>
            </>
          )}

          {preview && !result && (
            <>
              {/* Summary chips */}
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <span className="text-[11px] px-2.5 py-1 rounded-md border border-white/10 bg-white/5 text-white">
                  {counts.ready} ready
                </span>
                {counts.errors > 0 && (
                  <span className="text-[11px] px-2.5 py-1 rounded-md border border-red-900/50 bg-red-950/20 text-red-300">
                    {counts.errors} with errors
                  </span>
                )}
                {counts.warns > 0 && (
                  <span className="text-[11px] px-2.5 py-1 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-500">
                    {counts.warns} warnings
                  </span>
                )}
                <span className="text-[11px] px-2.5 py-1 rounded-md border border-white/10 bg-white/5 text-white/40">
                  {skipped.size} skipped
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => { setPreview(null); setFilename(null); setSkipped(new Set()); }}
                  className="text-[11px] text-white/60 hover:text-white"
                >
                  Choose another file
                </button>
              </div>

              {/* Category breakdown */}
              {Object.keys(counts.byCat).length > 0 && (
                <div className="flex items-center gap-1.5 mb-4 flex-wrap">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-white/40 mr-1">By category</span>
                  {Object.entries(counts.byCat).map(([cat, n]) => (
                    <span
                      key={cat}
                      className={`text-[10px] px-2 py-0.5 rounded border ${CAT_COLORS[cat] || CAT_COLORS.other}`}
                    >
                      {cat} · {n}
                    </span>
                  ))}
                </div>
              )}

              {/* Rows */}
              <div className="border border-white/10 rounded-md overflow-hidden">
                <div className="grid grid-cols-[24px_1.4fr_1.5fr_120px_140px_120px_60px] gap-2 px-3 h-9 items-center bg-[#090907] border-b border-white/10 text-[10px] font-mono uppercase tracking-wider text-white/40">
                  <span></span>
                  <span>Name</span>
                  <span>Email / Phone</span>
                  <span>Instagram</span>
                  <span>Role / Label</span>
                  <span>Category</span>
                  <span className="text-right">Skip</span>
                </div>
                <div className="max-h-[400px] overflow-y-auto">
                  {preview.results.map((r, i) => {
                    const isSkipped = skipped.has(i);
                    const c = r.contact;
                    return (
                      <div
                        key={i}
                        className={`grid grid-cols-[24px_1.4fr_1.5fr_120px_140px_120px_60px] gap-2 px-3 py-2 items-center border-b border-white/10 last:border-b-0 text-[11px] ${
                          isSkipped ? 'opacity-40' : ''
                        } ${r.errors.length > 0 ? 'bg-red-950/10' : ''}`}
                      >
                        {/* row badge */}
                        <div className="flex items-center justify-center">
                          {r.errors.length > 0 ? (
                            <AlertTriangle size={10} className="text-red-400" />
                          ) : r.warnings.length > 0 ? (
                            <Info size={10} className="text-amber-500" />
                          ) : (
                            <span className="text-[9px] font-mono text-white/40">{i + 1}</span>
                          )}
                        </div>

                        {/* Name */}
                        <input
                          value={c.name}
                          onChange={(e) => updateContact(i, { name: e.target.value })}
                          className="bg-transparent text-white truncate focus:outline-none focus:bg-white/10 focus:border focus:border-white/20 rounded px-1.5 py-1 -mx-1.5 -my-1"
                        />

                        {/* Email + phone */}
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5 text-white/80 truncate">
                            {c.email && <Mail size={10} className="text-white/40 shrink-0" />}
                            <input
                              value={c.email || ''}
                              onChange={(e) => updateContact(i, { email: e.target.value })}
                              placeholder={c.email ? '' : 'no email'}
                              className="bg-transparent flex-1 truncate focus:outline-none focus:bg-white/10 rounded px-1 py-0.5"
                            />
                          </div>
                          {(c.phone || true) && (
                            <div className="flex items-center gap-1.5 text-white/60 truncate">
                              {c.phone && <Phone size={10} className="text-white/40 shrink-0" />}
                              <input
                                value={c.phone || ''}
                                onChange={(e) => updateContact(i, { phone: e.target.value })}
                                placeholder={c.phone ? '' : ''}
                                className="bg-transparent flex-1 truncate focus:outline-none focus:bg-white/10 rounded px-1 py-0.5 text-[10px]"
                              />
                            </div>
                          )}
                          {r.errors.map((err, j) => (
                            <p key={j} className="text-[9px] text-red-400 flex items-center gap-1">
                              <AlertTriangle size={8} /> {err}
                            </p>
                          ))}
                        </div>

                        {/* Instagram */}
                        <div className="flex items-center gap-1 text-white/80 truncate">
                          {c.instagram ? (
                            <>
                              <AtSign size={10} className="text-white/40 shrink-0" />
                              <span className="truncate">{c.instagram}</span>
                            </>
                          ) : (
                            <span className="text-white/40">—</span>
                          )}
                        </div>

                        {/* Role / Label */}
                        <div className="min-w-0">
                          <p className="text-white/80 truncate">{c.role || '—'}</p>
                          {c.label && (
                            <p className="text-[9px] text-white/60 truncate flex items-center gap-1">
                              <Tag size={8} /> {c.label}
                            </p>
                          )}
                        </div>

                        {/* Category */}
                        <select
                          value={c.category || 'other'}
                          onChange={(e) => updateContact(i, { category: e.target.value })}
                          className={`text-[10px] px-1.5 py-1 rounded border bg-[#090907] focus:outline-none focus:border-white/40 ${
                            CAT_COLORS[c.category || 'other'] || CAT_COLORS.other
                          }`}
                        >
                          {CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>

                        {/* Skip */}
                        <div className="flex justify-end">
                          <button
                            onClick={() => toggleSkip(i)}
                            className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-1 rounded border ${
                              isSkipped
                                ? 'bg-white/10 border-white/30 text-white'
                                : 'bg-transparent border-white/10 text-white/40 hover:text-red-400 hover:border-red-900/50'
                            }`}
                          >
                            {isSkipped ? 'Skipped' : 'Skip'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {error && (
                <div className="mt-4 flex items-start gap-2 p-3 rounded border border-red-900/50 bg-red-950/20 text-[11px] text-red-300">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}

          {result && (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-full bg-white/10 border border-white/20 flex items-center justify-center mx-auto mb-4">
                <Check size={20} className="text-white" />
              </div>
              <p className="text-[14px] text-white mb-2">Import complete</p>
              <p className="text-[11px] text-white/80 mb-4">
                Added <span className="text-white font-semibold">{result.inserted}</span>
                {result.skipped > 0 && (
                  <>
                    {' '}· Skipped <span className="text-white/80">{result.skipped}</span> duplicate
                    {result.skipped === 1 ? '' : 's'}
                  </>
                )}
              </p>
              {result.categoryBreakdown && Object.keys(result.categoryBreakdown).length > 0 && (
                <div className="flex items-center justify-center gap-1.5 flex-wrap max-w-md mx-auto">
                  {Object.entries(result.categoryBreakdown).map(([cat, n]) => (
                    <span
                      key={cat}
                      className={`text-[10px] px-2 py-0.5 rounded border ${CAT_COLORS[cat] || CAT_COLORS.other}`}
                    >
                      {cat} · {n}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 h-12 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] text-white/80 hover:text-white"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {preview && !result && (
            <LiquidGlassButton
              onClick={submit}
              disabled={importing || counts.ready === 0}
              active
            >
              {importing ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              Import {counts.ready}
            </LiquidGlassButton>
          )}
        </div>
      </div>
    </div>
  );
}
