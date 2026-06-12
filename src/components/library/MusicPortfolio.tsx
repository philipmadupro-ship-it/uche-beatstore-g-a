'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { gsap } from 'gsap';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';

gsap.registerPlugin(ScrambleTextPlugin);

export interface PortfolioTrack {
    id: string;
    title: string;
    artist: string;
    type: string;
    cover_url: string | null;
    bpm?: number | null;
    key?: string | null;
    scale?: string | null;
    year: string;
    // ── Store-only extras (rendered only when variant === 'embedded'). All
    //    optional so /library calls don't break. They sit in a right-side
    //    cluster where the background-gradient is most transparent so the
    //    hover-cover image still reads through. ─────────────────────────────
    priceLease?: number | null;
    priceExclusive?: number | null;
    freeDownload?: boolean;
    durationSeconds?: number | null;
    tags?: string[];
}

interface MusicPortfolioProps {
    tracks: PortfolioTrack[];
    onTrackPlay: (trackId: string) => void;
    currentTrackId?: string | null;
    isPlaying?: boolean;
    /** Optional callback so the portfolio shows a floating "exit" chip. */
    onExit?: () => void;
    /**
     * 'fullbleed' (default) — fills the viewport, vertically centers the
     * list, dark gradient background that fades cover art in on hover.
     * Used by /library portfolio view.
     *
     * 'embedded' — sized by content (min-h-[480px]), no vertical centering,
     * works inside the existing page chrome. Used by /store list view so
     * the hero / filters / view toggle above it stay put.
     */
    variant?: 'fullbleed' | 'embedded';
    /** Optional secondary click handler — e.g. open a preview drawer in the
     *  store. Distinct from onTrackPlay so the parent can choose whether
     *  clicking a row plays it, opens it, or both. */
    onTrackOpen?: (trackId: string) => void;
    /** Optional wishlist plumbing. When `isWishlisted` is provided, the
     *  embedded row renders a heart in the right-side cluster. */
    isWishlisted?: (trackId: string) => boolean;
    onToggleWishlist?: (trackId: string) => void;
}

function fmtDuration(secs: number | null | undefined): string {
    if (secs == null || !Number.isFinite(secs)) return '—';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function usePrefersReducedMotion(): boolean {
    const [prefersReduced, setPrefersReduced] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        setPrefersReduced(mq.matches);
        const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);
    return prefersReduced;
}

