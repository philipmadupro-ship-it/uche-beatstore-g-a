'use client';

import { useState } from 'react';
import { Library, Play, Plus, Share2 } from 'lucide-react';
import { fmtDuration } from '@/lib/audio/format';
import { ProjectOptionsMenu } from './ProjectOptionsMenu';
import { DeliveryPackButton } from './DeliveryPackButton';
import { InlineText } from '@/components/ui/InlineText';
import { InlineTagStrip, type TagGroup } from '@/components/ui/InlineTagStrip';
import { TAG_TAXONOMY, PROJECT_TYPE_OPTIONS } from '@/lib/types/tags';
import { useProjectTags } from '@/hooks/useProjectTags';

interface Project {
  id: string;
  name: string;
  cover_url?: string | null;
  description?: string | null;
  status?: 'in_progress' | 'final' | 'archived';
  bpm_target?: number | null;
  key_target?: string | null;
  store_featured?: boolean;
}

const STATUSES = ['in_progress', 'final', 'archived'] as const;
type Status = (typeof STATUSES)[number];

/**
 * Tag vocabulary for a project: its own type vocabulary first (this is the
 * facet a producer reaches for most on a project), then the shared taxonomy so
 * projects and tracks cross-filter on the same words.
 */
const PROJECT_TAG_GROUPS: TagGroup[] = [
  { category: 'project_type', label: 'Project type', options: PROJECT_TYPE_OPTIONS },
  ...Object.entries(TAG_TAXONOMY).map(([category, options]) => ({
    category,
    label: category,
    options: options as readonly string[],
  })),
];

interface Props {
  project: Project | null;
  trackCount: number;
  totalDuration: number;
  onSetStatus: (s: Status) => void;

  /** Rename. Returns false when the save was rejected so the field stays open. */
  onRename: (next: string) => Promise<boolean>;
  /** Target BPM / key, saved one field at a time. */
  onSaveTargets: (patch: { bpm_target?: number | null; key_target?: string | null }) => Promise<boolean>;
  /** Description, autosaved from the header — no Save button to hunt for. */
  onSaveDescription: (next: string) => Promise<boolean>;

  onPlay: () => void;
  onShare: () => void;
  onAddFromLibrary: () => void;
  onToggleUpload: () => void;
  onEditCover: () => void;

  playDisabled: boolean;
  shareDisabled: boolean;

  /** Refetch the project after an options-menu / tag change. */
  onChanged?: () => void;
  /** Called after the project is deleted from the options menu. */
  onDeleted?: () => void;
}

/**
 * Project detail header — the project's command center.
 *
 * Everything a producer touches on an ordinary day is editable here, in place:
 * title, status, tags, target BPM/key, and the description. None of it opens
 * another screen. The ⋯ menu holds what is left — the actions that are either
 * rare (templates, folders) or destructive.
 *
 * The interaction hierarchy this follows, app-wide:
 *   direct manipulation → contextual popover → dropdown → modal → Studio
 *
 * So: status is a visible segmented control (one click), tags are pills you can
 * strip off individually with a popover to add (one click / two), title and
 * targets are click-to-edit fields, and only the long tail lives behind ⋯.
 *
 * Before this, the title needed the ⋯ menu, tags needed a nested dropdown, and
 * BPM/key targets could not be edited on this page at all — the header took
 * `editingTargets`/`targetBpm`/`targetKey`/`onTargetsSave` props and rendered
 * none of them, so the page was passing state to a control that did not exist.
 *
 * Still props-only for data mutations; the page owns fetching and PATCHes.
 */
