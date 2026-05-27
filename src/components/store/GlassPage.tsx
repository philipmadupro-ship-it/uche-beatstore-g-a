'use client';

/**
 * Shared glass-card shell for the three Spotify-style music pages:
 *
 *   /store/projects/[id]              (pre-purchase project detail)
 *   /store/projects/access/[token]    (post-purchase access)
 *   /store/playlists/[id]             (à la carte playlist)
 *
 * They all previously hand-rolled the same structural chrome — cover-tint
 * backdrop, rounded-[28px] glass card, tab nav with accent underline,
 * hero strip with title/producer/meta/actions + side cover panel —
 * which made coordinated visual changes a three-edit chore.
 *
 * This component is a compound:
 *   <GlassPage coverUrl accent>
 *     <GlassPage.TabNav tabs activeTab onTabChange />
 *     <GlassPage.Hero eyebrow title producer meta actions coverImage />
 *     <GlassPage.Section>...</GlassPage.Section>   // optional
 *     {children}                                    // free body
 *   </GlassPage>
 *
 * Sub-components are static fields on the parent so callers import once
 * and the relationship between them stays visible.
 */

import Link from 'next/link';
import type { ReactNode, CSSProperties } from 'react';
import { slugify } from '@/lib/slug';

interface GlassPageProps {
  /** Backdrop image — blurred, low-opacity behind the whole card. */
  coverUrl?: string | null;
  /** Accent hex (e.g. '#D4BFA0') used for gradient tint + active states. */
  accentColor: string;
  /** Card body — typically TabNav + Hero + Sections. */
  children: ReactNode;
  /** Max width on the card. Defaults to 5xl. */
  maxWidth?: 'max-w-4xl' | 'max-w-5xl' | 'max-w-6xl';
}

export function GlassPage({
  coverUrl,
  accentColor,
  children,
  maxWidth = 'max-w-5xl',
}: GlassPageProps) {
  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8] px-4 md:px-6 pt-8 md:pt-12 pb-24">
      {coverUrl && (
        <>
          <div
            className="fixed inset-0 -z-10 bg-cover bg-center blur-3xl opacity-20 scale-110"
            style={{ backgroundImage: `url(${coverUrl})` }}
            aria-hidden
          />
          <div
            className="fixed inset-0 -z-10"
            style={{
              background: `linear-gradient(180deg, ${accentColor}1a 0%, rgba(10,9,7,0.85) 50%, #0a0907 100%)`,
            }}
            aria-hidden
          />
        </>
      )}
      <div className={`${maxWidth} mx-auto`}>
        <div className="rounded-[28px] border border-white/[0.08] bg-[#14110d]/70 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.55)] overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ─── Tab nav ───────────────────────────────────────────────── */

interface TabNavProps<K extends string> {
  tabs: ReadonlyArray<readonly [K, string]>;
  activeTab: K;
  onTabChange: (k: K) => void;
  accentColor: string;
}

function TabNav<K extends string>({ tabs, activeTab, onTabChange, accentColor }: TabNavProps<K>) {
  return (
    <div className="flex items-center justify-center pt-5 pb-3 border-b border-white/[0.05]">
      <div className="flex items-center gap-7">
        {tabs.map(([k, label]) => {
          const active = activeTab === k;
          return (
            <button
              key={k}
              onClick={() => onTabChange(k)}
              className={`relative text-[13px] tracking-wide transition-colors ${
                active ? 'text-white' : 'text-white/45 hover:text-white/75'
              }`}
            >
              {label}
              {active && (
                <span
                  className="absolute -bottom-[10px] left-0 right-0 h-px"
                  style={{ backgroundColor: accentColor }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
GlassPage.TabNav = TabNav;

/* ─── Hero ──────────────────────────────────────────────────── */

interface HeroProducer {
  display_name?: string | null;
}

interface HeroProps {
  eyebrow: string;
  title: string;
  producer?: HeroProducer | null;
  /** Inline meta line (Headphones + count + duration etc.). */
  meta?: ReactNode;
  /** Action row below meta (Buy + Play + Follow etc.). */
  actions?: ReactNode;
  /** Right-side image source. Falls back to coverFallback. */
  coverImage?: string | null;
  /** Icon to show when coverImage is null. */
  coverFallback?: ReactNode;
  /** Hide the right cover panel entirely. */
  noCover?: boolean;
}

function Hero({
  eyebrow, title, producer, meta, actions, coverImage, coverFallback, noCover,
}: HeroProps) {
  return (
    <div className="relative flex flex-col md:flex-row gap-6 px-6 md:px-10 py-8 md:py-10 border-b border-white/[0.05]">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/45">
          {eyebrow}
        </p>
        <h1 className="mt-1.5 text-3xl md:text-5xl font-semibold text-white leading-[1.05] tracking-tight font-heading break-words">
          {title}
        </h1>
        {producer?.display_name && (
          <div className="mt-3 min-w-0">
            <Link
              href={`/store/producer/${slugify(producer.display_name)}`}
              className="inline-block max-w-full text-[15px] md:text-[16px] text-white/90 font-medium hover:text-white transition-colors break-all"
            >
              {producer.display_name}
            </Link>
          </div>
        )}
        {meta && (
          <div className="mt-1.5 flex items-center gap-2 text-[12px] text-white/55 flex-wrap">
            {meta}
          </div>
        )}
        {actions && (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>

      {!noCover && (
        <div className="relative w-full md:w-[280px] aspect-[16/10] md:aspect-square rounded-2xl overflow-hidden bg-[#0a0907] shrink-0">
          {coverImage ? (
            <img src={coverImage} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#2A2418] to-[#0a0907] text-[#5a5142]">
              {coverFallback}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        </div>
      )}
    </div>
  );
}
GlassPage.Hero = Hero;

/* ─── Section — optional bordered slot ─────────────────────── */

interface SectionProps {
  /** Tiny mono uppercase label above the content. */
  eyebrow?: string;
  children: ReactNode;
  /** Drop the bottom border (use on the last section). */
  noBorder?: boolean;
  /** Override the default px-6 md:px-10 py-6 padding. */
  className?: string;
  style?: CSSProperties;
}

function Section({ eyebrow, children, noBorder, className, style }: SectionProps) {
  return (
    <div
      className={`px-6 md:px-10 py-6 ${noBorder ? '' : 'border-b border-white/[0.05]'} ${className ?? ''}`}
      style={style}
    >
      {eyebrow && (
        <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/40 mb-2">
          {eyebrow}
        </p>
      )}
      {children}
    </div>
  );
}
GlassPage.Section = Section;
