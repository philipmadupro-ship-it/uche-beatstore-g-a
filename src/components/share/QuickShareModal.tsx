'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Search, Loader2, Music, Link2, Copy, Check } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { copyToClipboard } from '@/lib/clipboard';
import { Dropdown } from '@/components/ui/Dropdown';
import type { Track } from '@/lib/types';

interface Props {
  onClose: () => void;
  /** Called with the new link info once Stripe… err, /api/share returns. */
  onCreated?: (link: { token: string; url: string }) => void;
}

/**
 * Quick-share: pick N tracks from the library, generate a share link
 * pointing at them directly. No project, no playlist — just an
 * ad-hoc link.
 *
 * Backed by POST /api/share with track_ids[]. The endpoint defaults
 * `kind` to 'project' when len>1 and 'track' when len=1 so the
 * recipient page picks the right reader.
 *
 * Future work: forward `recipient_kind` + `sales_enabled` here too
 * so the new audience-variants apply to ad-hoc shares as well. For
 * now this builds the simplest possible link; the existing project
 * share modal stays the place to set audience.
 */
export function QuickShareModal({ onClose, onCreated }: Props) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [title, setTitle] = useState('');
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [expiresDays, setExpiresDays] = useState('0');
  const [creating, setCreating] = useState(false);

  // After creation we show the URL + copy button. Mirrors the
  // ProjectShareModal flow so the visual outcome of "I made a link"
  // is consistent.
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/tracks');
        const data = await res.json();
        const list: Track[] = Array.isArray(data) ? data : data.tracks ?? [];
        setTracks(list);
      } catch (err) {
        console.error('Track fetch failed:', err);
        toast.error('Couldn’t load tracks');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      (t.key ?? '').toLowerCase().includes(q) ||
      String(t.bpm ?? '').includes(q),
    );
  }, [tracks, search]);

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const generateLink = async () => {
    if (selectedIds.size === 0) {
      toast.error('Pick at least one track');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track_ids: Array.from(selectedIds),
          title: title.trim() || null,
          // 0 / null clears expiry. The /api/share POST already
          // handles the empty-string case.
          expires_days: Number(expiresDays) || 0,
          allow_downloads: allowDownloads,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setCreatedUrl(data.url);
      onCreated?.({ token: data.token, url: data.url });
      toast.success('Share link created');
    } catch (err) {
      toast.error('Couldn’t create link', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  const doCopy = async () => {
    if (!createdUrl) return;
    const ok = await copyToClipboard(createdUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-0 md:p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-[560px] max-h-[90vh] rounded-t-3xl md:rounded-2xl overflow-hidden flex flex-col bg-gradient-to-b from-[#121214]/95 via-[#0e0e10]/95 to-[#0a0907]/98 backdrop-blur-2xl border border-white/[0.06] shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.03)_inset] animate-in slide-in-from-bottom-4 md:zoom-in-95 duration-300"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.04]">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#E8D8B8] mb-1">Quick share</p>
            <h2 className="text-[15px] font-medium text-white">Pick tracks · send a link</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[#6a5d4a] hover:text-white hover:bg-white/[0.06]">
            <X size={14} />
          </button>
        </div>

        {createdUrl ? (
          // Done-state — same glass card + copy/dismiss as ProjectShareModal.
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2 bg-white/[0.02] border border-[#8A7A5C]/30 rounded-xl px-3 py-2.5">
              <Link2 size={12} className="text-[#E8D8B8] shrink-0" />
              <input
                readOnly
                value={createdUrl}
                onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
                className="flex-1 bg-transparent text-[11px] text-[#E8DCC8] font-mono focus:outline-none truncate"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={doCopy}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-white text-black text-[12px] font-medium hover:bg-[#E8DCC8] transition-all active:scale-[0.98]"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-3 rounded-full bg-white/[0.04] border border-white/[0.06] text-[#E8DCC8] text-[12px] hover:bg-white/[0.08] transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-6 pt-5 pb-3 border-b border-white/[0.04] space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3a3328]" size={12} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search library… title, key, BPM"
                  className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-md py-2 pl-8 pr-3 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620]"
                />
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider">
                <span className="text-[#5a5142]">
                  {selectedIds.size} selected · {filtered.length} shown
                </span>
                {selectedIds.size > 0 && (
                  <button onClick={() => setSelectedIds(new Set())} className="text-[#6a5d4a] hover:text-[#E8DCC8]">Clear</button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-[#5a5142]">
                  <Loader2 size={14} className="animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-center py-10 text-[11px] text-[#5a5142]">No tracks match.</p>
              ) : (
                <ul className="space-y-0.5">
                  {filtered.map((t) => {
                    const selected = selectedIds.has(t.id);
                    return (
                      <li key={t.id}>
                        <button
                          onClick={() => toggleOne(t.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                            selected ? 'bg-[#2A2418]/30 border border-[#8A7A5C]/30' : 'border border-transparent hover:bg-white/[0.02]'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                            selected ? 'bg-[#D4BFA0] border-[#E8D8B8]' : 'border-[#2d2620]'
                          }`}>
                            {selected && <Check size={9} className="text-black" strokeWidth={3} />}
                          </div>
                          <div className="w-8 h-8 rounded bg-[#14110d] border border-[#1f1a13] overflow-hidden shrink-0">
                            {t.cover_url ? <img loading="lazy" src={t.cover_url} alt="" className="w-full h-full object-cover" /> :
                              <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={10} /></div>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] text-[#E8DCC8] truncate">{t.title}</p>
                            <p className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142] mt-0.5">
                              {t.type}{t.bpm ? ` · ${t.bpm} bpm` : ''}{t.key ? ` · ${t.key}${t.scale ? ' ' + t.scale : ''}` : ''}
                            </p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="px-6 py-4 border-t border-white/[0.04] space-y-3 bg-[#0a0907]/40">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (optional) — e.g. 'For Phil — March pack'"
                className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-md px-3 py-2 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620]"
              />
              <div className="flex items-center gap-2">
                <Dropdown
                  value={expiresDays}
                  onChange={(v) => setExpiresDays(v)}
                  options={[
                    { value: '0',  label: 'Never expires' },
                    { value: '1',  label: '1 day' },
                    { value: '7',  label: '7 days' },
                    { value: '14', label: '14 days' },
                    { value: '30', label: '30 days' },
                  ]}
                  className="flex-1 bg-[#0a0907] border border-[#1f1a13] rounded-md text-[11px] text-[#E8DCC8]"
                />
                <button
                  onClick={() => setAllowDownloads((v) => !v)}
                  className={`px-3 py-2 rounded-md border text-[10px] font-mono uppercase tracking-wider transition-colors ${
                    allowDownloads ? 'bg-[#2A2418] border-[#8A7A5C]/50 text-[#E8D8B8]' : 'bg-[#0a0907] border-[#1f1a13] text-[#5a5142]'
                  }`}
                  title="Allow downloads"
                >
                  {allowDownloads ? 'DL on' : 'DL off'}
                </button>
              </div>
              <button
                onClick={generateLink}
                disabled={creating || selectedIds.size === 0}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-white text-black hover:bg-[#E8DCC8] disabled:opacity-40 text-[12px] font-medium transition-all active:scale-[0.98]"
              >
                {creating ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                Generate link {selectedIds.size > 0 ? `· ${selectedIds.size} track${selectedIds.size === 1 ? '' : 's'}` : ''}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
