'use client';

import { Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { PROJECT_TEMPLATES, seedChecklist } from '@/lib/projects/templates';
import { toast } from '@/hooks/useToast';

/**
 * Template picker modal. Used when creating a project or from the options menu
 * to apply a template to an existing project (seeds the checklist). Fires
 * onApplied(slug, checklist) so the caller can PATCH the project.
 */
export function TemplatePicker({
  projectId,
  onClose,
  onApplied,
}: {
  projectId: string;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const [applying, setApplying] = useState<string | null>(null);

  const apply = async (slug: string) => {
    const tpl = PROJECT_TEMPLATES.find((t) => t.slug === slug);
    if (!tpl || applying) return;
    setApplying(slug);
    try {
      const checklist = seedChecklist(tpl);
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: slug, checklist }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`${tpl.label} template applied`);
      onApplied?.();
      onClose();
    } catch (err) {
      toast.error("Couldn't apply template", err instanceof Error ? err.message : 'Try again');
    } finally { setApplying(null); }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.02] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="text-[13px] font-semibold text-white">Apply a template</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors"><X size={14} /></button>
        </div>
        <p className="px-5 pt-3 pb-1 text-[11px] text-white/60 leading-relaxed">
          Seeds a production checklist. Your tracks and metadata are unaffected.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-4">
          {PROJECT_TEMPLATES.map((tpl) => (
            <button key={tpl.slug} onClick={() => apply(tpl.slug)} disabled={!!applying}
              className="flex items-start gap-3 p-3 rounded-xl border border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.05] transition-colors text-left disabled:opacity-50">
              <span className="text-2xl shrink-0">{tpl.emoji}</span>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-white flex items-center gap-2">
                  {tpl.label}
                  {applying === tpl.slug && <Loader2 size={11} className="animate-spin text-white/40" />}
                </p>
                <p className="text-[10px] text-white/40 mt-0.5">{tpl.description}</p>
                <p className="text-[9px] font-mono text-white/30 mt-1">{tpl.checklist.length} checklist items</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
