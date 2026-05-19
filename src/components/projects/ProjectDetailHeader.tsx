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
                className="bg-transparent border-b border-[#2d2620] text-3xl font-medium tracking-tight outline-none text-white flex-1 focus:border-[#D4BFA0]"
                value={tempTitle}
                onChange={(e) => setTempTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onTitleSave()}
              />
              <button onClick={onTitleSave} className="p-1.5 rounded hover:bg-[#16130e] text-[#D4BFA0]"><Check size={14} /></button>
              <button onClick={onTitleEditCancel} className="p-1.5 rounded hover:bg-[#16130e] text-[#5a5142]"><X size={14} /></button>
            </div>
          ) : (
            <div className="group flex items-center gap-2 mb-3">
              <h1 className="text-3xl font-medium text-white leading-none tracking-tight truncate">{project?.name}</h1>
              <button onClick={onTitleEditStart} className="opacity-0 group-hover:opacity-100 p-1.5 text-[#5a5142] hover:text-white transition-all">
                <Edit2 size={13} />
              </button>
            </div>
          )}

          <div className="flex items-center gap-3 text-[11px] font-mono text-[#5a5142] uppercase tracking-wider">
            <span>{trackCount} track{trackCount !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>{fmtDuration(totalDuration)}</span>
            <span>·</span>
            {editingTargets ? (
              <div className="flex items-center gap-1">
                <input
                  value={targetBpm}
                  onChange={(e) => setTargetBpm(e.target.value)}
                  placeholder="BPM"
                  className="w-14 bg-[#0e0c08] border border-[#2d2620] rounded px-2 py-0.5 text-[10px] font-mono text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0]"
                />
                <input
                  value={targetKey}
                  onChange={(e) => setTargetKey(e.target.value)}
                  placeholder="Key"
                  className="w-14 bg-[#0e0c08] border border-[#2d2620] rounded px-2 py-0.5 text-[10px] font-mono text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0]"
                />
                <button onClick={onTargetsSave} className="p-0.5 text-[#D4BFA0]"><Check size={12} /></button>
                <button onClick={onTargetsEditCancel} className="p-0.5 text-[#5a5142]"><X size={12} /></button>
              </div>
            ) : (
              <button onClick={onTargetsEditStart} className="flex items-center gap-1.5 text-[#5a5142] hover:text-[#E8D8B8] transition-colors">
                <Target size={10} />
                Target {fmtBpm(project?.bpm_target)} · {fmtKey(project?.key_target, null)}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onPlay}
            disabled={playDisabled}
            className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded-md text-[12px] font-medium hover:bg-[#E8DCC8] disabled:opacity-30 transition-colors"
          >
            <Play size={12} fill="currentColor" className="ml-0.5" />
            Play
          </button>
          <button
            onClick={onShare}
            disabled={shareDisabled}
            className="flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#2d2620] disabled:opacity-30 transition-colors"
          >
            <Share2 size={12} />
            Share
          </button>
          <button
            onClick={onAddFromLibrary}
            className="flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#2d2620] transition-colors"
          >
            <Library size={12} />
            From library
          </button>
          <button
            onClick={onToggleUpload}
            className="flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#2d2620] transition-colors"
          >
            <Plus size={12} />
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}
