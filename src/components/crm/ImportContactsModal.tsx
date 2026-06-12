'use client';

import { useMemo, useRef, useState } from 'react';
import {
  X, Upload, FileSpreadsheet, Loader2, Check, AlertTriangle, Info,
  Mail, Phone, Globe, Tag, AtSign,
} from 'lucide-react';

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
  artist:    'bg-[#342F27] text-[#F3E6D1] border-[#C9BCA8]/40',
  producer:  'bg-[#0e1f17] text-[#6DC6A4] border-[#6DC6A4]/30',
  manager:   'bg-[#1f1a0a] text-[#E2C16D] border-[#E2C16D]/30',
  label:     'bg-[#1f0a0a] text-[#E26D5C] border-[#E26D5C]/30',
  'a&r':     'bg-[#1f0a1a] text-[#F09EE3] border-[#F09EE3]/30',
  dj:        'bg-[#0a1f1f] text-[#6DC6E2] border-[#6DC6E2]/30',
  curator:   'bg-[#1a1a2e] text-[#F3E6D1] border-[#E7D7BE]/30',
  engineer:  'bg-[#1A1813] text-[#D0C3AF] border-[#211F1A]',
  press:     'bg-[#1A1813] text-[#D0C3AF] border-[#211F1A]',
  other:     'bg-[#1A1813] text-[#B4AA99] border-[#211F1A]',
};