export function ProjectDetailHeader(props: Props) {
  const {
    project, trackCount, totalDuration,
    onSetStatus, onRename, onSaveTargets, onSaveDescription,
    onPlay, onShare, onAddFromLibrary, onToggleUpload, onEditCover,
    playDisabled, shareDisabled,
    onChanged, onDeleted,
  } = props;

  // Title and tag editors can be opened from the ⋯ menu as well as by clicking
  // the thing itself, so their open state is controlled here.
  const [editingTitle, setEditingTitle] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);

  const { tags, toggleTag } = useProjectTags(project?.id ?? '');

  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-10">
      {/* Kicker + status. Status is a first-class segmented control rather
          than a menu item: it is the property that changes most often and it
          also has to be readable at a glance. */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        <p className="shrink-0 text-[10px] font-mono uppercase tracking-[0.2em] text-white/50">Project</p>
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.02] p-1">
          {STATUSES.map((s) => {
            const active = (project?.status || 'in_progress') === s;
            return (
              <button
                key={s}
                onClick={() => onSetStatus(s)}
                aria-pressed={active}
                className={`rounded-full border px-2 py-0.5 text-[8px] font-mono uppercase tracking-wider transition-colors sm:text-[9px] ${
                  active
                    ? 'border-white/30 bg-white/10 text-white'
                    : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white'
                }`}
              >
                {s.replace('_', ' ')}
              </button>
            );
          })}
        </div>
      </div>

      {/* Title — click to edit, Enter to save. */}
      <InlineText
        label="Project title"
        value={project?.name ?? ''}
        editing={editingTitle}
        onEditingChange={setEditingTitle}
        onSave={onRename}
        maxLength={200}
        placeholder="Untitled project"
        className="-mx-2 px-2 py-1 text-2xl font-black uppercase leading-none tracking-tight text-white sm:text-4xl"
        inputClassName="text-2xl sm:text-4xl font-black tracking-tight uppercase"
      />

      {/* Facts row — counts are read-only, targets are click-to-edit.
          Everything is the same chip so the editable ones don't shout. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Fact>{trackCount} track{trackCount !== 1 ? 's' : ''}</Fact>
        {totalDuration > 0 && <Fact>{fmtDuration(totalDuration)}</Fact>}

        <EditableFact
          label="Target BPM"
          value={project?.bpm_target != null ? String(project.bpm_target) : ''}
          suffix="BPM"
          empty="Set BPM"
          onSave={async (next) => {
            if (next === '') return onSaveTargets({ bpm_target: null });
            const n = Number(next);
            // Same 20–300 window the track metadata editor enforces; a typo
            // that lands outside it is a typo, not a tempo.
            if (!Number.isFinite(n) || n < 20 || n > 300) return false;
            return onSaveTargets({ bpm_target: Math.round(n) });
          }}
        />
        <EditableFact
          label="Target key"
          value={project?.key_target ?? ''}
          empty="Set key"
          onSave={async (next) => onSaveTargets({ key_target: next === '' ? null : next })}
        />
      </div>

      {/* Tags — pills with per-pill remove, popover to add. */}
      {project && (
        <InlineTagStrip
          subject="project"
          tags={tags}
          groups={PROJECT_TAG_GROUPS}
          open={tagsOpen}
          onOpenChange={setTagsOpen}
          onToggle={({ tag, category, active }) => toggleTag.mutate({ tag, category, active })}
        />
      )}

      {/* Description — the copy that shows on the storefront. It used to live
          at the very bottom of the page behind a Save button; it autosaves
          here, where the producer is already looking at the project. */}
      <InlineText
        label="Project description"
        value={project?.description ?? ''}
        editing={descOpen}
        onEditingChange={setDescOpen}
        onSave={onSaveDescription}
        multiline
        rows={3}
        maxLength={10000}
        placeholder="Describe this project…"
        emptyLabel="Add a description"
        className="-mx-2 max-w-2xl px-2 py-1 text-[11px] leading-relaxed text-white/60"
        inputClassName="text-[11px] max-w-2xl"
      />

      {/* Action buttons — the four things that are not property edits. */}
      <div className="mt-1 flex flex-wrap items-center gap-1.5 sm:gap-2">
        <button
          onClick={onPlay}
          disabled={playDisabled}
          className="glass-play grid size-9 place-items-center rounded-full border border-white/[0.14] bg-white/[0.07] text-white backdrop-blur-md shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_2px_10px_rgba(0,0,0,0.28)] transition-[transform,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-spring)] hover:border-white/25 hover:bg-white/[0.13] disabled:opacity-30 sm:inline-flex sm:size-auto sm:gap-2 sm:px-4 sm:py-2 sm:text-[11px] sm:font-medium"
          title="Play project"
        >
          <Play size={12} fill="currentColor" className="ml-0.5" />
          <span className="hidden sm:inline">Play</span>
        </button>
        <button
          onClick={onShare}
          disabled={shareDisabled}
          className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] font-medium text-white transition-all hover:border-white/[0.12] hover:bg-white/[0.08] disabled:opacity-30 sm:gap-2 sm:px-4 sm:py-2.5 sm:text-[11px]"
        >
          <Share2 size={12} />
          Share
        </button>
        <button
          onClick={onAddFromLibrary}
          className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-transparent px-3 py-2 text-[11px] font-medium text-white/60 transition-all hover:border-white/[0.1] hover:text-white sm:gap-2 sm:px-4 sm:py-2.5 sm:text-[11px]"
        >
          <Library size={12} />
          Library
        </button>
        <button
          onClick={onToggleUpload}
          className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-transparent px-3 py-2 text-[11px] font-medium text-white/60 transition-all hover:border-white/[0.1] hover:text-white sm:gap-2 sm:px-4 sm:py-2.5 sm:text-[11px]"
        >
          <Plus size={12} />
          Upload
        </button>
        {project && <DeliveryPackButton projectId={project.id} projectName={project.name} />}
        {project && (
          <ProjectOptionsMenu
            project={project}
            trackCount={trackCount}
            onChanged={onChanged}
            onDeleted={onDeleted}
            onEditTitle={() => setEditingTitle(true)}
            onEditTags={() => setTagsOpen(true)}
            onEditDescription={() => setDescOpen(true)}
            onEditCover={onEditCover}
            onSetStatus={onSetStatus}
            align="left"
          />
        )}
      </div>
    </div>
  );
}

function Fact({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/[0.02] px-2 py-1 text-[9px] font-mono tabular-nums text-white/60 sm:text-[10px]">
      {children}
    </span>
  );
}

/**
 * A stat chip that turns into a field on click.
 *
 * Same shape and weight as the read-only chips beside it — an editable value
 * should look like the value it is, and reveal that it is editable on hover
 * rather than by permanently wearing a button.
 */
function EditableFact({
  label, value, empty, suffix, onSave,
}: {
  label: string;
  value: string;
  empty: string;
  suffix?: string;
  onSave: (next: string) => Promise<boolean>;
}) {
  return (
    <span className="inline-flex items-center rounded-full bg-white/[0.02] px-1 py-0.5">
      <InlineText
        label={label}
        value={value}
        onSave={onSave}
        placeholder={empty}
        emptyLabel={empty}
        className="px-1 py-0.5 text-[9px] font-mono uppercase tracking-wider tabular-nums text-white/60 sm:text-[10px]"
        inputClassName="w-16 text-[10px] font-mono uppercase tabular-nums"
        hideAffordance
      />
      {value && suffix && (
        <span className="pr-1.5 text-[9px] font-mono text-white/30 sm:text-[10px]">{suffix}</span>
      )}
    </span>
  );
}
