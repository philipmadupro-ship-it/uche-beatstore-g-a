'use client';

/**
 * Draws one storefront section.
 *
 * This is the component that decides whether the builder is a real editor or a
 * mockup. Wherever the storefront already has a component for something, the
 * preview renders THAT component with the producer's real data — the hero is
 * the actual `ArtistBioBlock`, the beat tiles are actual `BeatCard`s. What you
 * arrange here is what buyers get, because it is literally the same code.
 *
 * Where a section has no data yet — no featured playlists, no beats listed —
 * it says so plainly instead of drawing convincing fake content. A preview that
 * invents three playlists you do not have is worse than an empty one: it hides
 * the exact problem the producer opened the editor to fix.
 */

import Image from 'next/image';
import { ListMusic, Layers, Music, ShieldCheck, Sparkles, Timer } from 'lucide-react';
import { ArtistBioBlock } from '@/components/store/ArtistBioBlock';
import { BeatCard } from '@/components/store/BeatCard';
import type { CreatorProfile, StoreTrack } from '@/components/store/types';
import { resolveSection, type SectionSettings, type StoreBreakpoint, type StoreSection, type StoreTheme } from '@/lib/store-editor/layout';
import { cn } from '@/lib/utils';
import { pointToPercent } from '@/lib/store-editor/canvas-blocks';

export type BuilderPlaylist = {
  id: string;
  name: string;
  cover_url?: string | null;
  price_usd?: number | string | null;
};

export type StorefrontData = {
  creator: CreatorProfile | null;
  tracks: StoreTrack[];
  playlists: BuilderPlaylist[];
  projects: BuilderPlaylist[];
  picks: StoreTrack[];
};

const noop = () => {};

/** Spacing steps → padding, scaled by the theme. */
function spacingFor(settings: SectionSettings, theme: StoreTheme): string {
  return `${settings.spacing * 8 * theme.spacingScale}px`;
}

function widthClass(width: SectionSettings['width']): string {
  if (width === 'full') return 'max-w-none';
  if (width === 'narrow') return 'max-w-[720px]';
  return 'max-w-[1400px]';
}

function EmptyNote({ icon: Icon, children }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-center gap-2 border border-dashed border-white/10 px-4 py-8">
      <Icon size={14} className="text-white/30" />
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">{children}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">{children}</p>
  );
}

