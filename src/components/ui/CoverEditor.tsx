'use client';

import { useRef, type ReactNode, type RefObject } from 'react';
import { Camera, Loader2, ImageOff } from 'lucide-react';
import { ArtworkFallback } from './ArtworkFallback';
import { confirmToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import type { ArtworkKind } from '@/lib/artwork/gradient';

/**
 * The big square cover on a detail page — track, project or playlist.
 *
 * Two things the three pages each had their own half of:
 *
 * 1. A coverless item showed a grey glyph or a bare gradient, ignoring the
 *    default artwork the producer had already set in Settings. `ArtworkFallback`
 *    resolves that for the right kind, so what you set once actually appears.
 *
 * 2. There was no way to REMOVE a cover. Clicking the square replaced it, and
 *    that was the whole vocabulary — a cover uploaded by mistake was permanent
 *    short of finding another image to bury it with. Removing clears the field
 *    and hands the item back to the brand default.
 *
 * Remove is deliberately a small button over the art rather than part of the
 * click-anywhere target: the common action is replace, and a destructive
 * action sharing a hit area with the common one gets hit by accident.
 */
interface CoverEditorProps {
  src?: string | null;
  /** Stable id for the generated fallback — the row id, never an index. */
  seed: string;
  kind?: ArtworkKind;
  tags?: readonly string[];
  /** Glyph shown over the gradient when there is no cover and no brand image. */
  children?: ReactNode;
  uploading?: boolean;
  removing?: boolean;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Omit to render an upload-only square (no remove affordance). */
  onRemove?: () => void | Promise<void>;
  /** Names the thing in the confirm prompt, e.g. "Midnight Tape". */
  removeLabel?: string;
  /** Shared with a parent that also wants to trigger the file picker. */
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
  sizes?: string;
  priority?: boolean;
}

export function CoverEditor({
  src,
  seed,
  kind = 'track',
  tags,
  children,
  uploading,
  removing,
  onFile,
  onRemove,
  removeLabel,
  inputRef,
  className,
  sizes = '(max-width: 640px) 90vw, 360px',
  priority,
}: CoverEditorProps) {
  const ownRef = useRef<HTMLInputElement>(null);
  const fileRef = inputRef ?? ownRef;
  const busy = uploading || removing;

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRemove) return;
    const ok = await confirmToast(
      'Remove cover?',
      removeLabel
        ? `“${removeLabel}” goes back to your default artwork. The image file itself isn’t deleted.`
        : 'It goes back to your default artwork. The image file itself isn’t deleted.',
      { confirmLabel: 'Remove', cancelLabel: 'Keep', danger: true },
    );
    if (!ok) return;
    await onRemove();
  };

  return (
    <div
      className={cn(
        'group relative aspect-square w-full cursor-pointer overflow-hidden rounded-xl border border-white/[0.05] bg-white/[0.04]',
        className,
      )}
      onClick={() => fileRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label={src ? 'Replace cover' : 'Add a cover'}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileRef.current?.click();
        }
      }}
    >
      <ArtworkFallback src={src} seed={seed} kind={kind} tags={tags} sizes={sizes} priority={priority} className="object-cover">
        {children}
      </ArtworkFallback>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {busy ? <Loader2 size={20} className="animate-spin text-white" /> : <Camera size={20} className="text-white" />}
      </div>

      {src && onRemove && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={busy}
          title="Remove cover"
          aria-label="Remove cover"
          className="absolute right-2 top-2 z-10 grid size-8 place-items-center rounded-full border border-white/20 bg-black/70 text-white opacity-0 backdrop-blur-sm transition-opacity hover:border-white/40 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
        >
          <ImageOff size={13} />
        </button>
      )}

      <input
        type="file"
        ref={fileRef}
        className="hidden"
        accept="image/jpeg,image/png,image/webp"
        onChange={onFile}
      />
    </div>
  );
}
