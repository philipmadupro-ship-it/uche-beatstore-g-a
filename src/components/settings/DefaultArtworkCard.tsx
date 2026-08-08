'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2, Plus, X } from 'lucide-react';
import { uploadImageFile, getImageUploadPreflightError } from '@/lib/upload/image-upload-client';
import { extractPaletteFromFile, extractPaletteFromUrl } from '@/lib/artwork/extract.client';
import { generateGradient, type ArtworkKind } from '@/lib/artwork/gradient';
import {
  normalisePalette, setPaletteColor, addPaletteColor, removePaletteColor,
  MAX_PALETTE, type PaletteEntry,
} from '@/lib/artwork/palette';
import { useBrandArtworkStore, type KindArtwork } from '@/hooks/useBrandArtwork';
import { ImageCropper } from '@/components/ui/ImageCropper';
import { ColorPicker } from '@/components/ui/ColorPicker';
import { Popover } from '@/components/ui/Popover';
import { CoverImage } from '@/components/ui/CoverImage';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

/**
 * Brand assets: the logo, and a default artwork per kind.
 *
 * One default image made every coverless beat, project and playlist share a
 * base picture, differing only in hue. Three slots let a producer give
 * projects a different look from singles — which is how they already think
 * about a catalogue — while projects and playlists still fall back to the
 * track image, so setting one is enough to get the benefit.
 *
 * Every image goes through a crop step. Uploading raw meant the cover was
 * whatever aspect the file happened to be, centre-cropped by CSS at render
 * time, so the producer never saw what the tile would show until it was saved.
 *
 * Colours are extracted per slot, because the palette is derived FROM the
 * image: a project photo should tint project gradients with its own colours.
 */

type SlotId = ArtworkKind | 'logo';

const ARTWORK_SLOTS: Array<{ id: ArtworkKind; label: string; hint: string }> = [
  { id: 'track', label: 'Beats & songs', hint: 'Also the fallback for projects and playlists.' },
  { id: 'project', label: 'Projects', hint: 'Optional — falls back to beats & songs.' },
  { id: 'playlist', label: 'Playlists', hint: 'Optional — falls back to beats & songs.' },
];

/** Which profile columns a slot writes. */
const FIELDS: Record<ArtworkKind, { url: string; palette: string }> = {
  track: { url: 'default_artwork_url', palette: 'default_artwork_palette' },
  project: { url: 'default_artwork_project_url', palette: 'default_artwork_project_palette' },
  playlist: { url: 'default_artwork_playlist_url', palette: 'default_artwork_playlist_palette' },
};

