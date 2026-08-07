'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ZoomIn } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import {
  cropRect, clampOffset, clampScale, initialCrop, renderedSize,
  MIN_SCALE, MAX_SCALE, type CropState, type Size,
} from '@/lib/artwork/crop';

/**
 * Pick an image, then choose what part of it is actually used.
 *
 * Uploading raw files meant the cover was whatever aspect the source happened
 * to be, centre-cropped by CSS at render time — so the producer never saw what
 * the tile would show until it was already saved, and a wide photo lost its
 * subject. Cropping at upload makes the decision visible and makes the stored
 * asset the thing that ships.
 *
 * All geometry comes from lib/artwork/crop; this only turns pointer events
 * into state and renders the result. Hand-rolled per the no-UI-library rule.
 */

/** On-screen frame size. Also the export size floor — see `exportCrop`. */
const FRAME = 320;

/** Square output. Covers are square everywhere they are rendered, and a logo
 *  is drawn contained inside a square box, so one output shape serves both. */
const OUTPUT = 1024;

export interface ImageCropperProps {
  open: boolean;
  file: File | null;
  title?: string;
  /** Shown under the frame — e.g. what the crop will be used for. */
  hint?: string;
  onCancel: () => void;
  onCropped: (file: File) => void;
}

export function ImageCropper({
  open, file, title = 'Crop image', hint, onCancel, onCropped,
}: ImageCropperProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [crop, setCrop] = useState<CropState>(initialCrop);
  const [busy, setBusy] = useState(false);

  const dragging = useRef<{ x: number; y: number } | null>(null);

  // Object URL for the picked file, revoked on change and on unmount — an
  // un-revoked one pins the whole Blob in memory for the session.
  useEffect(() => {
    if (!file) { setUrl(null); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    setCrop(initialCrop());
    setNatural(null);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !natural) return;
    const dx = e.clientX - dragging.current.x;
    const dy = e.clientY - dragging.current.y;
    dragging.current = { x: e.clientX, y: e.clientY };
    setCrop((c) => ({
      ...c,
      offset: clampOffset(natural, FRAME, c.scale, {
        x: c.offset.x + dx,
        y: c.offset.y + dy,
      }),
    }));
  }, [natural]);

  const endDrag = () => { dragging.current = null; };

  const setScale = (next: number) => {
    if (!natural) return;
    const scale = clampScale(next);
    // Re-clamp the offset: zooming OUT shrinks the slack, and an offset that
    // was legal at 3x can leave the frame uncovered at 1x.
    setCrop((c) => ({ scale, offset: clampOffset(natural, FRAME, scale, c.offset) }));
  };

  const confirm = async () => {
    if (!url || !natural || !file) return;
    setBusy(true);
    try {
      const out = await exportCrop(url, natural, crop, file.name, file.type);
      onCropped(out);
    } finally {
      setBusy(false);
    }
  };

  const size = natural ? renderedSize(natural, FRAME, crop.scale) : null;

  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="space-y-3">
        <div
          className="relative mx-auto touch-none overflow-hidden rounded-xl border border-white/15 bg-black"
          style={{ width: FRAME, height: FRAME }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                setNatural({ width: img.naturalWidth, height: img.naturalHeight });
              }}
              className="absolute left-1/2 top-1/2 max-w-none select-none"
              style={size ? {
                width: size.width,
                height: size.height,
                transform: `translate(calc(-50% + ${crop.offset.x}px), calc(-50% + ${crop.offset.y}px))`,
              } : { visibility: 'hidden' }}
            />
          )}
          {/* Rule-of-thirds guides, drawn over the image so the drag target
              stays the whole frame. */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/15" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/15" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/15" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/15" />
          </div>
          {!natural && (
            <div className="absolute inset-0 grid place-items-center text-white/40">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
        </div>

        <div className="mx-auto flex items-center gap-2" style={{ width: FRAME }}>
          <ZoomIn size={13} className="shrink-0 text-white/40" aria-hidden />
          <input
            type="range"
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={0.01}
            value={crop.scale}
            aria-label="Zoom"
            onChange={(e) => setScale(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15"
          />
        </div>

        <p className="text-center text-[10px] text-white/40">
          {hint ?? 'Drag to reposition, scroll the slider to zoom.'}
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="tap min-h-9 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[11px] font-medium text-white/70 transition-colors hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!natural || busy}
            className="tap inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/25 bg-white/[0.13] px-3 text-[11px] font-medium text-white transition-colors hover:bg-white/[0.18] disabled:opacity-40"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            Use image
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Render the chosen region to a square PNG/JPEG.
 *
 * Exported at a fixed 1024px rather than at the frame's 320: the same asset is
 * used as a 40px thumbnail and as a full-bleed hero, and re-encoding at editor
 * resolution would make the hero soft. Upscaling a smaller source is bounded by
 * the crop rect, so a tiny original stays tiny rather than being blown up.
 */
async function exportCrop(
  url: string,
  natural: Size,
  crop: CropState,
  name: string,
  type: string,
): Promise<File> {
  const rect = cropRect(natural, FRAME, crop);
  const img = await loadImage(url);

  const side = Math.min(OUTPUT, Math.max(1, Math.round(rect.width)));
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (!ctx) return fileFromUrl(url, name, type);

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, side, side);

  // PNG for anything that might carry transparency (a logo usually does),
  // JPEG otherwise — a photographic cover as PNG is several times the bytes
  // for no visible gain.
  const mime = type === 'image/png' || type === 'image/webp' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, 0.92));
  if (!blob) return fileFromUrl(url, name, type);

  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  return new File([blob], `${base}-cropped.${ext}`, { type: mime });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

/** Last resort if canvas is unavailable: ship the original rather than nothing. */
async function fileFromUrl(url: string, name: string, type: string): Promise<File> {
  const blob = await fetch(url).then((r) => r.blob());
  return new File([blob], name, { type });
}
