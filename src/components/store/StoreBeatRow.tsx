'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { Camera, Clock, GripVertical, Loader2, Music } from 'lucide-react';
import { ActionMenu, type MenuSection } from '@/components/ui/ActionMenu';
import { InlineText } from '@/components/ui/InlineText';
import { toast } from '@/hooks/useToast';
import { uploadImageFile } from '@/lib/upload/image-upload-client';
import { beatPublishState, parsePriceInput } from '@/lib/store-editor/beat-row';

export interface StoreBeatRowTrack {
  id: string;
  title: string;
  type: string;
  cover_url: string | null;
  bpm: number | null;
  key: string | null;
  store_listed: boolean;
  store_featured: boolean;
  lease_price_usd: number | null;
  free_download_enabled: boolean;
  voice_tag_enabled: boolean;
  scheduled_publish_at: string | null;
}

interface Props {
  track: StoreBeatRowTrack;
  /** Position among LISTED beats, or -1 when this row is a draft. */
  listedIndex: number;
  listedCount: number;
  /** Inherited profile lease price, shown as the placeholder when unset. */
  defaultLeasePrice?: number | null;
  licensePanelOpen: boolean;
  voiceTagConfigured: boolean;
  busy?: boolean;

  onPatch: (patch: Record<string, unknown>) => Promise<boolean>;
  onToggleListed: () => void;
  onToggleFeatured: () => void;
  onToggleFreeDownload: () => void;
  onToggleVoiceTag: () => void;
  onToggleLicensePanel: () => void;
  onMove: (direction: -1 | 1) => void;
  onSetSchedule: (iso: string | null) => Promise<void> | void;

  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}

/**
 * One beat in `/store-editor`'s Beat Listing.
 *
 * This row is where publishing happens, so what it can do in place matters
 * more than anywhere else in the dashboard. It previously carried **seven**
 * icon-only buttons side by side — schedule, pick, up, down, license tiers,
 * free download, voice tag — plus the on/off toggle, and the section header
 * told you outright: "To set prices and cover art, open the beat in your
 * Library." The one screen dedicated to deciding what sells could not set a
 * price.
 *
 * Now: cover (click it), title and **price** edit in place, the on/off toggle
 * stays as the single always-visible control because it is what the section is
 * for, and the other six move into one grouped ⋯ menu ordered by how often a
 * producer actually reaches for them.
 *
 * Price semantics come from `parsePriceInput`: blank means "inherit the profile
 * default", which is not the same as free — conflating the two publishes a
 * catalogue at $0.
 */