export function DefaultArtworkCard() {
  const logoUrl = useBrandArtworkStore((s) => s.logoUrl);
  const artwork = useBrandArtworkStore((s) => s.artwork);
  const apply = useBrandArtworkStore((s) => s.apply);
  const load = useBrandArtworkStore((s) => s.load);

  const [busySlot, setBusySlot] = useState<SlotId | null>(null);
  const [pending, setPending] = useState<{ slot: SlotId; file: File } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickingFor = useRef<SlotId>('track');

  useEffect(() => { load(); }, [load]);

  /** Patch the profile, then mirror into the store so the UI updates at once. */
  const save = async (patch: Record<string, unknown>, next: () => void) => {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(typeof j.error === 'string' ? j.error : 'Could not save');
    }
    next();
  };

  const openPicker = (slot: SlotId) => {
    pickingFor.current = slot;
    inputRef.current?.click();
  };

  /** Runs after the crop is confirmed. */
  const commitCrop = async (slot: SlotId, cropped: File) => {
    setPending(null);
    setBusySlot(slot);
    try {
      if (slot === 'logo') {
        const url = await uploadImageFile(cropped);
        await save({ logo_url: url }, () => apply({ logoUrl: url }));
        toast.success('Logo saved');
        return;
      }
      // Extract from the CROPPED file: colours should describe what will
      // actually be shown, not the discarded edges of the original.
      const palette = await extractPaletteFromFile(cropped).catch(() => [] as PaletteEntry[]);
      const url = await uploadImageFile(cropped);
      const f = FIELDS[slot];
      await save(
        { [f.url]: url, [f.palette]: palette.length > 0 ? palette : null },
        () => apply({
          artwork: { ...artwork, [slot]: { url, palette: normalisePalette(palette) } },
        }),
      );
      toast.success('Artwork saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusySlot(null);
    }
  };

  const clearSlot = async (slot: SlotId) => {
    setBusySlot(slot);
    try {
      if (slot === 'logo') {
        await save({ logo_url: null }, () => apply({ logoUrl: null }));
      } else {
        const f = FIELDS[slot];
        await save({ [f.url]: null, [f.palette]: null }, () => apply({
          artwork: { ...artwork, [slot]: { url: null, palette: [] } },
        }));
      }
      toast.success('Removed');
    } catch {
      toast.error('Could not remove');
    } finally {
      setBusySlot(null);
    }
  };

  const savePalette = async (slot: ArtworkKind, colors: string[]) => {
    const f = FIELDS[slot];
    const payload = colors.map((hex) => ({ hex, weight: 1 / colors.length }));
    // Optimistic — a colour control that lags a round trip feels broken.
    apply({ artwork: { ...artwork, [slot]: { ...artwork[slot], palette: colors } } });
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [f.url]: artwork[slot].url, [f.palette]: payload }),
    });
    if (!res.ok) toast.error('Could not save colours');
  };

  const recolour = async (slot: ArtworkKind) => {
    const url = artwork[slot].url;
    if (!url) return;
    setBusySlot(slot);
    try {
      const palette = await extractPaletteFromUrl(url);
      if (palette.length === 0) { toast.error('Could not read colours'); return; }
      await savePalette(slot, normalisePalette(palette));
      toast.success('Colours updated');
    } catch {
      toast.error('Could not read colours');
    } finally {
      setBusySlot(null);
    }
  };

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 className="text-[12px] font-bold uppercase tracking-wider text-white">Brand &amp; artwork</h2>
      <p className="mt-1 text-[11px] leading-snug text-white/50">
        Your logo replaces the mark in the top-left. Default artwork fills in wherever
        something is created without a cover — you can still set artwork per item.
      </p>

      {/* Logo */}
      <div className="mt-4 flex flex-wrap items-center gap-4 border-b border-white/[0.06] pb-4">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-2">
          {logoUrl ? (
            // Contained, not covered: a wide wordmark cropped to fill is a
            // wordmark with its ends cut off.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
          ) : (
            <span className="font-mono text-[10px] tracking-tighter text-white/30">U2C</span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="text-[11px] font-medium text-white">Logo</p>
          <div className="flex flex-wrap gap-2">
            <SlotButton busy={busySlot === 'logo'} onClick={() => openPicker('logo')}>
              {logoUrl ? 'Replace' : 'Upload logo'}
            </SlotButton>
            {logoUrl && (
              <button
                type="button"
                onClick={() => void clearSlot('logo')}
                disabled={busySlot === 'logo'}
                className="tap inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[11px] font-medium text-[var(--error-text)] transition-colors hover:border-[var(--error)] disabled:opacity-40"
              >
                <Trash2 size={12} /> Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Per-kind artwork */}
      <div className="mt-4 space-y-4">
        {ARTWORK_SLOTS.map((slot) => (
          <ArtworkSlot
            key={slot.id}
            slot={slot}
            value={artwork[slot.id]}
            inherited={!artwork[slot.id].url && slot.id !== 'track'}
            busy={busySlot === slot.id}
            onPick={() => openPicker(slot.id)}
            onClear={() => void clearSlot(slot.id)}
            onRecolour={() => void recolour(slot.id)}
            onPalette={(colors) => void savePalette(slot.id, colors)}
          />
        ))}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const preflight = getImageUploadPreflightError(file);
          if (preflight) { toast.error(preflight); return; }
          setPending({ slot: pickingFor.current, file });
        }}
      />

      <ImageCropper
        open={pending !== null}
        file={pending?.file ?? null}
        title={pending?.slot === 'logo' ? 'Crop logo' : 'Crop artwork'}
        hint={pending?.slot === 'logo'
          ? 'Drag to reposition. The logo is shown contained, so leave a little room.'
          : 'Drag to reposition, use the slider to zoom. Covers are square.'}
        onCancel={() => setPending(null)}
        onCropped={(file) => { if (pending) void commitCrop(pending.slot, file); }}
      />
    </section>
  );
}

