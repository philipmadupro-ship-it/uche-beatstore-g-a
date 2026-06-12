'use client';

import { RefObject, useState } from 'react';
import {
  Camera, Check, Edit2, Library, Loader2, Play, Plus, Share2, X, Tag,
} from 'lucide-react';
import { fmtDuration } from '@/lib/audio/format';
import { ProjectOptionsMenu } from './ProjectOptionsMenu';
import { ProjectTagPicker } from './ProjectTagPicker';
import { DeliveryPackButton } from './DeliveryPackButton';

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

  /** Refetch the project after an options-menu / tag change. */
  onChanged?: () => void;
  /** Called after the project is deleted from the options menu. */
  onDeleted?: () => void;
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
    onPlay, onShare, onAddFromLibrary, onToggleUpload,
    playDisabled, shareDisabled,
    hideCover = false,
    onChanged,
    onDeleted,
  } = props;

  const [tagsOpen, setTagsOpen] = useState(false);

  return (
    <div className={`flex gap-4 sm:gap-7 mb-6 sm:mb-10 ${hideCover ? '' : 'pb-6 sm:pb-8 border-b border-[#1A1813]'}`}>
      {/* Cover — clickable to swap art. Hidden when the parent page is
          rendering a side-by-side layout with the cover in its own
          column. */}
      {!hideCover && (
        <div
          className="w-[160px] h-[160px] bg-[#171511] rounded-lg border border-[#211F1A] overflow-hidden shrink-0 group relative cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          {project?.cover_url ? (
            <img loading="lazy" src={project.cover_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-5xl font-light text-[#211F1A]">
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
      <div className="flex-1 flex flex-col justify-between py-0.5 sm:py-1 min-w-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2 overflow-x-auto scrollbar-hide">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#9B9282]">Project</p>
            <div className="flex items-center gap-1 rounded-full bg-[#11100D] p-1">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => onSetStatus(s)}
                  className={`text-[8px] sm:text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border transition-colors ${
                    (project?.status || 'in_progress') === s
                      ? s === 'in_progress' ? 'text-[#D6BE7A] border-[#3a2f10] bg-[#1a1505]'
                        : s === 'final' ? 'text-[#8ecf9f] border-[#0a3a1a] bg-[#0a1f0f]'
                        : 'text-[#B4AA99] border-[#3B372F] bg-[#1A1813]'
                      : 'text-[#837B6D] border-[#211F1A] hover:text-[#D0C3AF] hover:border-[#3B372F]'
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
                className="bg-transparent border-b-2 border-[#E7D7BE]/40 text-2xl sm:text-4xl font-black tracking-tight outline-none text-white flex-1 focus:border-[#E7D7BE] uppercase"
                value={tempTitle}
                onChange={(e) => setTempTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onTitleSave(); if (e.key === 'Escape') onTitleEditCancel(); }}
              />
              <button onClick={onTitleSave} className="p-1.5 rounded-lg bg-[#E7D7BE]/10 hover:bg-[#E7D7BE]/20 text-[#E7D7BE] transition-colors"><Check size={14} /></button>
              <button onClick={onTitleEditCancel} className="p-1.5 rounded-lg hover:bg-[#1A1813] text-[#9B9282] transition-colors"><X size={14} /></button>
            </div>
          ) : (
            <div className="group flex items-center gap-2 mb-3">
              <h1 className="text-2xl sm:text-4xl font-black text-white leading-none tracking-tight truncate uppercase">{project?.name}</h1>
              <button onClick={onTitleEditStart} className="opacity-0 group-hover:opacity-100 p-1.5 text-[#837B6D] hover:text-[#E7D7BE] transition-all rounded-lg hover:bg-white/[0.04]">
                <Edit2 size={12} />
              </button>
            </div>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className="rounded-full bg-[#11100D] px-2 py-1 text-[9px] sm:text-[10px] font-mono text-[#B4AA99] tabular-nums">
              {trackCount} track{trackCount !== 1 ? 's' : ''}
            </span>
            {totalDuration > 0 && (
              <span className="rounded-full bg-[#11100D] px-2 py-1 text-[9px] sm:text-[10px] font-mono text-[#B4AA99]">
                {fmtDuration(totalDuration)}
              </span>
            )}
          </div>

          {/* Tags — compact dropdown. Storefront controls live lower on the page. */}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {project && (
              <div className="relative">
                <button
                  onClick={() => setTagsOpen((v) => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all ${
                    tagsOpen ? 'bg-[#342F27] border-[#C9BCA8]/40 text-[#F3E6D1]' : 'border-[#2B2821] text-[#B4AA99] hover:text-[#F7EBDD] hover:border-[#3B372F]'
                  }`}
                >
                  <Tag size={11} /> Tags
                </button>
                {tagsOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setTagsOpen(false)} />
                    <div className="absolute top-full left-0 mt-2 z-50">
                      <ProjectTagPicker projectId={project.id} />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons — pill style matching the rest of the app */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap mt-3 sm:mt-4">
          <button
            onClick={onPlay}
            disabled={playDisabled}
            className="grid size-9 place-items-center rounded-full bg-white text-black hover:bg-[#F7EBDD] active:scale-[0.98] disabled:opacity-30 transition-all sm:inline-flex sm:size-auto sm:gap-2 sm:px-4 sm:py-2 sm:text-[12px] sm:font-medium"
            title="Play project"
          >
            <Play size={12} fill="currentColor" className="ml-0.5" />
            <span className="hidden sm:inline">Play</span>
          </button>
          <button
            onClick={onShare}
            disabled={shareDisabled}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-white/[0.08] bg-white/[0.04] text-[#F7EBDD] text-[11px] font-medium hover:bg-white/[0.08] hover:border-white/[0.12] disabled:opacity-30 transition-all sm:gap-2 sm:px-4 sm:py-2.5 sm:text-[12px]"
          >
            <Share2 size={12} />
            Share
          </button>
          <button
            onClick={onAddFromLibrary}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-white/[0.06] bg-transparent text-[#D0C3AF] text-[11px] font-medium hover:text-[#F7EBDD] hover:border-white/[0.1] transition-all sm:gap-2 sm:px-4 sm:py-2.5 sm:text-[12px]"
          >
            <Library size={12} />
            Library
          </button>
          <button
            onClick={onToggleUpload}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-white/[0.06] bg-transparent text-[#D0C3AF] text-[11px] font-medium hover:text-[#F7EBDD] hover:border-white/[0.1] transition-all sm:gap-2 sm:px-4 sm:py-2.5 sm:text-[12px]"
          >
            <Plus size={12} />
            Upload
          </button>
          {project && (
            <DeliveryPackButton projectId={project.id} projectName={project.name} />
          )}
          {project && (
            <ProjectOptionsMenu
              project={project}
              onChanged={onChanged}
              onDeleted={onDeleted}
              align="left"
            />
          )}
        </div>
      </div>
    </div>
  );
}