export function StoreBeatRow({
  track, listedIndex, listedCount, defaultLeasePrice,
  licensePanelOpen, voiceTagConfigured, busy,
  onPatch, onToggleListed, onToggleFeatured, onToggleFreeDownload,
  onToggleVoiceTag, onToggleLicensePanel, onMove, onSetSchedule,
  onDragStart, onDragOver, onDragEnd,
}: Props) {
  const [uploadingCover, setUploadingCover] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const isListed = listedIndex >= 0;
  const state = beatPublishState(track);

  const handleCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    try {
      const coverUrl = await uploadImageFile(file);
      const ok = await onPatch({ cover_url: coverUrl });
      if (ok) toast.success('Cover updated');
    } catch (err) {
      toast.error('Cover upload failed', err instanceof Error ? err.message : 'Try again');
    } finally {
      setUploadingCover(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const savePrice = async (raw: string) => {
    const parsed = parsePriceInput(raw);
    if (!parsed.ok) {
      toast.error('That is not a price',
        parsed.reason === 'negative' ? 'Enter zero or more.'
          : parsed.reason === 'too-large' ? 'Enter an amount under $999,999.'
          : 'Numbers only, e.g. 29.99.');
      return false;
    }
    return onPatch({ lease_price_usd: parsed.value });
  };

  const openSchedule = () => {
    setScheduleDraft(track.scheduled_publish_at
      ? new Date(track.scheduled_publish_at).toISOString().slice(0, 16)
      : '');
    setScheduleOpen(true);
  };

  const sections: MenuSection[] = [
    {
      id: 'listing',
      items: [
        {
          id: 'pick', label: track.store_featured ? "Remove from Producer's Picks" : "Pin to Producer's Picks",
          checked: track.store_featured, hidden: !track.store_listed, onSelect: onToggleFeatured,
        },
        {
          id: 'free', label: track.free_download_enabled ? 'Turn off free download' : 'Enable free download',
          hint: track.free_download_enabled ? undefined : 'Email-gated',
          checked: track.free_download_enabled, hidden: !track.store_listed,
          onSelect: onToggleFreeDownload,
        },
        {
          id: 'voice', label: track.voice_tag_enabled ? 'Remove voice tag' : 'Add voice tag to preview',
          hint: voiceTagConfigured ? undefined : 'Upload a voice tag first',
          checked: track.voice_tag_enabled, disabled: !voiceTagConfigured,
          hidden: !track.store_listed, onSelect: onToggleVoiceTag,
        },
        {
          id: 'licenses', label: licensePanelOpen ? 'Hide license tiers' : 'License tiers…',
          checked: licensePanelOpen, hidden: !track.store_listed, onSelect: onToggleLicensePanel,
        },
      ],
    },
    {
      id: 'order',
      label: 'Order',
      items: [
        {
          id: 'up', label: 'Move up', hidden: !isListed, disabled: listedIndex <= 0,
          onSelect: () => onMove(-1),
        },
        {
          id: 'down', label: 'Move down', hidden: !isListed, disabled: listedIndex >= listedCount - 1,
          onSelect: () => onMove(1),
        },
      ],
    },
    {
      id: 'schedule',
      items: [
        {
          id: 'schedule',
          label: track.scheduled_publish_at ? 'Edit auto-publish…' : 'Schedule auto-publish…',
          hint: track.scheduled_publish_at
            ? new Date(track.scheduled_publish_at).toLocaleString()
            : undefined,
          hidden: track.store_listed,
          onSelect: openSchedule,
        },
      ],
    },
  ];

  return (
    <div
      draggable={isListed}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors sm:flex-nowrap sm:gap-3 ${
        track.store_listed
          ? 'border-white/10 bg-white/[0.03] hover:border-white/20'
          : 'border-white/[0.06] bg-transparent hover:border-white/10'
      }`}
    >
      {isListed && (
        <GripVertical size={13} className="hidden shrink-0 cursor-grab text-white/30 hover:text-white/60 active:cursor-grabbing sm:block" />
      )}

      {/* Cover — click to replace. The section used to send you to the Library
          for this; it is one PATCH and the artwork is right here. */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        aria-label={`Change cover for ${track.title}`}
        className="group/cover relative h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-white/20 bg-white/[0.05]"
      >
        {track.cover_url
          ? <Image src={track.cover_url} alt="" width={36} height={36} unoptimized className="h-full w-full object-cover" />
          : <span className="flex h-full w-full items-center justify-center text-white/30"><Music size={12} /></span>}
        <span className="absolute inset-0 grid place-items-center bg-black/60 opacity-0 transition-opacity group-hover/cover:opacity-100">
          {uploadingCover ? <Loader2 size={11} className="animate-spin text-white" /> : <Camera size={11} className="text-white" />}
        </span>
      </button>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleCoverFile} />

      {/* Title + metadata */}
      <div className="min-w-[120px] flex-1">
        <InlineText
          label={`Title of ${track.title}`}
          value={track.title}
          onSave={(next) => onPatch({ title: next })}
          maxLength={200}
          className={`-mx-1 px-1 text-[11px] font-medium ${track.store_listed ? 'text-white' : 'text-white/80'}`}
          inputClassName="text-[11px] font-medium"
        />
        <p className="text-[9px] font-mono uppercase tracking-wider text-white/40">
          {track.type}
          {track.bpm ? ` · ${track.bpm} BPM` : ''}
          {track.key ? ` · ${track.key}` : ''}
        </p>
      </div>

      {/* Lease price — the field this whole section exists to set. */}
      <div className="hidden shrink-0 items-center sm:flex">
        <InlineText
          label={`Lease price for ${track.title}`}
          value={track.lease_price_usd != null ? String(track.lease_price_usd) : ''}
          onSave={savePrice}
          placeholder={defaultLeasePrice != null ? `${defaultLeasePrice}` : '0.00'}
          emptyLabel={defaultLeasePrice != null ? `$${defaultLeasePrice} (default)` : 'Set price'}
          className="px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-white/80"
          inputClassName="w-16 text-[10px] font-mono tabular-nums"
          hideAffordance
        />
      </div>

      {/* State */}
      <span
        title={state === 'scheduled' && track.scheduled_publish_at
          ? `Auto-publishes ${new Date(track.scheduled_publish_at).toLocaleString()}`
          : undefined}
        className={`hidden shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider sm:flex ${
          state === 'live' ? 'border border-[#6DC6A4]/20 bg-[#6DC6A4]/10 text-[#6DC6A4]'
            : state === 'scheduled' ? 'border border-amber-500/30 bg-amber-500/10 text-amber-300'
            : 'border border-white/10 bg-white/[0.05] text-white/30'
        }`}
      >
        {state === 'scheduled' && <Clock size={9} />}
        {state}
      </span>

      {/* Everything that is not "is this live" lives in one menu. */}
      <div className="relative shrink-0">
        <ActionMenu
          sections={sections}
          align="right"
          width={244}
          label={`Options for ${track.title}`}
          triggerClassName="grid size-8 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-white/40 transition-colors hover:border-white/20 hover:text-white"
        />
        {scheduleOpen && (
          <div className="absolute right-0 top-9 z-30 w-64 rounded-xl border border-white/[0.10] bg-[#0e0c09] p-3 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]">
            <p className="mb-2 text-[9px] font-mono uppercase tracking-wider text-white/40">Auto-publish at</p>
            <input
              type="datetime-local"
              autoFocus
              value={scheduleDraft}
              onChange={(e) => setScheduleDraft(e.target.value)}
              aria-label={`Auto-publish date for ${track.title}`}
              className="w-full rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-white focus:border-white/40 focus:outline-none"
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={!scheduleDraft}
                onClick={async () => {
                  if (!scheduleDraft) return;
                  await onSetSchedule(new Date(scheduleDraft).toISOString());
                  setScheduleOpen(false);
                }}
                className="flex-1 rounded-lg bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-black transition-colors hover:bg-white/90 disabled:opacity-40"
              >
                Schedule
              </button>
              {track.scheduled_publish_at && (
                <button
                  type="button"
                  onClick={async () => { await onSetSchedule(null); setScheduleOpen(false); }}
                  className="rounded-lg border border-white/20 px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-white/80 transition-colors hover:border-white/40 hover:text-white"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setScheduleOpen(false)}
                aria-label="Cancel scheduling"
                className="rounded-lg px-2 py-2 text-[10px] font-mono uppercase tracking-wider text-white/40 transition-colors hover:text-white"
              >
                Esc
              </button>
            </div>
          </div>
        )}
      </div>

      {/* The one control that stays visible: is this beat on the store. */}
      <button
        type="button"
        onClick={onToggleListed}
        disabled={busy}
        role="switch"
        aria-checked={track.store_listed}
        aria-label={track.store_listed ? `Remove ${track.title} from store` : `Add ${track.title} to store`}
        title={track.store_listed ? 'Remove from store' : 'Add to store'}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent outline-none transition-colors duration-200 ease-in-out disabled:opacity-60 ${
          track.store_listed ? 'bg-[#6DC6A4]' : 'bg-white/20'
        }`}
      >
        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          track.store_listed ? 'translate-x-5' : 'translate-x-0'
        }`} />
      </button>
    </div>
  );
}
