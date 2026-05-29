'use client';

import { RefObject } from 'react';
import {
  Camera, Check, Edit2, Library, Loader2, Play, Plus, Share2, Target, X,
} from 'lucide-react';
import { fmtBpm, fmtKey, fmtDuration } from '@/lib/audio/format';

interface Project {
  id: string;
  name: string;
  cover_url?: string | null;
  status?: 'in_progress' | 'final' | 'archived';
  bpm_target?: number | null;
  key_target?: string | null;
  store_featured?: boolean;
}

const STATUSES = ['in_progress', 'final', 'archived'] as const;
type Status = (typeof STATUSES)[number];

interface Props {
  project: Project | null;
  trackCount: number;
  totalDuration: number;
  uploadingArt: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onArtChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSetStatus: (s: Status) => void;

  isEditingTitle: boolean;
  tempTitle: string;
  setTempTitle: (v: string) => void;
  onTitleEditStart: () => void;
  onTitleEditCancel: () => void;
  onTitleSave: () => void;

  editingTargets: boolean;
  targetBpm: string;
  setTargetBpm: (v: string) => void;
  targetKey: string;
  setTargetKey: (v: string) => void;
  onTargetsEditStart: () => void;
  onTargetsEditCancel: () => void;
  onTargetsSave: () => void;

  onPlay: () => void;
  onShare: () => void;
  onAddFromLibrary: () => void;
  onToggleUpload: () => void;

  playDisabled: boolean;
  shareDisabled: boolean;
  /** When true the cover thumbnail is hidden — the page renders it
   *  separately in a side-by-side layout. Default keeps the original
   *  cover-inline shape so existing callers stay unchanged. */
  hideCover?: boolean;

  // Store curation
  storeFeatured?: boolean;
  onToggleStoreFeatured?: () => void;
  storeFeaturedPending?: boolean;
}

/**
 * Project detail page header — cover, status pills, title (with inline
 * edit), stats row (track count · duration · target BPM/Key with inline
 * edit), and the action button cluster.
 *
 * Extracted from `app/(dashboard)/projects/[id]/page.tsx` so the page
 * file can stay focused on state + data orchestration. Every interactive
 * element threads its state and handlers through props — no fetch, no
 * mutation here.
 */
