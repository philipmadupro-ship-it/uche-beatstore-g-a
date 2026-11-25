'use client';

import Link from 'next/link';
import {
  Upload, GitBranch, Star, ShoppingBag, RotateCcw, TriangleAlert, Tag, PackageX, Heart,
  MessageCircle, HandHelping, FileUp, MessageSquare, Send, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  KIND_ICON, type ActivityIconName, type ActivityItem, type ActivityTone,
} from '@/lib/dashboard/activity-taxonomy';

/**
 * Shared presentation for one Activity row: the slide-over panel and the
 * calendar's day panel both render it, so icon, tone and link cannot drift.
 * What a row SAYS and where it goes is decided in lib/dashboard/activity-taxonomy.
 */
const ICONS: Record<ActivityIconName, React.ElementType> = {
  upload: Upload, 'git-branch': GitBranch, star: Star, 'shopping-bag': ShoppingBag, 'rotate-ccw': RotateCcw,
  'alert-triangle': TriangleAlert, tag: Tag, 'package-x': PackageX, heart: Heart, 'message-circle': MessageCircle,
  'hand-helping': HandHelping, 'file-up': FileUp, 'message-square': MessageSquare, send: Send, eye: Eye,
};

// Colour only signals: mint = good news, tan = look at this, red = trouble.
const TONE_CLASS: Record<ActivityTone, string> = {
  neutral: 'text-white/60',
  positive: 'text-[#6DC6A4]',
  warning: 'text-[#c8a47a]',
  danger: 'text-red-400',
};

export function ActivityRow({ item, onNavigate, timeLabel }: { item: ActivityItem; onNavigate?: () => void; timeLabel: string }) {
  const Icon = ICONS[KIND_ICON[item.kind]] ?? Send;
  const body = (
    <div className="group flex gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10">
        <Icon size={12} className={TONE_CLASS[item.tone]} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[11px] leading-snug text-white/80">{item.title}</p>
        <p className="mt-0.5 font-mono text-[10px] tabular-nums text-white/40">{timeLabel}</p>
      </div>
    </div>
  );
  return (
    <li>
      {item.href ? (
        <Link
          href={item.href}
          onClick={onNavigate}
          className="block rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        >
          {body}
        </Link>
      ) : body}
    </li>
  );
}

export const chipClass = (active: boolean) => cn(
  'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30',
  active
    ? 'border-white/30 bg-white/[0.14] text-white'
    : 'border-white/10 bg-transparent text-white/60 hover:border-white/20 hover:bg-white/[0.06] hover:text-white',
);
