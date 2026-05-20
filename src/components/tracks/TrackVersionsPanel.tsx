'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, History as HistoryIcon, RotateCcw, Download, Loader2 } from 'lucide-react';
import { toast, confirmToast } from '@/hooks/useToast';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';

interface TrackVersion {
  id: string;
  version_number: number;
  version_label: string;
  audio_url: string;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  duration_seconds?: number | null;
  created_at: string;
}

export function TrackVersionsPanel({
  trackId,
  trackTitle,
  onReverted,
  refreshKey = 0,
}: {
  trackId: string;
  trackTitle: string;
  onReverted?: () => void;
  /** bump this number to force a refetch — parent uses it after a replace */
  refreshKey?: number;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<TrackVersion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [revertingId, setRevertingId] = useState<string | null>(null);

  const fetchVersions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tracks/${trackId}/versions`);
      const data = await res.json();
      setVersions(Array.isArray(data.versions) ? data.versions : []);
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  };

  // Lazy-load when first opened, refetch when refreshKey changes (after replace)
  useEffect(() => {
    if (open && versions === null) fetchVersions();
  }, [open]);

  useEffect(() => {
    if (open) fetchVersions();
  }, [refreshKey]);

  // Realtime: refetch the list when a new version row lands (replace
  // flow) or an existing one mutates. Versions are rare + the list is
  // small, so a full refetch is simpler and just as cheap as the
  // push-state strategy used in ProjectCommentsPanel. Only subscribes
  // when the panel is open — no need to spend a channel slot on
  // collapsed panels.
  useRealtimeTable({
    table: 'track_versions',
    filter: `track_id=eq.${trackId}`,
    enabled: open,
    onChange: fetchVersions,
  });

  const handleRevert = async (v: TrackVersion) => {
    const ok = await confirmToast(
      `Revert to ${v.version_label}?`,
      'The current audio will be archived as a new version, then this one becomes live.',
      { confirmLabel: 'Revert', cancelLabel: 'Cancel' },
    );
    if (!ok) return;
    setRevertingId(v.id);
    try {
      const res = await fetch(`/api/tracks/${trackId}/versions/${v.id}/revert`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error('Revert failed', json.error || `HTTP ${res.status}`);
        return;
      }
      toast.success(`Reverted to ${v.version_label}`);
      await fetchVersions();
      if (onReverted) onReverted();
    } catch (err: any) {
      toast.error('Revert failed', err?.message);
    } finally {
      setRevertingId(null);
    }
  };

  const handleDownload = (v: TrackVersion) => {
    // Same proxy-through-Content-Disposition trick as the main Export
    // action — without it, R2 cross-origin URLs would open in a new tab
    // instead of downloading.
    const ext = (v.audio_url.match(/\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i)?.[1] || 'wav').toLowerCase();
    const filename = `${trackTitle} — ${v.version_label}.${ext}`;
    const proxied =
      `/api/audio?src=${encodeURIComponent(v.audio_url)}` +
      `&download=1&filename=${encodeURIComponent(filename)}`;
    const a = document.createElement('a');
    a.href = proxied;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="border-b border-[#1f1a13]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-8 py-4 hover:bg-[#101010] transition-colors"
      >
        <div className="flex items-center gap-2">
          <HistoryIcon size={11} className="text-[#6a5d4a]" />
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#a08a6a]">Version history</h3>
          {versions && versions.length > 0 && (
            <span className="text-[9px] font-mono text-[#4a4338]">{versions.length}</span>
          )}
        </div>
        {open ? <ChevronDown size={14} className="text-[#4a4338]" /> : <ChevronRight size={14} className="text-[#4a4338]" />}
      </button>

      {open && (
        <div className="px-4 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={14} className="animate-spin text-[#4a4338]" />
            </div>
          ) : !versions || versions.length === 0 ? (
            <p className="text-[11px] text-[#5a5142] px-4 py-4 leading-relaxed">
              No prior versions. When you replace this track&rsquo;s audio, the previous file is archived here.
            </p>
          ) : (
            <div className="space-y-1">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#16130e] border border-transparent hover:border-[#1f1a13] transition-all"
                >
                  <div className="w-7 h-7 rounded-md bg-[#2A2418] border border-[#8A7A5C]/30 flex items-center justify-center shrink-0">
                    <span className="text-[9px] font-black text-[#E8D8B8]">v{v.version_number}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-[#E8DCC8] truncate font-medium">{v.version_label}</p>
                    <p className="text-[9px] font-mono text-[#5a5142] uppercase tracking-wider mt-0.5">
                      {new Date(v.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {v.bpm ? ` · ${v.bpm} BPM` : ''}
                      {v.key ? ` · ${v.key}${v.scale ? ' ' + v.scale : ''}` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleDownload(v)}
                      className="p-1.5 rounded text-[#6a5d4a] hover:text-[#E8DCC8] hover:bg-[#1a160f]"
                      title="Download this version"
                    >
                      <Download size={11} />
                    </button>
                    <button
                      onClick={() => handleRevert(v)}
                      disabled={revertingId === v.id}
                      className="p-1.5 rounded text-[#6a5d4a] hover:text-[#D4BFA0] hover:bg-[#1a160f] disabled:opacity-50"
                      title="Make this version live"
                    >
                      {revertingId === v.id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