export function ProjectDetailHeader(props: Props) {
  const {
    project, trackCount, totalDuration,
    uploadingArt, fileInputRef, onArtChange, onSetStatus,
    isEditingTitle, tempTitle, setTempTitle,
    onTitleEditStart, onTitleEditCancel, onTitleSave,
    editingTargets, targetBpm, setTargetBpm, targetKey, setTargetKey,
    onTargetsEditStart, onTargetsEditCancel, onTargetsSave,
    onPlay, onShare, onAddFromLibrary, onToggleUpload,
    playDisabled, shareDisabled,
    hideCover = false,
    storeFeatured = false,
    onToggleStoreFeatured,
    storeFeaturedPending = false,
  } = props;

  return (
    <div className={`flex gap-7 mb-10 ${hideCover ? '' : 'pb-8 border-b border-[#16130e]'}`}>
      {/* Cover — clickable to swap art. Hidden when the parent page is
          rendering a side-by-side layout with the cover in its own
          column. */}
      {!hideCover && (
        <div
          className="w-[160px] h-[160px] bg-[#14110d] rounded-lg border border-[#1a160f] overflow-hidden shrink-0 group relative cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          {project?.cover_url ? (
            <img loading="lazy" src={project.cover_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-5xl font-light text-[#1a160f]">
              {project?.name?.[0] || 'P'}
            </div>
          )}
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
            {uploadingArt ? <Loader2 size={16} className="animate-spin text-white" /> : <Camera size={16} className="text-white" />}
          </div>
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={onArtChange} />
        </div>
      )}

      {/* Meta column — kicker, title, stats, actions. */}
      <div className="flex-1 flex flex-col justify-between py-1 min-w-0">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#5a5142]">Project</p>
            <div className="flex items-center gap-1">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => onSetStatus(s)}
                  className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border transition-colors ${
                    (project?.status || 'in_progress') === s
                      ? s === 'in_progress' ? 'text-[#c8a84b] border-[#3a2f10] bg-[#1a1505]'
                        : s === 'final' ? 'text-[#8ecf9f] border-[#0a3a1a] bg-[#0a1f0f]'
                        : 'text-[#6a5d4a] border-[#2d2620] bg-[#16130e]'
                      : 'text-[#4a4338] border-[#1a160f] hover:text-[#a08a6a] hover:border-[#2d2620]'
                  }`}
                >
                  {s.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {isEditingTitle ? (
            <div className="flex items-center gap-2 mb-3">
              <input
                autoFocus
                className="bg-transparent border-b-2 border-[#D4BFA0]/40 text-4xl font-black tracking-tight outline-none text-white flex-1 focus:border-[#D4BFA0] uppercase"
                value={tempTitle}
                onChange={(e) => setTempTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onTitleSave(); if (e.key === 'Escape') onTitleEditCancel(); }}
              />
              <button onClick={onTitleSave} className="p-1.5 rounded-lg bg-[#D4BFA0]/10 hover:bg-[#D4BFA0]/20 text-[#D4BFA0] transition-colors"><Check size={14} /></button>
              <button onClick={onTitleEditCancel} className="p-1.5 rounded-lg hover:bg-[#16130e] text-[#5a5142] transition-colors"><X size={14} /></button>
            </div>
          ) : (
            <div className="group flex items-center gap-2 mb-3">
              <h1 className="text-4xl font-black text-white leading-none tracking-tight truncate uppercase">{project?.name}</h1>
              <button onClick={onTitleEditStart} className="opacity-0 group-hover:opacity-100 p-1.5 text-[#4a4338] hover:text-[#D4BFA0] transition-all rounded-lg hover:bg-white/[0.04]">
                <Edit2 size={12} />
              </button>
            </div>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] font-mono text-[#5a5142] tabular-nums">
              {trackCount} track{trackCount !== 1 ? 's' : ''}
            </span>
            {totalDuration > 0 && (
              <>
                <span className="text-[#2d2620]">·</span>
                <span className="text-[10px] font-mono text-[#5a5142]">{fmtDuration(totalDuration)}</span>
              </>
            )}
            <span className="text-[#2d2620]">·</span>
            {editingTargets ? (
              <div className="flex items-center gap-1">
                <input
                  value={targetBpm}
                  onChange={(e) => setTargetBpm(e.target.value)}
                  placeholder="BPM"
                  className="w-14 bg-[#0e0c08] border border-[#2d2620] rounded-lg px-2 py-1 text-[10px] font-mono text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0]"
                />
                <input
                  value={targetKey}
                  onChange={(e) => setTargetKey(e.target.value)}
                  placeholder="Key"
                  className="w-14 bg-[#0e0c08] border border-[#2d2620] rounded-lg px-2 py-1 text-[10px] font-mono text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0]"
                />
                <button onClick={onTargetsSave} className="p-1 text-[#D4BFA0] hover:bg-[#D4BFA0]/10 rounded transition-colors"><Check size={11} /></button>
                <button onClick={onTargetsEditCancel} className="p-1 text-[#5a5142] hover:bg-white/[0.04] rounded transition-colors"><X size={11} /></button>
              </div>
            ) : (
              <button onClick={onTargetsEditStart} className="flex items-center gap-1.5 text-[10px] font-mono text-[#5a5142] hover:text-[#E8D8B8] transition-colors">
                <Target size={9} />
                {project?.bpm_target || project?.key_target
                  ? `Target ${fmtBpm(project?.bpm_target)} ${fmtKey(project?.key_target, null)}`.trim()
                  : 'Set target BPM / Key'}
              </button>
            )}
          </div>

          {/* List in store — prominent pill so it's easy to find */}
          <div className="mt-2">
            <button
              onClick={onToggleStoreFeatured}
              disabled={!onToggleStoreFeatured || storeFeaturedPending}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all disabled:opacity-40 ${
                storeFeatured
                  ? 'bg-[#D4BFA0]/15 border-[#D4BFA0]/40 text-[#D4BFA0]'
                  : 'border-[#1f1a13] text-[#6a5d4a] hover:text-[#E8DCC8] hover:border-[#2d2620]'
              }`}
              title="Toggle visibility on the public /store page"
            >
              {storeFeaturedPending
                ? <Loader2 size={11} className="animate-spin" />
                : <span className="text-[10px]">{storeFeatured ? '✓' : '+'}</span>}
              {storeFeatured ? 'In store' : 'List in store'}
            </button>
          </div>
        </div>

        {/* Action buttons — pill style matching the rest of the app */}
        <div className="flex items-center gap-2 flex-wrap mt-4">
          <button
            onClick={onPlay}
            disabled={playDisabled}
            className="flex items-center gap-2 bg-white text-black px-5 py-2.5 rounded-full text-[12px] font-medium hover:bg-[#E8DCC8] active:scale-[0.98] disabled:opacity-30 transition-all"
          >
            <Play size={12} fill="currentColor" className="ml-0.5" />
            Play
          </button>
          <button
            onClick={onShare}
            disabled={shareDisabled}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/[0.08] bg-white/[0.04] text-[#E8DCC8] text-[12px] font-medium hover:bg-white/[0.08] hover:border-white/[0.12] disabled:opacity-30 transition-all"
          >
            <Share2 size={12} />
            Share
          </button>
          <button
            onClick={onAddFromLibrary}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/[0.06] bg-transparent text-[#a08a6a] text-[12px] font-medium hover:text-[#E8DCC8] hover:border-white/[0.1] transition-all"
          >
            <Library size={12} />
            Library
          </button>
          <button
            onClick={onToggleUpload}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/[0.06] bg-transparent text-[#a08a6a] text-[12px] font-medium hover:text-[#E8DCC8] hover:border-white/[0.1] transition-all"
          >
            <Plus size={12} />
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}