export function SectionRenderer({
  section, breakpoint, theme, data, editBlocks,
}: {
  section: StoreSection;
  breakpoint: StoreBreakpoint;
  theme: StoreTheme;
  data: StorefrontData;
  /**
   * Supplied only by the builder. The live storefront renders the identical
   * component without it, so nothing draggable, no pointer handlers and no
   * selection chrome can ever reach a buyer — the capability is absent rather
   * than merely switched off.
   */
  editBlocks?: {
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    onMove: (id: string, x: number, y: number, commit: boolean) => void;
  };
}) {
  const settings = resolveSection(section, breakpoint);
  if (!settings.visible) return null;

  const pad = spacingFor(settings, theme);
  const inner = cn('mx-auto w-full', widthClass(settings.width));
  const align = settings.align === 'center' ? 'text-center' : settings.align === 'right' ? 'text-right' : 'text-left';

  const body = (() => {
    switch (section.kind) {
      case 'hero':
        return (
          <ArtistBioBlock
            creator={data.creator}
            accentColor={theme.accent}
            plainTitle={settings.variant === 'plain'}
          />
        );

      case 'countdown':
        return (
          <div className={cn(inner, 'px-4')}>
            <div
              className="flex items-center gap-3 border px-4 py-3"
              style={{ borderColor: theme.border, background: theme.surface }}
            >
              <Timer size={15} style={{ color: theme.accent }} />
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/60">
                Next drop countdown
              </p>
              <span className="ml-auto font-mono text-[10px] text-white/30">
                Shows when a track has a scheduled release
              </span>
            </div>
          </div>
        );

      case 'featured-projects':
      case 'featured-playlists': {
        const isProjects = section.kind === 'featured-projects';
        const items = isProjects ? data.projects : data.playlists;
        return (
          <div className={cn(inner, 'px-4')}>
            <SectionLabel>{isProjects ? 'Projects' : 'Playlists'}</SectionLabel>
            {items.length === 0 ? (
              <EmptyNote icon={isProjects ? Layers : ListMusic}>
                {`No ${isProjects ? 'projects' : 'playlists'} featured yet`}
              </EmptyNote>
            ) : (
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${settings.columns}, minmax(0, 1fr))` }}
              >
                {items.map((item) => (
                  <div key={item.id}>
                    <div
                      className="relative mb-2 aspect-square overflow-hidden border"
                      style={{ borderColor: theme.border, background: theme.surface, borderRadius: theme.radius }}
                    >
                      {item.cover_url ? (
                        <Image src={item.cover_url} alt="" width={320} height={320} unoptimized className="h-full w-full object-cover" />
                      ) : (
                        <span className="grid h-full w-full place-items-center">
                          {isProjects ? <Layers size={16} className="text-white/30" /> : <ListMusic size={16} className="text-white/30" />}
                        </span>
                      )}
                      {isProjects && item.price_usd != null && Number(item.price_usd) > 0 ? (
                        <span
                          className="absolute inset-x-0 bottom-0 py-0.5 text-center font-mono text-[10px] font-bold text-black"
                          style={{ background: theme.accent }}
                        >
                          ${item.price_usd}
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-[11px] text-white/60">{item.name}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }

      case 'spotlight': {
        const track = data.tracks[0];
        return (
          <div className={cn(inner, 'px-4')}>
            <div
              className="flex items-center gap-4 border px-4 py-4"
              style={{ borderColor: theme.border, background: theme.surface, borderRadius: theme.radius }}
            >
              <Sparkles size={16} style={{ color: theme.accent }} />
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Daily pick</p>
                <p className="truncate text-[13px] text-white/80">
                  {track ? track.title : 'Chosen automatically from recent sales'}
                </p>
              </div>
            </div>
          </div>
        );
      }

      case 'producer-picks':
      case 'catalog': {
        const isPicks = section.kind === 'producer-picks';
        const tracks = isPicks ? data.picks : data.tracks;
        if (tracks.length === 0) {
          return (
            <div className={cn(inner, 'px-4')}>
              <SectionLabel>{isPicks ? "Producer's Picks" : 'Catalogue'}</SectionLabel>
              <EmptyNote icon={Music}>
                {isPicks ? 'No picks selected yet' : 'No beats listed yet'}
              </EmptyNote>
            </div>
          );
        }
        // The catalogue's list variant is the storefront's default on desktop;
        // grid is what mobile gets. Both are drawn here so switching the
        // variant on a breakpoint shows the actual difference.
        if (!isPicks && settings.variant === 'list') {
          return (
            <div className={cn(inner, 'px-4')}>
              <SectionLabel>Catalogue</SectionLabel>
              <div className="divide-y" style={{ borderColor: theme.border }}>
                {tracks.slice(0, 6).map((track) => (
                  <div key={track.id} className="flex items-center gap-3 py-2.5">
                    <span
                      className="size-9 shrink-0 overflow-hidden border"
                      style={{ borderColor: theme.border, background: theme.surface, borderRadius: theme.radius }}
                    >
                      {track.cover_url ? (
                        <Image src={track.cover_url} alt="" width={72} height={72} unoptimized className="h-full w-full object-cover" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-white/80">{track.title}</span>
                      <span className="block font-mono text-[10px] text-white/30">
                        {track.bpm ? `${track.bpm} BPM` : ''}{track.key ? ` · ${track.key}` : ''}
                      </span>
                    </span>
                    <span
                      className="shrink-0 border px-2 py-1 font-mono text-[10px]"
                      style={{ borderColor: theme.border, color: theme.accent, borderRadius: theme.radius }}
                    >
                      {track.lease_price_usd ? `$${track.lease_price_usd}` : 'Free'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        }
        return (
          <div className={cn(inner, 'px-4')}>
            <SectionLabel>{isPicks ? "Producer's Picks" : 'Catalogue'}</SectionLabel>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${settings.columns}, minmax(0, 1fr))` }}
            >
              {tracks.slice(0, settings.columns * 2).map((track) => (
                <BeatCard
                  key={track.id}
                  track={track}
                  allTracks={tracks}
                  priceLease={track.lease_price_usd ?? null}
                  priceExclusive={track.exclusive_price_usd ?? null}
                  isCurrent={false}
                  isPlaying={false}
                  isPreview={false}
                  onPlay={noop}
                  onPreview={noop}
                  onAddLease={noop}
                  onAddExclusive={noop}
                  onFreeDownload={noop}
                  accentColor={theme.accent}
                />
              ))}
            </div>
          </div>
        );
      }

      case 'trust':
        return (
          <div className={cn(inner, 'px-4')}>
            <div
              className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-y py-4"
              style={{ borderColor: theme.border }}
            >
              {['Instant delivery', 'Secure checkout', 'Licensed for release'].map((label) => (
                <span key={label} className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
                  <ShieldCheck size={12} style={{ color: theme.accent }} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        );

      case 'text':
        return (
          <div className={cn(inner, 'px-4', align)}>
            {section.content?.heading ? (
              <h2
                className="mb-2 text-[24px] leading-tight"
                style={{ color: theme.text, fontFamily: 'var(--font-heading)' }}
              >
                {section.content.heading}
              </h2>
            ) : null}
            <p
              className="mx-auto whitespace-pre-wrap leading-relaxed"
              style={{ color: theme.muted, fontSize: theme.typeScale, maxWidth: settings.width === 'narrow' ? '60ch' : undefined }}
            >
              {section.content?.body || 'Add your text in the inspector.'}
            </p>
            {section.content?.ctaLabel ? (
              <span
                className="mt-4 inline-block border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em]"
                style={{
                  borderColor: theme.buttonStyle === 'ghost' ? 'transparent' : theme.accent,
                  background: theme.buttonStyle === 'solid' ? theme.accent : 'transparent',
                  color: theme.buttonStyle === 'solid' ? '#0b0b09' : theme.accent,
                  borderRadius: theme.radius,
                  borderWidth: theme.borderWidth,
                }}
              >
                {section.content.ctaLabel}
              </span>
            ) : null}
          </div>
        );

      case 'image':
        return (
          <div className={cn(inner, 'px-4')}>
            {section.content?.imageUrl ? (
              /**
               * Reserved box rather than a bare <img>.
               *
               * The URL is arbitrary and its intrinsic size unknown, so there
               * are no honest width/height attributes to give. An aspect-ratio
               * container reserves the space anyway, which is what the rule is
               * actually for: the storefront must not reflow around this image
               * as it loads. `loading="lazy"` because a content image is never
               * the hero.
               */
              <div
                className="w-full overflow-hidden"
                style={{ aspectRatio: '16 / 9', borderRadius: theme.radius }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary producer-supplied URL, not a known-size asset. */}
                <img
                  src={section.content.imageUrl}
                  alt={section.content.heading || ''}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <EmptyNote icon={Music}>Add an image URL in the inspector</EmptyNote>
            )}
          </div>
        );

      case 'video':
        return (
          <div className={cn(inner, 'px-4')}>
            {section.content?.videoUrl ? (
              <div
                className="aspect-video w-full border"
                style={{ borderColor: theme.border, background: theme.surface, borderRadius: theme.radius }}
              >
                <iframe
                  src={section.content.videoUrl}
                  title={section.content.heading || 'Video'}
                  className="h-full w-full"
                  allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
                />
              </div>
            ) : (
              <EmptyNote icon={Music}>Add an embed URL in the inspector</EmptyNote>
            )}
          </div>
        );

      case 'links':
        return (
          <div className={cn(inner, 'px-4', align)}>
            <div className="flex flex-wrap items-center gap-3" style={{ justifyContent: settings.align === 'center' ? 'center' : settings.align === 'right' ? 'flex-end' : 'flex-start' }}>
              {[
                data.creator?.instagram_handle && 'Instagram',
                data.creator?.twitter_handle && 'X',
                data.creator?.spotify_url && 'Spotify',
                data.creator?.soundcloud_url && 'SoundCloud',
                data.creator?.website_url && 'Website',
              ].filter(Boolean).length === 0 ? (
                <EmptyNote icon={Music}>No social links set on your profile</EmptyNote>
              ) : (
                [
                  data.creator?.instagram_handle && 'Instagram',
                  data.creator?.twitter_handle && 'X',
                  data.creator?.spotify_url && 'Spotify',
                  data.creator?.soundcloud_url && 'SoundCloud',
                  data.creator?.website_url && 'Website',
                ].filter(Boolean).map((label) => (
                  <span
                    key={String(label)}
                    className="border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]"
                    style={{ borderColor: theme.border, color: theme.muted, borderRadius: theme.radius }}
                  >
                    {String(label)}
                  </span>
                ))
              )}
            </div>
          </div>
        );

      case 'canvas':
        return (
          <div className={cn(inner, 'px-4')}>
            {/* Free-form placement, bounded by this frame. Blocks are positioned
                in PERCENTAGES, so a hand-composed panel still reflows across
                device widths instead of hanging off the side of a phone. */}
            <div
              className="relative w-full border"
              style={{
                aspectRatio: '16 / 7',
                borderColor: theme.border,
                background: theme.surface,
                borderRadius: theme.radius,
              }}
            >
              {(section.content?.blocks ?? []).map((block) => (
                <div
                  key={block.id}
                  role={editBlocks ? 'button' : undefined}
                  tabIndex={editBlocks ? -1 : undefined}
                  aria-label={editBlocks ? `${block.kind} block` : undefined}
                  aria-pressed={editBlocks ? editBlocks.selectedId === block.id : undefined}
                  onPointerDown={editBlocks ? (event) => {
                    if (event.button !== 0) return;
                    event.stopPropagation();
                    editBlocks.onSelect(block.id);
                    const frameEl = event.currentTarget.parentElement;
                    if (!frameEl) return;
                    const frame = frameEl.getBoundingClientRect();
                    // Grab offset in percent, so the block does not jump its
                    // own top-left corner to the cursor on the first move.
                    const start = pointToPercent(event.clientX, event.clientY, frame);
                    const grabX = start.x - block.x;
                    const grabY = start.y - block.y;
                    const move = (e: PointerEvent) => {
                      const at = pointToPercent(e.clientX, e.clientY, frame);
                      editBlocks.onMove(block.id, at.x - grabX, at.y - grabY, false);
                    };
                    const up = (e: PointerEvent) => {
                      const at = pointToPercent(e.clientX, e.clientY, frame);
                      editBlocks.onMove(block.id, at.x - grabX, at.y - grabY, true);
                      window.removeEventListener('pointermove', move);
                      window.removeEventListener('pointerup', up);
                    };
                    // Window listeners, matching the cover art canvas: a fast
                    // drag that leaves the frame still ends cleanly instead of
                    // leaving the block stuck to the cursor.
                    window.addEventListener('pointermove', move);
                    window.addEventListener('pointerup', up);
                  } : undefined}
                  className={cn(
                    'absolute overflow-hidden',
                    editBlocks && 'cursor-move outline-none',
                    editBlocks && editBlocks.selectedId === block.id
                      ? 'ring-1 ring-white/70'
                      : editBlocks && 'hover:ring-1 hover:ring-white/30',
                  )}
                  style={{
                    left: `${block.x}%`,
                    top: `${block.y}%`,
                    width: `${block.width}%`,
                    height: `${block.height}%`,
                  }}
                >
                  {block.kind === 'text' ? (
                    <p
                      className="h-full w-full"
                      style={{
                        color: block.color ?? theme.text,
                        fontSize: block.fontSize ?? theme.typeScale,
                        textAlign: block.align ?? 'left',
                      }}
                    >
                      {block.text}
                    </p>
                  ) : null}
                  {block.kind === 'shape' ? (
                    <span className="block h-full w-full" style={{ background: block.color ?? theme.accent }} />
                  ) : null}
                  {block.kind === 'image' && block.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary producer-supplied URL.
                    <img
                      src={block.imageUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
              ))}
              {(section.content?.blocks ?? []).length === 0 ? (
                <span className="absolute inset-0 grid place-items-center font-mono text-[10px] uppercase tracking-[0.18em] text-white/25">
                  {editBlocks ? 'Empty canvas — add blocks in the inspector' : ''}
                </span>
              ) : null}
            </div>
          </div>
        );

      default:
        return null;
    }
  })();

  return (
    <section
      data-section-kind={section.kind}
      style={{ paddingTop: pad, paddingBottom: pad }}
    >
      {body}
    </section>
  );
}
