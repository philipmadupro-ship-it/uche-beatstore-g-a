'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { uploadImageFile, getImageUploadPreflightError } from '@/lib/upload/image-upload-client';
import { extractPaletteFromFile, extractPaletteFromUrl } from '@/lib/artwork/extract.client';
import { generateGradient } from '@/lib/artwork/gradient';
import { normalisePalette, type PaletteEntry } from '@/lib/artwork/palette';
import { useBrandArtworkStore } from '@/hooks/useBrandArtwork';
import { toast } from '@/hooks/useToast';
import { CoverImage } from '@/components/ui/CoverImage';

/**
 * Default artwork — one image, used wherever new content has none.
 *
 * Two things happen on upload. The image is stored as the fallback cover, and
 * its dominant colours are extracted and stored alongside it. The colours are
 * what let a catalogue of coverless beats look like one brand without looking
 * like one repeated logo: each gets a gradient built from this palette, varied
 * by its own id.
 *
 * Extraction runs here, in the browser, because it needs a canvas. The result
 * is persisted so the storefront — which renders on the server — can use it
 * without re-deriving anything.
 */
export function DefaultArtworkCard() {
  const inputRef = useRef<HTMLInputElement>(null);

  const storeUrl = useBrandArtworkStore((s) => s.defaultArtworkUrl);
  const storePalette = useBrandArtworkStore((s) => s.palette);
  const applyToStore = useBrandArtworkStore((s) => s.set);
  const load = useBrandArtworkStore((s) => s.load);

  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); }, [load]);

  const persist = async (url: string | null, palette: PaletteEntry[] | null) => {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ default_artwork_url: url, default_artwork_palette: palette }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(typeof j.error === 'string' ? j.error : 'Could not save default artwork');
    }
    applyToStore({
      defaultArtworkUrl: url,
      palette: normalisePalette(palette ?? []),
    });
  };

  const onPick = async (file: File) => {
    const preflight = getImageUploadPreflightError(file);
    if (preflight) { toast.error(preflight); return; }

    setBusy(true);
    try {
      // Extract before upload: it works on the local File, so the producer is
      // not waiting on a round trip before we know the colours, and a failed
      // upload costs nothing.
      const palette = await extractPaletteFromFile(file).catch(() => [] as PaletteEntry[]);
      const url = await uploadImageFile(file);
      await persist(url, palette.length > 0 ? palette : null);
      toast.success(
        palette.length > 0
          ? 'Default artwork saved — gradients will use these colours'
          : 'Default artwork saved',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    try {
      await persist(null, null);
      toast.success('Default artwork removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove artwork');
    } finally {
      setBusy(false);
    }
  };

  /** Re-derive colours for artwork saved before extraction existed, or when a
   *  first attempt hit a tainted canvas. */
  const onRecolour = async () => {
    if (!storeUrl) return;
    setBusy(true);
    try {
      const palette = await extractPaletteFromUrl(storeUrl);
      if (palette.length === 0) {
        toast.error('Could not read colours from that image');
        return;
      }
      await persist(storeUrl, palette);
      toast.success('Brand colours updated');
    } catch {
      toast.error('Could not read colours from that image');
    } finally {
      setBusy(false);
    }
  };

  // Three sample seeds so the producer sees the variation, not one result.
  const samples = ['sample-one', 'sample-two', 'sample-three']
    .map((seed) => generateGradient(storePalette, seed));

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 className="text-[12px] font-bold uppercase tracking-wider text-white">Default artwork</h2>
      <p className="mt-1 text-[11px] leading-snug text-white/50">
        Used whenever a beat, project or playlist is created without a cover. You can
        still set artwork per item — this only fills the gap.
      </p>

      <div className="mt-4 flex flex-wrap items-start gap-4">
        <div className="relative size-24 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
          {storeUrl ? (
            <CoverImage src={storeUrl} alt="Default artwork" className="object-cover" sizes="96px" />
          ) : (
            <div className="grid h-full w-full place-items-center text-white/25">
              <ImagePlus size={20} />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="tap inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[11px] font-medium text-white transition-colors hover:border-white/20 disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
              {storeUrl ? 'Replace' : 'Upload logo or artwork'}
            </button>
            {storeUrl && (
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

          {storePalette.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">Brand</span>
              {storePalette.map((hex) => (
                <span
                  key={hex}
                  title={hex}
                  className="size-4 rounded-full border border-white/15"
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          ) : (
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/30">
              No brand colours yet — gradients use the theme accent
            </p>
          )}
        </div>
      </div>

      {/* Show the variation rather than describe it: three seeds, three covers,
          same family. This is the part that is hard to believe from a caption. */}
      <div className="mt-4">
        <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">
          Generated covers for beats without artwork
        </p>
        <div className="flex gap-2">
          {samples.map((g, i) => (
            <div
              key={i}
              className="h-16 flex-1 rounded-lg border border-white/10"
              style={{ backgroundImage: g.css }}
            />
          ))}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so re-picking the same file still fires a change event.
          e.target.value = '';
          if (file) void onPick(file);
        }}
      />
    </section>
  );
}