function ArtworkSlot({
  slot, value, inherited, busy, onPick, onClear, onRecolour, onPalette,
}: {
  slot: { id: ArtworkKind; label: string; hint: string };
  value: KindArtwork;
  inherited: boolean;
  busy: boolean;
  onPick: () => void;
  onClear: () => void;
  onRecolour: () => void;
  onPalette: (colors: string[]) => void;
}) {
  /* Six seeds, not two.
     
     Two was a false economy introduced when this card grew from one slot to
     three: it fits, but two tiles cannot show the range — the whole promise
     of this feature is that covers vary, and a pair can look coincidental.
     Six is enough to read as a set and matches the number of compositions a
     track can draw, so the preview reflects the real spread rather than a
     sample of it. */
  const samples = ['a', 'b', 'c', 'd', 'e', 'f']
    .map((suffix) => generateGradient(value.palette, `${slot.id}-${suffix}`, { kind: slot.id }));

  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
        {value.url ? (
          <CoverImage src={value.url} alt="" className="object-cover" sizes="64px" />
        ) : (
          <div className="grid h-full w-full place-items-center text-white/25">
            <ImagePlus size={16} />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <p className="text-[11px] font-medium text-white">{slot.label}</p>
          {inherited && (
            <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/30">
              inherited
            </span>
          )}
        </div>
        <p className="text-[10px] leading-snug text-white/40">{slot.hint}</p>

        <div className="flex flex-wrap gap-2">
          <SlotButton busy={busy} onClick={onPick}>
            {value.url ? 'Replace' : 'Upload'}
          </SlotButton>
          {value.url && (
            <>
              <button
                type="button"
                onClick={onRecolour}
                disabled={busy}
                className="tap inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[11px] font-medium text-white/70 transition-colors hover:text-white disabled:opacity-40"
              >
                Re-read colours
              </button>
              <button
                type="button"
                onClick={onClear}
                disabled={busy}
                className="tap inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[11px] font-medium text-[var(--error-text)] transition-colors hover:border-[var(--error)] disabled:opacity-40"
              >
                <Trash2 size={12} /> Remove
              </button>
            </>
          )}
        </div>

        {value.palette.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {value.palette.map((hex, i) => (
              <span key={`${hex}-${i}`} className="group/sw relative">
                <Popover
                  width={264}
                  trigger={({ open, toggle, ref }) => (
                    <button
                      ref={ref as (el: HTMLButtonElement | null) => void}
                      onClick={toggle}
                      aria-expanded={open}
                      aria-label={`Change colour ${i + 1} for ${slot.label}`}
                      className={cn(
                        'size-5 rounded-full border transition-transform hover:scale-110',
                        open ? 'border-white' : 'border-white/25',
                      )}
                      style={{ backgroundColor: hex }}
                    />
                  )}
                >
                  {() => (
                    <ColorPicker
                      value={hex}
                      recent={value.palette}
                      onChange={(next) => onPalette(setPaletteColor(value.palette, i, next))}
                    />
                  )}
                </Popover>
                {value.palette.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onPalette(removePaletteColor(value.palette, i))}
                    aria-label={`Remove colour ${i + 1} for ${slot.label}`}
                    className="absolute -right-1 -top-1 hidden size-3 place-items-center rounded-full border border-white/20 bg-[#0e0c09] text-white/70 group-hover/sw:grid hover:text-white"
                  >
                    <X size={7} />
                  </button>
                )}
              </span>
            ))}
            {value.palette.length < MAX_PALETTE && (
              <button
                type="button"
                onClick={() => onPalette(addPaletteColor(value.palette, '#7f5af0'))}
                aria-label={`Add a colour for ${slot.label}`}
                className="tap grid size-5 place-items-center rounded-full border border-dashed border-white/25 text-white/50 transition-colors hover:border-white/40 hover:text-white"
              >
                <Plus size={10} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Full-width beneath the controls: six tiles cannot sit beside them
          without squeezing the palette swatches off the row. */}
      <div className="mt-1 grid w-full grid-cols-6 gap-1.5">
        {samples.map((g, i) => (
          <div
            key={i}
            title={g.composition}
            className="aspect-square rounded-lg border border-white/10"
            style={{ backgroundImage: g.css }}
          />
        ))}
      </div>
    </div>
  );
}

function SlotButton({ busy, onClick, children }: { busy: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="tap inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[11px] font-medium text-white transition-colors hover:border-white/20 disabled:opacity-40"
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
      {children}
    </button>
  );
}