export function ImportContactsModal({ onClose, onSuccess }: Props) {
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
    } catch (e: any) {
      setError(e.message);
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
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#090907] border border-[#211F1A] rounded-lg w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 h-12 border-b border-[#1A1813]">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={14} className="text-[#F3E6D1]" />
            <h2 className="text-[13px] font-medium text-white">Import contacts</h2>
            {filename && <span className="text-[11px] text-[#9B9282] ml-2">· {filename}</span>}
          </div>
          <button onClick={onClose} className="text-[#9B9282] hover:text-white">
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
                className="border border-dashed border-[#1f1f1f] rounded-lg p-12 text-center cursor-pointer hover:border-[#3B372F] hover:bg-[#11100D] transition-colors"
              >
                {parsing ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 size={20} className="animate-spin text-[#F3E6D1]" />
                    <p className="text-[12px] text-[#D0C3AF]">Parsing {filename}…</p>
                  </div>
                ) : (
                  <>
                    <Upload size={22} className="text-[#837B6D] mx-auto mb-3" />
                    <p className="text-[13px] text-[#F7EBDD] mb-1">Drop a file or click to upload</p>
                    <p className="text-[11px] text-[#9B9282]">.csv, .xlsx, .xls — columns auto-detected</p>
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
              <div className="mt-5 grid grid-cols-2 gap-4 text-[11px] text-[#B4AA99]">
                <div>
                  <p className="text-[#D0C3AF] mb-2 font-medium">What we detect</p>
                  <ul className="space-y-1">
                    <li>• Name, Email, Phone, Role, Label</li>
                    <li>• Instagram (@handle), Twitter, Website</li>
                    <li>• City, Country, Genre, Category</li>
                  </ul>
                </div>
                <div>
                  <p className="text-[#D0C3AF] mb-2 font-medium">Smart cleanup</p>
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
                <span className="text-[11px] px-2.5 py-1 rounded-md border border-[#211F1A] bg-[#171511] text-[#F7EBDD]">
                  {counts.ready} ready
                </span>
                {counts.errors > 0 && (
                  <span className="text-[11px] px-2.5 py-1 rounded-md border border-red-900/50 bg-red-950/20 text-red-300">
                    {counts.errors} with errors
                  </span>
                )}
                {counts.warns > 0 && (
                  <span className="text-[11px] px-2.5 py-1 rounded-md border border-[#E2C16D]/30 bg-[#1f1a0a] text-[#E2C16D]">
                    {counts.warns} warnings
                  </span>
                )}
                <span className="text-[11px] px-2.5 py-1 rounded-md border border-[#211F1A] bg-[#171511] text-[#9B9282]">
                  {skipped.size} skipped
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => { setPreview(null); setFilename(null); setSkipped(new Set()); }}
                  className="text-[11px] text-[#D0C3AF] hover:text-white"
                >
                  Choose another file
                </button>
              </div>

              {/* Category breakdown */}
              {Object.keys(counts.byCat).length > 0 && (
                <div className="flex items-center gap-1.5 mb-4 flex-wrap">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#9B9282] mr-1">By category</span>
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
              <div className="border border-[#1A1813] rounded-md overflow-hidden">
                <div className="grid grid-cols-[24px_1.4fr_1.5fr_120px_140px_120px_60px] gap-2 px-3 h-9 items-center bg-[#090907] border-b border-[#1A1813] text-[10px] font-mono uppercase tracking-wider text-[#6E685B]">
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
                        className={`grid grid-cols-[24px_1.4fr_1.5fr_120px_140px_120px_60px] gap-2 px-3 py-2 items-center border-b border-[#24211B] last:border-b-0 text-[11px] ${
                          isSkipped ? 'opacity-40' : ''
                        } ${r.errors.length > 0 ? 'bg-red-950/10' : ''}`}
                      >
                        {/* row badge */}
                        <div className="flex items-center justify-center">
                          {r.errors.length > 0 ? (
                            <AlertTriangle size={10} className="text-red-400" />
                          ) : r.warnings.length > 0 ? (
                            <Info size={10} className="text-[#E2C16D]" />
                          ) : (
                            <span className="text-[9px] font-mono text-[#6E685B]">{i + 1}</span>
                          )}
                        </div>

                        {/* Name */}
                        <input
                          value={c.name}
                          onChange={(e) => updateContact(i, { name: e.target.value })}
                          className="bg-transparent text-[#F7EBDD] truncate focus:outline-none focus:bg-[#171511] focus:border focus:border-[#211F1A] rounded px-1.5 py-1 -mx-1.5 -my-1"
                        />

                        {/* Email + phone */}
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5 text-[#D0C3AF] truncate">
                            {c.email && <Mail size={10} className="text-[#837B6D] shrink-0" />}
                            <input
                              value={c.email || ''}
                              onChange={(e) => updateContact(i, { email: e.target.value })}
                              placeholder={c.email ? '' : 'no email'}
                              className="bg-transparent flex-1 truncate focus:outline-none focus:bg-[#171511] rounded px-1 py-0.5"
                            />
                          </div>
                          {(c.phone || true) && (
                            <div className="flex items-center gap-1.5 text-[#B4AA99] truncate">
                              {c.phone && <Phone size={10} className="text-[#837B6D] shrink-0" />}
                              <input
                                value={c.phone || ''}
                                onChange={(e) => updateContact(i, { phone: e.target.value })}
                                placeholder={c.phone ? '' : ''}
                                className="bg-transparent flex-1 truncate focus:outline-none focus:bg-[#171511] rounded px-1 py-0.5 text-[10px]"
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
                        <div className="flex items-center gap-1 text-[#D0C3AF] truncate">
                          {c.instagram ? (
                            <>
                              <AtSign size={10} className="text-[#837B6D] shrink-0" />
                              <span className="truncate">{c.instagram}</span>
                            </>
                          ) : (
                            <span className="text-[#6E685B]">—</span>
                          )}
                        </div>

                        {/* Role / Label */}
                        <div className="min-w-0">
                          <p className="text-[#D0C3AF] truncate">{c.role || '—'}</p>
                          {c.label && (
                            <p className="text-[9px] text-[#9B9282] truncate flex items-center gap-1">
                              <Tag size={8} /> {c.label}
                            </p>
                          )}
                        </div>

                        {/* Category */}
                        <select
                          value={c.category || 'other'}
                          onChange={(e) => updateContact(i, { category: e.target.value })}
                          className={`text-[10px] px-1.5 py-1 rounded border bg-[#090907] focus:outline-none focus:border-[#3B372F] ${
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
                                ? 'bg-[#211F1A] border-[#3B372F] text-[#D0C3AF]'
                                : 'bg-transparent border-[#211F1A] text-[#9B9282] hover:text-red-400 hover:border-red-900/50'
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
              <div className="w-12 h-12 rounded-full bg-[#342F27] border border-[#E7D7BE]/30 flex items-center justify-center mx-auto mb-4">
                <Check size={20} className="text-[#F3E6D1]" />
              </div>
              <p className="text-[14px] text-white mb-2">Import complete</p>
              <p className="text-[11px] text-[#D0C3AF] mb-4">
                Added <span className="text-[#F3E6D1]">{result.inserted}</span>
                {result.skipped > 0 && (
                  <>
                    {' '}· Skipped <span className="text-[#D0C3AF]">{result.skipped}</span> duplicate
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

        <div className="flex items-center justify-end gap-2 px-5 h-12 border-t border-[#1A1813]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] text-[#D0C3AF] hover:text-white"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {preview && !result && (
            <button
              onClick={submit}
              disabled={importing || counts.ready === 0}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white text-black hover:bg-[#F7EBDD] disabled:opacity-50 text-[11px] font-medium transition-colors"
            >
              {importing ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              Import {counts.ready}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
