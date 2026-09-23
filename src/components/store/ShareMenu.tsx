'use client';

/**
 * Single share affordance — replaces the three buttons that used to
 * overlap on /store/[id] (URL share, IG card, 9:16 vertical). Clicking
 * the trigger opens a popover with all three named actions so the
 * buyer picks the format they actually want.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Share2 } from 'lucide-react';
import { ShareCardModal } from './ShareCardButton';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { toast } from '@/hooks/useToast';

interface Props {
  trackId: string;
  trackTitle: string;
  producerName?: string | null;
  accentColor?: string;
}

export function ShareMenu({
  trackId, trackTitle, producerName, accentColor = '#FFFFFF',
}: Props) {
  const [cardOpen, setCardOpen] = useState(false);
  const router = useRouter();

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
      {/* One menu model app-wide. This was hand-rolled: it declared
          role="menu" and role="menuitem" — telling a screen reader to expect
          arrow-key navigation — and implemented none, and its
          `absolute right-0 top-12` panel could be clipped by any ancestor
          with overflow. ActionMenu portals, positions and handles the
          keyboard, and already renders the per-item hint line this menu had
          built for itself. */}
      <div className="relative shrink-0">
        <ActionMenu
          align="right"
          width={240}
          label="Share"
          triggerContent={<Share2 size={14} />}
          triggerClassName="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-white/80 transition-colors hover:border-white/[0.16] hover:bg-white/[0.08] hover:text-white"
          sections={[
            {
              id: 'link',
              items: [
                {
                  id: 'copy', label: 'Copy / share link', hint: 'Quick URL share',
                  onSelect: copyLink,
                },
              ],
            },
            {
              id: 'formats',
              items: [
                {
                  id: 'card', label: 'Share card (image)', hint: '1080×1920 for Stories',
                  onSelect: () => setCardOpen(true),
                },
                {
                  id: 'vertical', label: 'Vertical preview', hint: '9:16 for TikTok / Reels',
                  onSelect: () => router.push(`/store/${trackId}/share`),
                },
              ],
            },
          ]}
        />
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