export default function MusicPortfolio({
    tracks,
    onTrackPlay,
    currentTrackId,
    isPlaying,
    onExit,
    variant = 'fullbleed',
    onTrackOpen,
    isWishlisted,
    onToggleWishlist,
}: MusicPortfolioProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const bgRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const titleRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
    const idleTimelineRef = useRef<gsap.core.Timeline | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastHoveredRef = useRef<string | null>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const prefersReduced = usePrefersReducedMotion();

    const getRow = useCallback((id: string) => rowRefs.current.get(id), []);
    const getTitleSpan = useCallback((id: string) => titleRefs.current.get(id), []);

    // Background image transition on hover
    useEffect(() => {
        if (!bgRef.current) return;
        const track = hoveredId ? tracks.find((t) => t.id === hoveredId) : null;
        const url = track?.cover_url;

        gsap.to(bgRef.current, {
            duration: 0.6,
            ease: 'power2.out',
            opacity: url ? 1 : 0,
            scale: 1,
            overwrite: 'auto',
        });

        if (url) {
            bgRef.current.style.backgroundImage = `url(${url})`;
        }
    }, [hoveredId, tracks]);

    // Idle animation — rows pulse in sequence when no row has been hovered for 4s
    useEffect(() => {
        if (prefersReduced || tracks.length === 0) return;

        const buildIdle = () => {
            if (idleTimelineRef.current) {
                idleTimelineRef.current.kill();
                idleTimelineRef.current = null;
            }
            rowRefs.current.forEach((row) => {
                gsap.set(row, { opacity: 1 });
            });

            const tl = gsap.timeline({ repeat: -1, yoyo: true, paused: true });
            tracks.forEach((track, i) => {
                const row = rowRefs.current.get(track.id);
                if (!row) return;
                tl.to(
                    row,
                    { opacity: 0.35, duration: 1.2, ease: 'power1.inOut' },
                    i * 0.4,
                );
            });
            idleTimelineRef.current = tl;
            tl.play();
        };

        buildIdle();

        return () => {
            if (idleTimelineRef.current) {
                idleTimelineRef.current.kill();
                idleTimelineRef.current = null;
            }
        };
    }, [tracks, prefersReduced]);

    const killIdle = useCallback(() => {
        if (idleTimelineRef.current) {
            idleTimelineRef.current.pause();
            idleTimelineRef.current.progress(0);
        }
        rowRefs.current.forEach((row) => {
            gsap.set(row, { opacity: 1 });
        });
    }, []);

    const startIdleDebounce = useCallback(() => {
        if (prefersReduced) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            if (idleTimelineRef.current) {
                idleTimelineRef.current.restart();
            }
        }, 4000);
    }, [prefersReduced]);

    // Handle row hover — GSAP scramble on title (skipped in embedded mode,
    // where the store wants readable, scannable titles, not a creative effect)
    const handleRowEnter = useCallback(
        (id: string) => {
            if (prefersReduced || variant === 'embedded') {
                setHoveredId(id);
                return;
            }

            killIdle();
            if (debounceRef.current) clearTimeout(debounceRef.current);

            if (lastHoveredRef.current) {
                const prevTitle = titleRefs.current.get(lastHoveredRef.current);
                if (prevTitle) {
                    gsap.killTweensOf(prevTitle);
                    gsap.set(prevTitle, { textContent: prevTitle.dataset.originalText || '' });
                }
            }

            lastHoveredRef.current = id;
            setHoveredId(id);

            const titleSpan = titleRefs.current.get(id);
            if (titleSpan && titleSpan.dataset.originalText) {
                gsap.killTweensOf(titleSpan);
                gsap.to(titleSpan, {
                    duration: 0.8,
                    scrambleText: {
                        text: titleSpan.dataset.originalText,
                        chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
                        revealDelay: 0.2,
                        tweenLength: false,
                    },
                    ease: 'power2.out',
                });
            }
        },
        [killIdle, prefersReduced, variant],
    );

    const handleRowLeave = useCallback(
        (id: string) => {
            setHoveredId(null);
            if (prefersReduced) return;

            const titleSpan = titleRefs.current.get(id);
            if (titleSpan && titleSpan.dataset.originalText) {
                gsap.killTweensOf(titleSpan);
                gsap.set(titleSpan, { textContent: titleSpan.dataset.originalText });
            }

            startIdleDebounce();
        },
        [prefersReduced, startIdleDebounce],
    );

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (idleTimelineRef.current) {
                idleTimelineRef.current.kill();
                idleTimelineRef.current = null;
            }
            if (debounceRef.current) clearTimeout(debounceRef.current);
            titleRefs.current.forEach((span) => {
                gsap.killTweensOf(span);
            });
        };
    }, []);

    const sortedTracks = tracks;

    if (sortedTracks.length === 0) {
        return (
            <div className="flex items-center justify-center h-full" style={{ background: '#090907' }}>
                <p className="text-[#B4AA99] text-[11px] font-mono uppercase tracking-[0.2em]">No tracks to display</p>
            </div>
        );
    }

    const isEmbedded = variant === 'embedded';

    return (
        <div
            ref={containerRef}
            className={`relative w-full overflow-hidden select-none ${
                isEmbedded ? 'min-h-[480px] rounded-2xl' : 'h-full'
            }`}
            style={{ background: '#090907' }}
        >
            {/* Background image reveal */}
            <div
                ref={bgRef}
                className="absolute inset-0 bg-cover bg-center opacity-0 scale-[1.2] transition-[transform] duration-700 ease-out"
                style={{
                    backgroundImage: 'none',
                    transform: hoveredId ? 'scale(1)' : 'scale(1.2)',
                }}
            />
            {/* Gradient overlay on background */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background:
                        'linear-gradient(to right, #090907 0%, rgba(10,9,7,0.6) 50%, rgba(10,9,7,0.3) 100%)',
                }}
            />

            {/* Floating exit chip — only when the parent provides onExit.
                Pinned top-right; keeps the immersive layout but gives the
                user one tap back to the previous view. */}
            {onExit && (
                <button
                    type="button"
                    onClick={onExit}
                    aria-label="Exit portfolio view"
                    className="absolute top-4 right-4 md:top-6 md:right-6 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur border border-white/[0.08] text-[10px] font-mono uppercase tracking-[0.2em] text-[#D0C3AF] hover:text-[#F7EBDD] hover:border-white/[0.18] transition-colors"
                >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                    Exit
                </button>
            )}

            {/* Track list */}
            <div className={`relative z-10 ${isEmbedded ? '' : 'h-full overflow-y-auto'}`}>
                <div className={`flex flex-col ${
                    isEmbedded
                        ? 'px-4 md:px-8 py-6'
                        : 'min-h-full justify-center px-8 md:px-16 lg:px-24 xl:px-32'
                }`}>
                    {sortedTracks.map((track, idx) => {
                        const isCurrent = track.id === currentTrackId;
                        const isHovered = hoveredId === track.id;

                        return (
                            <div
                                key={track.id}
                                ref={(el) => {
                                    if (el) rowRefs.current.set(track.id, el);
                                    else rowRefs.current.delete(track.id);
                                }}
                                onClick={() => {
                                    // onTrackOpen wins when provided (e.g. store
                                    // wants to surface the preview drawer); falls
                                    // back to plain play behavior used by /library.
                                    if (onTrackOpen) onTrackOpen(track.id);
                                    else onTrackPlay(track.id);
                                }}
                                onMouseEnter={() => handleRowEnter(track.id)}
                                onMouseLeave={() => handleRowLeave(track.id)}
                                className={`
                  group flex items-center gap-4 md:gap-6 lg:gap-8 py-3 md:py-4 cursor-pointer
                  border-b border-[#2B2821] transition-colors duration-300
                  ${isHovered ? 'text-[#E7D7BE]' : 'text-[#D0C3AF]'}
                  ${isCurrent ? 'text-[#E7D7BE]' : ''}
                `}
                                style={{ opacity: 1 }}
                            >
                                {/* Index / now-playing indicator */}
                                <div className="w-6 shrink-0 flex items-center justify-center">
                                    {isCurrent && isPlaying ? (
                                        <span className="relative flex h-2.5 w-2.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#E7D7BE] opacity-75" />
                                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#E7D7BE]" />
                                        </span>
                                    ) : (
                                        <span
                                            className={`text-[11px] font-mono tabular-nums ${isHovered ? 'text-[#E7D7BE]' : 'text-[#B4AA99]'
                                                }`}
                                        >
                                            {String(idx + 1).padStart(2, '0')}
                                        </span>
                                    )}
                                </div>

                                {/* Cover art thumbnail — clicking plays the
                                    track regardless of whether the row's
                                    primary click opens the preview drawer. */}
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onTrackPlay(track.id);
                                    }}
                                    aria-label={`Play ${track.title}`}
                                    className="w-8 h-8 shrink-0 rounded overflow-hidden relative group/cover"
                                >
                                    {track.cover_url ? (
                                        <img
                                            src={track.cover_url}
                                            alt=""
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full bg-gradient-to-br from-[#342F27] to-[#090907]" />
                                    )}
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/cover:opacity-100 transition-opacity flex items-center justify-center">
                                        {isCurrent && isPlaying ? (
                                            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="text-white" aria-hidden="true">
                                                <rect x="2" y="1.5" width="2" height="7" rx="0.5" />
                                                <rect x="6" y="1.5" width="2" height="7" rx="0.5" />
                                            </svg>
                                        ) : (
                                            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="text-white ml-0.5" aria-hidden="true">
                                                <path d="M2 1.5L8.5 5L2 8.5V1.5Z" />
                                            </svg>
                                        )}
                                    </div>
                                </button>

                                {/* Title */}
                                <div className="flex-1 min-w-0">
                                    <span
                                        ref={(el) => {
                                            if (el) {
                                                titleRefs.current.set(track.id, el);
                                                if (!el.dataset.originalText) {
                                                    el.dataset.originalText = track.title;
                                                }
                                            } else {
                                                titleRefs.current.delete(track.id);
                                            }
                                        }}
                                        className={`block text-[13px] md:text-[15px] font-medium tracking-wide truncate ${isEmbedded ? '' : 'font-heading'}`}
                                        data-original-text={track.title}
                                    >
                                        {track.title}
                                    </span>
                                </div>

                                {/* Type */}
                                <span className="hidden md:block text-[11px] font-mono uppercase tracking-[0.2em] text-[#B4AA99] group-hover:text-[#E7D7BE] transition-colors duration-300 w-20 shrink-0">
                                    {track.type}
                                </span>

                                {/* BPM · Key (with minor suffix) */}
                                <span className="hidden sm:block text-[11px] font-mono uppercase tracking-[0.2em] text-[#B4AA99] group-hover:text-[#E7D7BE] transition-colors duration-300 w-24 shrink-0 tabular-nums">
                                    {(track.bpm ?? '-')}{track.key ? ` · ${track.key}${track.scale === 'minor' ? 'm' : ''}` : ''}
                                </span>

                                {/* Year */}
                                <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#B4AA99] group-hover:text-[#E7D7BE] transition-colors duration-300 w-12 shrink-0 text-right">
                                    {track.year}
                                </span>

                                {/* Embedded-only extras — store passes price /
                                    duration / tags. Lives on the far right where
                                    the bg gradient is most transparent so the
                                    hover cover image still reads through. */}
                                {isEmbedded && (
                                    <div className="hidden md:flex items-center gap-2.5 shrink-0 pointer-events-none">
                                        {/* Tags — top 2, accent on hover for readability */}
                                        {(track.tags ?? []).slice(0, 2).map((tag) => (
                                            <span
                                                key={tag}
                                                className="px-2 py-1 rounded-md text-[10px] font-mono uppercase tracking-[0.15em] text-[#D0C3AF] bg-[#171511]/80 border border-white/[0.08] backdrop-blur-sm"
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                        {/* Duration */}
                                        {track.durationSeconds != null && (
                                            <span className="text-[11px] font-mono text-[#D0C3AF] tabular-nums w-10 text-right">
                                                {fmtDuration(track.durationSeconds)}
                                            </span>
                                        )}
                                        {/* Prices — Free or Lease + Excl side-by-side,
                                            large enough to scan, with semantic colors.
                                            "$X / Excl" feels readable at a glance. */}
                                        {track.freeDownload ? (
                                            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#6DC6A4] bg-[#6DC6A4]/10 border border-[#6DC6A4]/30 px-2.5 py-1 rounded-md">
                                                Free
                                            </span>
                                        ) : (
                                            <div className="flex items-center gap-1.5">
                                                {track.priceLease != null && (
                                                    <span className="flex flex-col items-center px-2 py-1 rounded-md bg-white/[0.06] border border-white/[0.10] backdrop-blur-sm leading-none">
                                                        <span className="text-[12px] font-bold text-[#F7EBDD] tabular-nums">${track.priceLease}</span>
                                                        <span className="text-[7px] font-mono uppercase tracking-wider text-[#B4AA99] mt-0.5">Lease</span>
                                                    </span>
                                                )}
                                                {track.priceExclusive != null && (
                                                    <span
                                                        className="flex flex-col items-center px-2 py-1 rounded-md leading-none"
                                                        style={{ backgroundColor: '#E7D7BE', color: '#000' }}
                                                    >
                                                        <span className="text-[12px] font-bold tabular-nums">${track.priceExclusive}</span>
                                                        <span className="text-[7px] font-mono uppercase tracking-wider text-black/55 mt-0.5">Excl.</span>
                                                    </span>
                                                )}
                                                {track.priceLease == null && track.priceExclusive == null && (
                                                    <span className="text-[11px] font-mono text-[#9B9282]">No price</span>
                                                )}
                                            </div>
                                        )}
                                        {/* Wishlist heart */}
                                        {onToggleWishlist && (
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); onToggleWishlist(track.id); }}
                                                aria-pressed={!!isWishlisted?.(track.id)}
                                                title={isWishlisted?.(track.id) ? 'Remove from favorites' : 'Add to favorites'}
                                                className={`pointer-events-auto w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                                                    isWishlisted?.(track.id)
                                                        ? 'text-[#D6BE7A]'
                                                        : 'text-[#9B9282] hover:text-[#D0C3AF]'
                                                }`}
                                            >
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill={isWishlisted?.(track.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5L12 21Z" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}