'use client';

/**
 * Generates a 1080×1920 Instagram Stories card for a given track via
 * /api/store/share-card. Two surfaces:
 *
 *   • Preview modal — buyer sees the card, can save it (long-press on
 *     mobile / right-click download on desktop) or hit the share button.
 *   • Native share — uses Web Share API when available (iOS Safari,
 *     Android Chrome) to push directly into the OS share sheet so the
 *     buyer can pick Instagram / Twitter / Messages without leaving
 *     the page. Falls back to download when unsupported.
 *
 * Exports:
 *   - <ShareCardButton/>  Self-contained pill/icon that opens its own
 *                         modal. Use when the menu doesn't already wrap
 *                         the card share affordance.
 *   - <ShareCardModal/>   Controlled modal — open state lives outside.
 *                         Use from ShareMenu so we don't render two
 *                         triggers in a row.
 */

import { useState } from 'react';
import { Loader2, Share2, X, Download } from 'lucide-react';
import { toast } from '@/hooks/useToast';

interface ModalProps {
  trackId: string;
  trackTitle: string;
  kind?: 'licensed' | 'playing';
  accentColor?: string;
  open: boolean;
  onClose: () => void;
}

/** Controlled modal. Renders nothing when open is false. */
export function ShareCardModal({
  trackId, trackTitle, kind = 'playing', accentColor = '#E7D7BE', open, onClose,
}: ModalProps) {
  const [sharing, setSharing] = useState(false);
  const cardUrl = `/api/store/share-card?track_id=${encodeURIComponent(trackId)}&kind=${kind}`;

  const nativeShare = async () => {
    if (typeof navigator === 'undefined' || !navigator.share) {
      window.open(cardUrl, '_blank');
      return;
    }
    setSharing(true);
    try {
      const res = await fetch(cardUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], `${trackTitle.replace(/[^\w\d-]+/g, '_')}-share.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: trackTitle, text: `Now playing: ${trackTitle}` });
      } else {
        await navigator.share({ title: trackTitle, text: `Check this beat: ${trackTitle}`, url: window.location.href });
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        toast.error('Could not share', (err as Error).message);
      }
    } finally {
      setSharing(false);
    }
  };

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-[#171511] border border-white/[0.10] rounded-2xl p-5 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors"
          aria-label="Close"
        >
          <X size={14} />
        </button>

        <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/40 mb-3">
          Share to Stories
        </p>
        <h3 className="text-[14px] font-semibold text-[#F7EBDD] mb-4 pr-8 break-words">
          {trackTitle}
        </h3>

        <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-[#090907] mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cardUrl}
            alt={`${trackTitle} share card`}
            className="w-full h-auto"
            style={{ aspectRatio: '1080/1920' }}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={nativeShare}
            disabled={sharing}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-md text-black text-[12px] font-bold uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-40"
            style={{ backgroundColor: accentColor }}
          >
            {sharing ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
            Share
          </button>
          <a
            href={cardUrl}
            download={`${trackTitle.replace(/[^\w\d-]+/g, '_')}-share.png`}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-md bg-white/[0.06] border border-white/[0.10] text-white text-[12px] font-bold uppercase tracking-wider hover:bg-white/[0.10] transition-colors"
          >
            <Download size={12} />
            Save
          </a>
        </div>
      </div>
    </div>
  );
}

interface ButtonProps {
  trackId: string;
  trackTitle: string;
  kind?: 'licensed' | 'playing';
  /** Style override — defaults to a discreet pill. */
  variant?: 'pill' | 'icon';
  accentColor?: string;
}

/** Self-contained pill that opens its own modal. */
export function ShareCardButton({
  trackId, trackTitle, kind = 'playing', variant = 'pill', accentColor = '#E7D7BE',
}: ButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="Share to Instagram / Twitter / Messages"
        className={
          variant === 'icon'
            ? 'w-9 h-9 rounded-full flex items-center justify-center bg-white/[0.04] border border-white/[0.08] text-white/65 hover:text-white hover:bg-white/[0.10] transition-colors'
            : 'flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/[0.06] border border-white/[0.10] text-[#F7EBDD] text-[11px] font-mono uppercase tracking-[0.18em] hover:bg-white/[0.10] transition-colors'
        }
      >
        <Share2 size={variant === 'icon' ? 14 : 11} />
        {variant === 'pill' && 'Share card'}
      </button>
      <ShareCardModal
        trackId={trackId}
        trackTitle={trackTitle}
        kind={kind}
        accentColor={accentColor}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
