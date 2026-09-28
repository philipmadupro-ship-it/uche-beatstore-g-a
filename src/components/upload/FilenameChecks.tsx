'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import type { TitleMetadata } from '@/lib/upload/title-metadata';
import { filenameChecks, type FilenameCheckOption, type FilenameCheckPatch } from '@/lib/upload/filename-check';
import type { DetectedFeatures } from '@/lib/audio/metadata-agreement';
import { toast } from '@/hooks/useToast';

/**
 * What the filename left unsettled, or disagreed with the analyser about —
 * and the one-click answer for each, in the uploads tray.
 *
 * The rows come from `lib/upload/filename-check` (pure, tested); this only
 * renders them and sends the PATCH. Without a track id (`editable` false)
 * the message still shows, with no buttons, rather than an editor bound to
 * nothing.
 */
export function FilenameChecks({
  meta,
  detected,
  trackId,
  editable,
  onApplied,
}: {
  meta: TitleMetadata;
  detected: DetectedFeatures | null | undefined;
  trackId: string;
  editable: boolean;
  onApplied: (patch: FilenameCheckPatch) => void;
}) {
  const checks = useMemo(() => filenameChecks(meta, detected), [meta, detected]);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (checks.length === 0) return null;

  const apply = async (checkId: string, field: 'bpm' | 'key', option: FilenameCheckOption) => {
    if (!editable || !trackId || busy) return;
    setBusy(checkId);
    try {
      const res = await fetch(`/api/tracks/${trackId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(option.patch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      onApplied(option.patch);
      const value = option.label.replace(/^Use /, '');
      setResolved((prev) => ({ ...prev, [checkId]: field === 'bpm' ? `BPM set to ${value}` : `Key set to ${value}` }));
    } catch (err) {
      toast.error(field === 'bpm' ? 'Could not set BPM' : 'Could not set key', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="mt-1 space-y-1" aria-label="Filename and analysis checks">
      {checks.map((check) => {
        const done = resolved[check.id];
        if (done) {
          return (
            <li key={check.id} className="flex items-center gap-1 text-[10px] text-white/40">
              <Check size={9} className="shrink-0 text-[#6DC6A4]" aria-hidden />
              <span>{done}</span>
            </li>
          );
        }
        return (
          <li key={check.id} className="text-[10px]">
            <p className="flex items-start gap-1 text-amber-300">
              <AlertTriangle size={9} className="mt-0.5 shrink-0" aria-hidden />
              <span>{check.message}</span>
            </p>
            {editable && (
              <div className="mt-1 flex flex-wrap gap-1 pl-[13px]">
                {check.options.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    aria-label={option.ariaLabel}
                    disabled={busy != null}
                    onClick={() => void apply(check.id, check.field, option)}
                    className="rounded-lg border border-white/10 bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 disabled:opacity-40"
                  >
                    {option.label}
                    {option.backedByAnalysis && check.id.endsWith('-choice') && (
                      <span className="ml-1 text-white/40">· analysis agrees</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
