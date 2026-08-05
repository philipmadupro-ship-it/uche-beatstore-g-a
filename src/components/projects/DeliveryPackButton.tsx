'use client';

import { useState } from 'react';
import { Download, Loader2, PackageOpen } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { useDialogBehavior } from '@/hooks/useDialogBehavior';

interface Props {
  projectId: string;
  projectName: string;
}

/**
 * Delivery pack export. Fetches a manifest of all WAV + stem URLs for the
 * project and triggers individual anchor-downloads sequentially (no zip lib
 * dep; works for small projects). Shows the file list in a small panel so the
 * producer can see what's included before downloading.
 */
export function DeliveryPackButton({ projectId, projectName }: Props) {
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<{ name: string; url: string; type: string }[] | null>(null);
  const [open, setOpen] = useState(false);
  const panelRef = useDialogBehavior({ open, onClose: () => setOpen(false) });

  const fetchManifest = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/export`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setFiles(data.files ?? []);
      setOpen(true);
    } catch (err) {
      toast.error('Export failed', err instanceof Error ? err.message : 'Try again');
    } finally { setLoading(false); }
  };

  const downloadAll = () => {
    if (!files) return;
    // Stagger anchor-click downloads slightly so browsers don't block them.
    files.forEach((f, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = f.url;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, i * 300);
    });
    toast.success(`Downloading ${files.length} file${files.length === 1 ? '' : 's'}`);
  };

  const masters = files?.filter((f) => f.type === 'master') ?? [];
  const stems = files?.filter((f) => f.type === 'stem') ?? [];

  return (
    <>
      <button
        onClick={() => (open ? setOpen(false) : files ? setOpen(true) : fetchManifest())}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/[0.06] bg-transparent text-white/80 text-[12px] font-medium hover:text-white hover:border-white/[0.1] transition-all disabled:opacity-50"
        title="Export delivery pack (WAVs + stems)"
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : <PackageOpen size={13} />}
        Delivery pack
      </button>

      {open && files && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Delivery pack — ${projectName}`}
            tabIndex={-1}
            className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.02] focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-[13px] font-semibold text-white">Delivery pack</h3>
                <p className="text-[10px] text-white/40 mt-0.5">{projectName}</p>
              </div>
              <span className="text-[10px] font-mono text-white/30">{files.length} file{files.length !== 1 ? 's' : ''}</span>
            </div>

            {files.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-[12px] text-white/40">No downloadable files yet — upload WAV masters or stems to the tracks in this project.</p>
              </div>
            ) : (
              <>
                <div className="max-h-64 overflow-y-auto px-3 py-3 space-y-2">
                  {masters.length > 0 && (
                    <div>
                      <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40 mb-1.5 px-1">Masters</p>
                      {masters.map((f) => (
                        <FileRow key={f.name} file={f} />
                      ))}
                    </div>
                  )}
                  {stems.length > 0 && (
                    <div>
                      <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40 mb-1.5 px-1 mt-2">Stems</p>
                      {stems.map((f) => (
                        <FileRow key={f.name} file={f} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="px-4 py-3 border-t border-white/10 flex items-center justify-end gap-2">
                  <button onClick={() => setOpen(false)} className="px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-white/60 hover:text-white">Cancel</button>
                  <button onClick={downloadAll}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-black text-[11px] font-bold hover:bg-white transition-colors">
                    <Download size={12} /> Download all ({files.length})
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function FileRow({ file }: { file: { name: string; url: string } }) {
  return (
    <a href={file.url} download={file.name}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.05] transition-colors group">
      <Download size={11} className="text-white/40 group-hover:text-white shrink-0" />
      <span className="text-[11px] text-white truncate flex-1">{file.name}</span>
    </a>
  );
}
