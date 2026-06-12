'use client';

/**
 * Single share affordance — replaces the three buttons that used to
 * overlap on /store/[id] (URL share, IG card, 9:16 vertical). Clicking
 * the trigger opens a popover with all three named actions so the
 * buyer picks the format they actually want.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Share2, Image as ImageIcon, Video, Link2 } from 'lucide-react';
import { ShareCardModal } from './ShareCardButton';
import { toast } from '@/hooks/useToast';

interface Props {
  trackId: string;
  trackTitle: string;
  producerName?: string | null;
  accentColor?: string;
}

export function ShareMenu({
  trackId, trackTitle, producerName, accentColor = '#E7D7BE',
}: Props) {
  const [open, setOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const copyLink = async () => {
    if (typeof window === 'undefined') return;
    const nav = window.navigator;
    const url = window.location.href;
    if (typeof nav.share === 'function') {
      try {
        await nav.share({
          title: trackTitle,
          text: producerName ? `${trackTitle} — prod. ${producerName}` : trackTitle,
          url,
        });
        return;
      } catch {/* fall through */}
    }
    try {
      await nav.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy', 'Long-press the URL bar to share.');
    }
  };

  return (
    <>
      <div className="relative shrink-0" ref={wrapRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Share"
          className="w-10 h-10 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-[#D0C3AF] hover:text-[#F7EBDD] hover:bg-white/[0.08] hover:border-white/[0.16] transition-colors"
        >
          <Share2 size={14} />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-12 z-30 w-60 rounded-xl bg-[#171511]/95 backdrop-blur-xl border border-white/[0.10] shadow-[0_24px_60px_rgba(0,0,0,0.6)] py-1.5"
          >
            <button
              role="menuitem"
              onClick={() => { setOpen(false); copyLink(); }}
              className="flex items-center gap-2 w-full px-3 py-2.5 text-[12px] text-[#F7EBDD] hover:bg-white/[0.06] transition-colors text-left"
            >
              <Link2 size={12} className="text-white/55" />
              <div className="flex-1">
                <p>Copy / share link</p>
                <p className="text-[10px] text-white/35 font-mono mt-0.5">Quick URL share</p>
              </div>
            </button>

            <div className="my-1 mx-2 border-t border-white/[0.06]" />

            <button
              role="menuitem"
              onClick={() => { setOpen(false); setCardOpen(true); }}
              className="flex items-center gap-2 w-full px-3 py-2.5 text-[12px] text-[#F7EBDD] hover:bg-white/[0.06] transition-colors text-left"
            >
              <ImageIcon size={12} style={{ color: accentColor }} />
              <div className="flex-1">
                <p>Share card (image)</p>
                <p className="text-[10px] text-white/35 font-mono mt-0.5">1080×1920 for Stories</p>
              </div>
            </button>

            <Link
              role="menuitem"
              href={`/store/${trackId}/share`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2.5 text-[12px] text-[#F7EBDD] hover:bg-white/[0.06] transition-colors"
            >
              <Video size={12} style={{ color: accentColor }} />
              <div className="flex-1">
                <p>Vertical preview</p>
                <p className="text-[10px] text-white/35 font-mono mt-0.5">9:16 for TikTok / Reels</p>
              </div>
            </Link>
          </div>
        )}
      </div>

      <ShareCardModal
        trackId={trackId}
        trackTitle={trackTitle}
        kind="playing"
        accentColor={accentColor}
        open={cardOpen}
        onClose={() => setCardOpen(false)}
      />
    </>
  );
}
